import sqlite3
import urllib.request
import urllib.parse
import json
import re
import time
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_PATH = 'backend/data/fund.db'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://fund.eastmoney.com/'
}

SAMPLE_FUNDS = [
    # 1. 主动权益
    ('001691', '南方香港成长灵活配置混合', '主动权益'),
    ('000041', '华夏全球股票(QDII)(人民币)', '主动权益'),
    ('000157', '富国全球科技互联网股票(QDII)A(后端)', '主动权益'),
    ('000043', '嘉实美国成长股票人民币', '主动权益'),
    ('001668', '汇添富全球移动互联混合(QDII)人民币A', '主动权益'),
    # 2. 标普500/纳指科技指数
    ('270042', '广发纳斯达克100ETF联接人民币(QDII)A', '标普/纳指指数'),
    ('050025', '博时标普500ETF联接A', '标普/纳指指数'),
    ('017436', '华宝纳斯达克精选股票发起式(QDII)A', '标普/纳指指数'),
    ('160416', '华安标普全球石油指数(LOF)A', '标普/纳指指数'),
    ('000834', '大成纳斯达克100ETF联接(QDII)A', '标普/纳指指数'),
    # 3. C类免申购费份额
    ('006479', '广发纳斯达克100ETF联接人民币(QDII)C', 'C类免申购费'),
    ('019548', '招商纳斯达克100ETF发起式联接(QDII)C', 'C类免申购费'),
    ('012349', '天弘恒生科技ETF联接C', 'C类免申购费'),
    ('013508', '广发亚太中高收益债(QDII)C', 'C类免申购费'),
    ('018337', '华夏恒生中国企业ETF发起式联接(QDII)C', 'C类免申购费'),
    # 4. 纯债及QDII债券
    ('000103', '国泰境外高收益债(QDII)', '纯债/高收益债'),
    ('000163', '富国全球债券(QDII)人民币A(后端)', '纯债/高收益债'),
    ('000274', '广发亚太中高收益债(QDII)A', '纯债/高收益债'),
    ('000290', '鹏华全球高收益债(QDII)', '纯债/高收益债'),
    ('002286', '中银美元债债券(QDII)人民币A', '纯债/高收益债'),
    # 5. 外币美元/港币份额
    ('000044', '嘉实美国成长股票美元现汇', '外币美元/港币份额'),
    ('000055', '广发纳斯达克100ETF联接美元(QDII)A', '外币美元/港币份额'),
    ('000075', '华夏恒生ETF联接现汇', '外币美元/港币份额'),
    ('000275', '广发亚太中高收益债美元现汇(QDII)A', '外币美元/港币份额'),
    ('002287', '中银美元债债券(QDII)美元', '外币美元/港币份额'),
    # 6. 商品原油/黄金/另类
    ('160216', '国泰大宗商品(QDII-LOF)A', '商品/黄金/另类'),
    ('160719', '嘉实黄金', '商品/黄金/另类'),
    ('161129', '易方达原油A类人民币', '商品/黄金/另类'),
    ('320013', '诺安全球黄金(QDII-FOF)A', '商品/黄金/另类'),
    ('000179', '广发美国房地产指数人民币(QDII)A', '商品/黄金/另类'),
    # 7. 日本/欧洲/亚太/新兴市场
    ('000071', '华夏恒生ETF联接A', '全球/区域指数'),
    ('000614', '华安德国30(DAX)ETF联接(QDII)A', '全球/区域指数'),
    ('006327', '易方达MSCI日本(QDII-ETF联接)A', '全球/区域指数'),
    ('000341', '嘉实新兴市场C2(QDII)', '全球/区域指数')
]

def fetch_url(url, timeout=10):
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.read().decode('utf-8', errors='ignore')
    except Exception as e:
        # print(f"Error fetching {url}: {e}")
        return None

