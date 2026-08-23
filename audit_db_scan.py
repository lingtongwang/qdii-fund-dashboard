import sqlite3
import json
import re
import urllib.request
import urllib.parse
import ssl
import time
import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_PATH = 'backend/data/fund.db'

def run_db_inquisition():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    print("="*80)
    print("【DATA INQUISITOR】全量 739 只基金数据库深度审计扫描启动...")
    print("="*80)
    
    findings = {
        "dim1_missing_null": [],
        "dim2_math_paradox": [],
        "dim3_mismatch_alloc": [],
        "dim4_outliers": [],
        "dim5_code_validity": [],
        "dim6_stale_reports": []
    }
    
    # 1. 基础信息全量获取
    funds = c.execute("SELECT * FROM funds").fetchall()
    print(f"总计扫描基金数: {len(funds)}")
    
    # 获取最新净值
    c.execute("""
        SELECT dn.* 
        FROM daily_nav dn
        INNER JOIN (
            SELECT code, max(date) as max_date FROM daily_nav GROUP BY code
        ) latest ON dn.code = latest.code AND dn.date = latest.max_date
    """)
    latest_navs = {row['code']: dict(row) for row in c.fetchall()}
    
    # 获取近1年业绩
    c.execute("SELECT * FROM performance WHERE period = '1y'")
    perf_1y = {row['code']: dict(row) for row in c.fetchall()}
    
    # 获取持仓
    c.execute("SELECT * FROM holdings ORDER BY code, rank")
    holdings_raw = c.fetchall()
    holdings_by_fund = {}
    for h in holdings_raw:
        holdings_by_fund.setdefault(h['code'], []).append(dict(h))
        
    # 获取资产配置
    c.execute("SELECT * FROM asset_alloc")
    asset_alloc_raw = c.fetchall()
    asset_alloc_by_fund = {}
    for a in asset_alloc_raw:
        asset_alloc_by_fund.setdefault(a['code'], []).append(dict(a))

    # 获取地区配置
    c.execute("SELECT * FROM region_alloc")
    region_alloc_raw = c.fetchall()
    region_alloc_by_fund = {}
    for r in region_alloc_raw:
        region_alloc_by_fund.setdefault(r['code'], []).append(dict(r))

    # 获取行业配置
    c.execute("SELECT * FROM industry_alloc")
    ind_alloc_raw = c.fetchall()
    ind_alloc_by_fund = {}
    for i in ind_alloc_raw:
        ind_alloc_by_fund.setdefault(i['code'], []).append(dict(i))

    # -------------------------------------------------------------
    # DIMENSION 1: 零值与缺失异常
    # -------------------------------------------------------------
    for f in funds:
        code = f['code']
        name = f['name']
        
        # 费率缺失/异常
        fee_rate = f['fee_rate']
        if not fee_rate or fee_rate in ['0', '—', 'null', 'undefined'] or '/' not in fee_rate:
            findings["dim1_missing_null"].append({
                "code": code, "name": name, "field": "fee_rate", "value": fee_rate,
                "reason": "管理费/托管费率缺失、未格式化或为空"
            })
            
        # 最新净值缺失
        ln = latest_navs.get(code)
        if not ln:
            findings["dim1_missing_null"].append({
                "code": code, "name": name, "field": "latest_nav", "value": None,
                "reason": "完全缺失 daily_nav 最新净值数据"
            })
        else:
            if ln['nav'] is None or ln['nav'] <= 0:
                findings["dim1_missing_null"].append({
                    "code": code, "name": name, "field": "nav", "value": ln['nav'],
                    "reason": "最新单位净值 <= 0 或为 null"
                })
            if not ln['purchase_status'] or ln['purchase_status'] in ['null', 'undefined', '']:
                findings["dim1_missing_null"].append({
                    "code": code, "name": name, "field": "purchase_status", "value": ln['purchase_status'],
                    "reason": "申购状态字段为空或未定义"
                })

        # 1年收益率缺失 (如果成立满1年但缺失)
        p1 = perf_1y.get(code)
        if not p1 or p1.get('ret') is None:
            # 记录但需进一步排查是否次新基金
            findings["dim1_missing_null"].append({
                "code": code, "name": name, "field": "perf_1y", "value": None,
                "reason": "近1年收益率缺失 (需核实是否为近1年内新发基金)"
            })
            
        # 持仓数据缺失
        h_list = holdings_by_fund.get(code, [])
        if len(h_list) == 0:
            findings["dim1_missing_null"].append({
                "code": code, "name": name, "field": "holdings", "value": 0,
                "reason": "前十大重仓股完全缺失 (0 条记录)"
            })
            
        # 地区分布与行业分布
        r_list = region_alloc_by_fund.get(code, [])
        if len(r_list) == 0:
            findings["dim1_missing_null"].append({
                "code": code, "name": name, "field": "region_alloc", "value": 0,
                "reason": "地区分布完全缺失 (0 条记录)"
            })
        i_list = ind_alloc_by_fund.get(code, [])
        if len(i_list) == 0:
            findings["dim1_missing_null"].append({
                "code": code, "name": name, "field": "industry_alloc", "value": 0,
                "reason": "行业分布完全缺失 (0 条记录)"
            })

    # -------------------------------------------------------------
    # DIMENSION 2: 数学与逻辑悖论
    # -------------------------------------------------------------
    for f in funds:
        code = f['code']
        name = f['name']
        
        # 1. 前十大持仓占比和
        h_list = holdings_by_fund.get(code, [])
        if h_list:
            top10_sum = sum(h.get('pct') or 0 for h in h_list)
            if top10_sum > 100.01:
                findings["dim2_math_paradox"].append({
                    "code": code, "name": name, "metric": "top10_sum", "value": round(top10_sum, 2),
                    "reason": f"前十大重仓股合计占比 {round(top10_sum, 2)}% 超过 100% 物理极限！"
                })
            elif top10_sum < 0:
                findings["dim2_math_paradox"].append({
                    "code": code, "name": name, "metric": "top10_sum", "value": round(top10_sum, 2),
                    "reason": f"前十大重仓股合计占比 {round(top10_sum, 2)}% 为负数！"
                })
                
        # 2. 资产配置之和 (股票+债券+现金+其他+基金) - 存储为 0~1 小数
        a_list = asset_alloc_by_fund.get(code, [])
        if a_list:
            asset_sum = sum(a.get('pct') or 0 for a in a_list)
            # 正常应在 0.80 ~ 1.10 之间 (80% ~ 110%)
            if asset_sum > 1.15 or asset_sum < 0.50:
                findings["dim2_math_paradox"].append({
                    "code": code, "name": name, "metric": "asset_alloc_sum", "value": round(asset_sum, 4),
                    "reason": f"资产配置各项之和异常: {round(asset_sum*100, 2)}% (偏离 100% 超过合理容差)"
                })
                
        # 3. 净值与累计净值 AccNAV < NAV 悖论
        ln = latest_navs.get(code)
        if ln and ln['nav'] is not None and ln['acc_nav'] is not None:
            if ln['acc_nav'] < ln['nav'] - 0.0001:
                findings["dim2_math_paradox"].append({
                    "code": code, "name": name, "metric": "acc_nav_vs_nav",
                    "value": f"NAV={ln['nav']}, AccNAV={ln['acc_nav']}",
                    "reason": f"累计净值 ({ln['acc_nav']}) 小于单位净值 ({ln['nav']})，存在数学逻辑悖论！"
                })

    # -------------------------------------------------------------
    # DIMENSION 3: 跨维度错配与分类错误 (注: region_alloc 存储为小数，如 0.95 代表 95%)
    # -------------------------------------------------------------
    for f in funds:
        code = f['code']
        name = f['name']
        r_list = region_alloc_by_fund.get(code, [])
        r_map = {r['name']: r['pct'] for r in r_list}
        
        # 美股/标普500/纳斯达克/美国
        if any(kw in name for kw in ['标普500', '纳斯达克100', '纳指100', '纳指科技', '美国50', '标普生物', '标普信息']):
            us_pct = (r_map.get('美洲') or 0) + (r_map.get('美国') or 0)
            if us_pct < 0.10 and len(r_list) > 0:
                findings["dim3_mismatch_alloc"].append({
                    "code": code, "name": name, "category": "US_INDEX_MISMATCH",
                    "value": r_map,
                    "reason": f"美股指数基金，但地区分布中美洲占比为 {round(us_pct*100, 2)}% (全部分布: {r_map})"
                })
                
        # 德国/欧洲
        if any(kw in name for kw in ['德国', 'DAX', '欧洲', '法兰克福']):
            eu_pct = (r_map.get('欧洲') or 0) + (r_map.get('德国') or 0)
            if eu_pct < 0.10 and len(r_list) > 0:
                findings["dim3_mismatch_alloc"].append({
                    "code": code, "name": name, "category": "EU_MISMATCH",
                    "value": r_map,
                    "reason": f"德国/欧洲基金，但地区分布中欧洲占比为 {round(eu_pct*100, 2)}% (全部分布: {r_map})"
                })

        # 日本/亚太/恒生/港股
        if any(kw in name for kw in ['日本', '日经', '东证', '亚太', '恒生', '香港', '港股']):
            apac_pct = (r_map.get('亚太') or 0) + (r_map.get('日本') or 0) + (r_map.get('香港') or 0) + (r_map.get('亚洲') or 0)
            if apac_pct < 0.10 and len(r_list) > 0:
                findings["dim3_mismatch_alloc"].append({
                    "code": code, "name": name, "category": "APAC_MISMATCH",
                    "value": r_map,
                    "reason": f"日本/亚太/港股基金，但地区分布中亚太/香港/日本占比为 {round(apac_pct*100, 2)}% (全部分布: {r_map})"
                })

    # -------------------------------------------------------------
    # DIMENSION 4: 数值离群点与常识违背
    # -------------------------------------------------------------
    for f in funds:
        code = f['code']
        name = f['name']
        
        # 1. 收益率离群点
        p1 = perf_1y.get(code)
        if p1 and p1.get('ret') is not None:
            try:
                ret_val = float(p1['ret'])
                if ret_val > 300.0 or ret_val < -90.0:
                    findings["dim4_outliers"].append({
                        "code": code, "name": name, "field": "perf_1y", "value": f"{ret_val}%",
                        "reason": f"近1年收益率 {ret_val}% 存在极端离群值"
                    })
            except:
                pass
                
        # 2. 费率区间
        fee_rate = f['fee_rate'] or ''
        if '/' in fee_rate:
            try:
                parts = fee_rate.split('/')
                mgmt_fee = float(parts[0].replace('%', '').strip())
                cust_fee = float(parts[1].replace('%', '').strip())
                if mgmt_fee > 2.5 or mgmt_fee < 0.05:
                    findings["dim4_outliers"].append({
                        "code": code, "name": name, "field": "mgmt_fee", "value": f"{mgmt_fee}%",
                        "reason": f"管理费率 {mgmt_fee}% 超出公募正常区间 (0.05% ~ 2.5%)"
                    })
                if cust_fee > 0.8 or cust_fee < 0.01:
                    findings["dim4_outliers"].append({
                        "code": code, "name": name, "field": "cust_fee", "value": f"{cust_fee}%",
                        "reason": f"托管费率 {cust_fee}% 超出公募正常区间 (0.01% ~ 0.8%)"
                    })
            except Exception as e:
                findings["dim4_outliers"].append({
                    "code": code, "name": name, "field": "fee_parse_error", "value": fee_rate,
                    "reason": f"费率解析异常: {e}"
                })
                
        # 3. 单日限额异常
        ln = latest_navs.get(code)
        if ln and ln.get('limit_amount') is not None:
            lim = ln['limit_amount']
            if lim < 0:
                findings["dim4_outliers"].append({
                    "code": code, "name": name, "field": "limit_amount", "value": lim,
                    "reason": f"单日申购限额为负数 ({lim})"
                })
            elif lim > 1000000000: # 10亿以上异常大限额或者特殊标记
                pass

    # -------------------------------------------------------------
    # DIMENSION 5: 多份额重复与主代码有效性
    # -------------------------------------------------------------
    # 检查代码格式 (6位数字)
    for f in funds:
        code = f['code']
        name = f['name']
        if not re.match(r'^\d{6}$', code):
            findings["dim5_code_validity"].append({
                "code": code, "name": name, "reason": f"基金代码格式非法 ({code})"
            })
        if f['excluded'] == 1:
            findings["dim5_code_validity"].append({
                "code": code, "name": name, "reason": "基金被标记为 excluded=1"
            })

    # -------------------------------------------------------------
    # DIMENSION 6: 历史报告期陈旧度
    # -------------------------------------------------------------
    c.execute("""
        SELECT h.code, f.name, max(h.report_date) as max_rep
        FROM holdings h
        JOIN funds f ON h.code = f.code
        GROUP BY h.code
    """)
    holding_reps = c.fetchall()
    for row in holding_reps:
        code = row['code']
        name = row['name']
        rep = row['max_rep']
        if rep and rep < '2024-06-30':
            findings["dim6_stale_reports"].append({
                "code": code, "name": name, "type": "holdings", "report_date": rep,
                "reason": f"最新重仓持仓报告期停留于 {rep} (陈旧度 > 1.5年)"
            })
            
    c.execute("""
        SELECT ia.code, f.name, max(ia.report_date) as max_rep
        FROM industry_alloc ia
        JOIN funds f ON ia.code = f.code
        GROUP BY ia.code
    """)
    ind_reps = c.fetchall()
    for row in ind_reps:
        code = row['code']
        name = row['name']
        rep = row['max_rep']
        if rep and rep < '2024-06-30':
            findings["dim6_stale_reports"].append({
                "code": code, "name": name, "type": "industry_alloc", "report_date": rep,
                "reason": f"行业分布报告期停留于 {rep} (陈旧度 > 1.5年)"
            })

    print(f"\n【全量审计扫描统计结果】:")
    for k, v in findings.items():
        print(f"  - {k}: 发现 {len(v)} 项异常/存疑记录")

    return findings

if __name__ == '__main__':
    findings = run_db_inquisition()
    with open('audit_findings.json', 'w', encoding='utf-8') as f:
        json.dump(findings, f, ensure_ascii=False, indent=2)
    print("\n已保存审计扫描结果至 audit_findings.json")