def scrape_fund_independent(code):
    """
    独立编写的东财数据爬虫与解析器，完全与项目已有代码库隔离
    """
    res = {
        'code': code,
        'live_nav': None,
        'live_acc_nav': None,
        'live_nav_date': None,
        'live_purchase_status': None,
        'live_limit_amount': None,
        'live_fee_mgmt': None,
        'live_fee_cust': None,
        'live_fee_rate': None,
        'live_ret_1y': None,
        'live_top5_holdings': [],
        'error': None
    }
    
    try:
        # 1. 获取最新净值、累计净值、申购状态与限额 (通过 lsjz API)
        lsjz_url = f'https://api.fund.eastmoney.com/f10/lsjz?fundCode={code}&pageIndex=1&pageSize=1'
        lsjz_json = fetch_url(lsjz_url)
        if lsjz_json:
            data = json.loads(lsjz_json)
            lsjz_list = data.get('Data', {}).get('LSJZList', [])
            if lsjz_list:
                item = lsjz_list[0]
                res['live_nav_date'] = item.get('FSRQ')
                try:
                    res['live_nav'] = float(item.get('DWJZ')) if item.get('DWJZ') else None
                except:
                    pass
                try:
                    res['live_acc_nav'] = float(item.get('LJJZ')) if item.get('LJJZ') else None
                except:
                    pass
                res['live_purchase_status'] = item.get('SGZT')
                
        # 2. 从 pingzhongdata 获取近1年回报与限额 fsi_money
        pz_url = f'https://fund.eastmoney.com/pingzhongdata/{code}.js'
        pz_js = fetch_url(pz_url)
        if pz_js:
            m_1n = re.search(r'var\s+syl_1n\s*=\s*\"([^\"]*)\"', pz_js)
            if m_1n and m_1n.group(1):
                try:
                    res['live_ret_1y'] = float(m_1n.group(1))
                except:
                    pass
            m_limit = re.search(r'var\s+fsi_money\s*=\s*\"([^\"]*)\"', pz_js)
            if m_limit and m_limit.group(1):
                try:
                    res['live_limit_amount'] = float(m_limit.group(1))
                except:
                    pass
                    
        # 3. 从 jjfl 页面抓取费率
        jjfl_url = f'https://fundf10.eastmoney.com/jjfl_{code}.html'
        jjfl_html = fetch_url(jjfl_url)
        if jjfl_html:
            m_mgmt = re.search(r'管理费率\s*</td>\s*<td[^>]*>\s*([\d\.]+)%', jjfl_html)
            if not m_mgmt:
                m_mgmt = re.search(r'管理费率.*?([\d\.]+)%', jjfl_html, re.S)
            if m_mgmt:
                res['live_fee_mgmt'] = f"{float(m_mgmt.group(1)):.2f}%"
                
            m_cust = re.search(r'托管费率\s*</td>\s*<td[^>]*>\s*([\d\.]+)%', jjfl_html)
            if not m_cust:
                m_cust = re.search(r'托管费率.*?([\d\.]+)%', jjfl_html, re.S)
            if m_cust:
                res['live_fee_cust'] = f"{float(m_cust.group(1)):.2f}%"
                
            if res['live_fee_mgmt'] and res['live_fee_cust']:
                res['live_fee_rate'] = f"{res['live_fee_mgmt']} / {res['live_fee_cust']}"
                
        # 4. 从 FundArchivesDatas jjcc 抓取 Top 5 重仓持仓
        jjcc_url = f'https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code={code}&topline=10&year=&month='
        jjcc_raw = fetch_url(jjcc_url)
        if jjcc_raw:
            m = re.search(r'content:\"(.*)\"', jjcc_raw)
            if m:
                raw_content = m.group(1)
                soup = BeautifulSoup(raw_content, 'html.parser')
                tables = soup.find_all('table')
                if tables:
                    for tr in tables[0].find_all('tr')[1:6]:
                        tds = [td.get_text(strip=True) for td in tr.find_all('td')]
                        if len(tds) >= 7:
                            rank = int(tds[0]) if tds[0].isdigit() else len(res['live_top5_holdings']) + 1
                            symbol = tds[1]
                            stock_name = tds[2]
                            pct_str = tds[6].replace('%', '').strip()
                            try:
                                pct = float(pct_str)
                            except:
                                pct = None
                            res['live_top5_holdings'].append({
                                'rank': rank,
                                'symbol': symbol,
                                'name': stock_name,
                                'pct': pct
                            })
    except Exception as e:
        res['error'] = str(e)
        
    return res

def run_cross_verification():
    print("="*80)
    print("【DATA INQUISITOR】启动独立双盲背对背全量/抽样数据拉取与硬核交叉比对")
    print(f"抽样基金总数: {len(SAMPLE_FUNDS)} 只，覆盖 7 大资产与份额类别")
    print("="*80)
    
    # 1. 独立并行抓取东财最新数据
    start_time = time.time()
    live_data_map = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_fund = {
            executor.submit(scrape_fund_independent, f[0]): f for f in SAMPLE_FUNDS
        }
        for future in as_completed(future_to_fund):
            fund_info = future_to_fund[future]
            try:
                res = future.result()
                live_data_map[res['code']] = res
                print(f"[LIVE SCRAPE OK] {res['code']} - {fund_info[1]}")
            except Exception as e:
                print(f"[LIVE SCRAPE FAIL] {fund_info[0]} - {fund_info[1]}: {e}")
                
    elapsed = time.time() - start_time
    print(f"\n独立抓取完成，耗时 {elapsed:.2f} 秒，成功抓取 {len(live_data_map)} / {len(SAMPLE_FUNDS)}")
    
    # 2. 读取本地 SQLite 数据库数据
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    
    comparison_results = []
    
    field_stats = {
        'nav': {'match': 0, 'diff': 0, 'db_missing': 0, 'live_missing': 0},
        'acc_nav': {'match': 0, 'diff': 0, 'db_missing': 0, 'live_missing': 0},
        'fee_rate': {'match': 0, 'diff': 0, 'db_missing': 0, 'live_missing': 0},
        'purchase_status': {'match': 0, 'diff': 0, 'db_missing': 0, 'live_missing': 0},
        'limit_amount': {'match': 0, 'diff': 0, 'db_missing': 0, 'live_missing': 0},
        'ret_1y': {'match': 0, 'diff': 0, 'db_missing': 0, 'live_missing': 0},
        'top5_holdings': {'match': 0, 'diff': 0, 'db_missing': 0, 'live_missing': 0}
    }
    
    for code, name, category in SAMPLE_FUNDS:
        live = live_data_map.get(code, {})
        
        # 查 DB 基础信息
        f_db = c.execute("SELECT * FROM funds WHERE code = ?", (code,)).fetchone()
        
        # 查 DB 最新净值
        dn_db = c.execute("SELECT * FROM daily_nav WHERE code = ? ORDER BY date DESC LIMIT 1", (code,)).fetchone()
        
        # 查 DB 近1年回报
        perf_db = c.execute("SELECT * FROM performance WHERE code = ? AND period = '1y'", (code,)).fetchone()
        
        # 查 DB Top 5 持仓
        h_db = c.execute("SELECT * FROM holdings WHERE code = ? ORDER BY rank ASC LIMIT 5", (code,)).fetchall()
        db_holdings = [dict(h) for h in h_db]
        
        comp = {
            'code': code,
            'name': name,
            'category': category,
            'fields': {}
        }
        
        # 1. NAV 对比
        db_nav = dn_db['nav'] if dn_db else None
        live_nav = live.get('live_nav')
        if db_nav is None:
            field_stats['nav']['db_missing'] += 1
            comp['fields']['nav'] = {'status': 'DB_MISSING', 'db': db_nav, 'live': live_nav}
        elif live_nav is None:
            field_stats['nav']['live_missing'] += 1
            comp['fields']['nav'] = {'status': 'LIVE_MISSING', 'db': db_nav, 'live': live_nav}
        elif abs(db_nav - live_nav) < 0.0001:
            field_stats['nav']['match'] += 1
            comp['fields']['nav'] = {'status': 'MATCH', 'db': db_nav, 'live': live_nav}
        else:
            field_stats['nav']['diff'] += 1
            comp['fields']['nav'] = {'status': 'DIFF', 'db': db_nav, 'live': live_nav, 'diff': round(db_nav - live_nav, 4)}
            
        # 2. AccNAV 对比
        db_acc_nav = dn_db['acc_nav'] if dn_db else None
        live_acc_nav = live.get('live_acc_nav')
        if db_acc_nav is None:
            field_stats['acc_nav']['db_missing'] += 1
            comp['fields']['acc_nav'] = {'status': 'DB_MISSING', 'db': db_acc_nav, 'live': live_acc_nav}
        elif live_acc_nav is None:
            field_stats['acc_nav']['live_missing'] += 1
            comp['fields']['acc_nav'] = {'status': 'LIVE_MISSING', 'db': db_acc_nav, 'live': live_acc_nav}
        elif abs(db_acc_nav - live_acc_nav) < 0.0001:
            field_stats['acc_nav']['match'] += 1
            comp['fields']['acc_nav'] = {'status': 'MATCH', 'db': db_acc_nav, 'live': live_acc_nav}
        else:
            field_stats['acc_nav']['diff'] += 1
            comp['fields']['acc_nav'] = {'status': 'DIFF', 'db': db_acc_nav, 'live': live_acc_nav, 'diff': round(db_acc_nav - live_acc_nav, 4)}
            
        # 3. Fee Rate 对比
        db_fee_rate = f_db['fee_rate'] if f_db else None
        live_fee_rate = live.get('live_fee_rate')
        if db_fee_rate is None:
            field_stats['fee_rate']['db_missing'] += 1
            comp['fields']['fee_rate'] = {'status': 'DB_MISSING', 'db': db_fee_rate, 'live': live_fee_rate}
        elif live_fee_rate is None:
            field_stats['fee_rate']['live_missing'] += 1
            comp['fields']['fee_rate'] = {'status': 'LIVE_MISSING', 'db': db_fee_rate, 'live': live_fee_rate}
        elif db_fee_rate.strip() == live_fee_rate.strip():
            field_stats['fee_rate']['match'] += 1
            comp['fields']['fee_rate'] = {'status': 'MATCH', 'db': db_fee_rate, 'live': live_fee_rate}
        else:
            field_stats['fee_rate']['diff'] += 1
            comp['fields']['fee_rate'] = {'status': 'DIFF', 'db': db_fee_rate, 'live': live_fee_rate}
            
        # 4. Purchase Status 对比
        db_ps = dn_db['purchase_status'] if dn_db else None
        live_ps = live.get('live_purchase_status')
        if db_ps is None:
            field_stats['purchase_status']['db_missing'] += 1
            comp['fields']['purchase_status'] = {'status': 'DB_MISSING', 'db': db_ps, 'live': live_ps}
        elif live_ps is None:
            field_stats['purchase_status']['live_missing'] += 1
            comp['fields']['purchase_status'] = {'status': 'LIVE_MISSING', 'db': db_ps, 'live': live_ps}
        elif db_ps.strip() == live_ps.strip():
            field_stats['purchase_status']['match'] += 1
            comp['fields']['purchase_status'] = {'status': 'MATCH', 'db': db_ps, 'live': live_ps}
        else:
            field_stats['purchase_status']['diff'] += 1
            comp['fields']['purchase_status'] = {'status': 'DIFF', 'db': db_ps, 'live': live_ps}
            
        # 5. Limit Amount 对比
        db_limit = dn_db['limit_amount'] if dn_db else None
        live_limit = live.get('live_limit_amount')
        # 统一处理 0 与 None 或限额一致性
        if db_limit == live_limit or (db_limit in [0, None] and live_limit in [0, None]):
            field_stats['limit_amount']['match'] += 1
            comp['fields']['limit_amount'] = {'status': 'MATCH', 'db': db_limit, 'live': live_limit}
        elif db_limit is None:
            field_stats['limit_amount']['db_missing'] += 1
            comp['fields']['limit_amount'] = {'status': 'DB_MISSING', 'db': db_limit, 'live': live_limit}
        elif live_limit is None:
            field_stats['limit_amount']['live_missing'] += 1
            comp['fields']['limit_amount'] = {'status': 'LIVE_MISSING', 'db': db_limit, 'live': live_limit}
        elif abs(db_limit - live_limit) < 1.0:
            field_stats['limit_amount']['match'] += 1
            comp['fields']['limit_amount'] = {'status': 'MATCH', 'db': db_limit, 'live': live_limit}
        else:
            field_stats['limit_amount']['diff'] += 1
            comp['fields']['limit_amount'] = {'status': 'DIFF', 'db': db_limit, 'live': live_limit}

        # 6. 1Y Return 对比
        db_ret = float(perf_db['ret']) if (perf_db and perf_db['ret'] is not None) else None
        live_ret = live.get('live_ret_1y')
        if db_ret is None and live_ret is None:
            field_stats['ret_1y']['match'] += 1
            comp['fields']['ret_1y'] = {'status': 'MATCH_BOTH_NULL', 'db': db_ret, 'live': live_ret}
        elif db_ret is None:
            field_stats['ret_1y']['db_missing'] += 1
            comp['fields']['ret_1y'] = {'status': 'DB_MISSING', 'db': db_ret, 'live': live_ret}
        elif live_ret is None:
            field_stats['ret_1y']['live_missing'] += 1
            comp['fields']['ret_1y'] = {'status': 'LIVE_MISSING', 'db': db_ret, 'live': live_ret}
        elif abs(db_ret - live_ret) < 0.05:
            field_stats['ret_1y']['match'] += 1
            comp['fields']['ret_1y'] = {'status': 'MATCH', 'db': db_ret, 'live': live_ret}
        else:
            field_stats['ret_1y']['diff'] += 1
            comp['fields']['ret_1y'] = {'status': 'DIFF', 'db': db_ret, 'live': live_ret, 'diff': round(db_ret - live_ret, 2)}

        # 7. Top 5 Holdings 对比
        live_h = live.get('live_top5_holdings', [])
        # 对比数量与前3大重仓名称和占比
        if len(db_holdings) == 0 and len(live_h) == 0:
            field_stats['top5_holdings']['match'] += 1
            comp['fields']['top5_holdings'] = {'status': 'MATCH_BOTH_EMPTY', 'db': [], 'live': []}
        elif len(db_holdings) == 0:
            field_stats['top5_holdings']['db_missing'] += 1
            comp['fields']['top5_holdings'] = {'status': 'DB_MISSING', 'db': [], 'live': [x['name'] for x in live_h]}
        elif len(live_h) == 0:
            field_stats['top5_holdings']['live_missing'] += 1
            comp['fields']['top5_holdings'] = {'status': 'LIVE_MISSING', 'db': [x['name'] for x in db_holdings], 'live': []}
        else:
            # 检查前3大重仓名称与占比容差
            match_all = True
            diff_details = []
            for i in range(min(len(db_holdings), len(live_h))):
                dbh = db_holdings[i]
                lvh = live_h[i]
                # 检查名称或代码
                name_match = (dbh['name'].strip() == lvh['name'].strip()) or (dbh['symbol'].strip() == lvh['symbol'].strip())
                pct_match = abs((dbh['pct'] or 0) - (lvh['pct'] or 0)) < 0.2
                if not (name_match and pct_match):
                    match_all = False
                    diff_details.append({
                        'rank': i+1,
                        'db': f"{dbh['name']}({dbh['pct']}%)",
                        'live': f"{lvh['name']}({lvh['pct']}%)"
                    })
            if match_all:
                field_stats['top5_holdings']['match'] += 1
                comp['fields']['top5_holdings'] = {'status': 'MATCH', 'count': len(db_holdings)}
            else:
                field_stats['top5_holdings']['diff'] += 1
                comp['fields']['top5_holdings'] = {'status': 'DIFF', 'diffs': diff_details}

        comparison_results.append(comp)

    return comparison_results, field_stats

if __name__ == '__main__':
    results, stats = run_cross_verification()
    with open('cross_verification_report.json', 'w', encoding='utf-8') as f:
        json.dump({'stats': stats, 'results': results}, f, ensure_ascii=False, indent=2)
    print("\n比对完成！统计数据:")
    for k, v in stats.items():
        print(f"  {k:16s}: MATCH={v['match']}, DIFF={v['diff']}, DB_MISSING={v['db_missing']}, LIVE_MISSING={v['live_missing']}")
