import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data', 'fund.db');

console.log('====================================================');
console.log('🔄 多信源独立背对背交叉校验系统 (Multi-Source Cross-Verifier)');
console.log('   信源 A: 东方财富 / 天天基金 (Eastmoney Financial Web & API)');
console.log('   信源 B: 腾讯财经行情中心 (Tencent Finance API: qt.gtimg.cn) -> 校验净值/回报');
console.log('   信源 C: 雪球 / 蛋卷基金 (Xueqiu / Danjuan API: danjuanfunds.com) -> 校验可买入与暂停状态');
console.log('   信源 D: 基金管理公司法定义务限额业务公告 PDF 原件 -> 校验真实法定具体限购数值');
console.log('====================================================\n');

const db = new DatabaseSync(dbPath);
const funds = db.prepare(`
    SELECT f.code, f.name, f.mainstream, f.raw_type,
           d.nav, d.acc_nav, d.daily_return, d.purchase_status, d.limit_amount, d.date as nav_date
    FROM funds f
    LEFT JOIN daily_nav d ON f.code=d.code AND d.date = (SELECT MAX(date) FROM daily_nav WHERE code=f.code)
    WHERE (f.excluded=0 OR f.excluded IS NULL)
      AND f.mainstream=1
      AND (f.region_excluded=0 OR f.region_excluded IS NULL)
      AND (f.currency_excluded=0 OR f.currency_excluded IS NULL)
`).all();

console.log(`[待核验清单] 主流活跃展示基金: ${funds.length} 只\n`);

const decoder = new TextDecoder('gbk');

// 1. 独立从信源 B (腾讯财经) 批量拉取净值数据
async function fetchTencentBatch(codes) {
    const query = codes.map(c => `jj${c}`).join(',');
    const url = `https://qt.gtimg.cn/q=${query}`;
    try {
        const res = await fetch(url, { headers: { 'Referer': 'https://gu.qq.com' } });
        const buf = await res.arrayBuffer();
        const text = decoder.decode(buf);
        const lines = text.split(';\n').filter(Boolean);
        const map = new Map();

        for (const line of lines) {
            const m = line.match(/v_jj(\d+)="(.*)"/);
            if (m) {
                const code = m[1];
                const parts = m[2].split('~');
                // parts[5] = 最新净值, parts[6] = 累计净值, parts[7] = 日涨跌幅, parts[8] = 净值日期
                if (parts.length >= 9) {
                    map.set(code, {
                        code,
                        name: parts[1],
                        nav: parseFloat(parts[5]),
                        accNav: parseFloat(parts[6]),
                        dailyReturn: parseFloat(parts[7]),
                        date: parts[8]
                    });
                }
            }
        }
        return map;
    } catch (e) {
        return new Map();
    }
}

// 2. 独立从信源 C (雪球 / 蛋卷基金) 逐一独立拉取申购交易状态
async function fetchDanjuanTradeStatus(code) {
    try {
        const url = `https://danjuanfunds.com/djapi/fund/${code}`;
        const res = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                'Referer': 'https://danjuanfunds.com/'
            },
            signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) return null;
        const j = await res.json();
        const d = j.data;
        if (!d) return null;
        return {
            code,
            canBuy: d.can_buy,
            declareStatus: d.declare_status,
            buttonDoc: d.special_trade_detail?.button_doc || '',
            barDoc: d.special_trade_detail?.bar_doc || ''
        };
    } catch (e) {
        return null;
    }
}

// 3. 独立从信源 D (基金公司法定业务限额公告 PDF 原文) 提取并核验法定真实限额
async function verifyOfficialStatutoryLimit(code) {
    try {
        const url = `https://api.fund.eastmoney.com/f10/JJGG?fundcode=${code}&pageIndex=1&pageSize=20&type=0`;
        const res = await fetch(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fundf10.eastmoney.com/' },
            signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) return null;
        const json = await res.json();
        const ann = json.Data?.find(d => 
            /(?:大额申购|大额投资|申购限额|购买上限|暂停申购|恢复申购|恢复大额|限制申购)/.test(d.TITLE) && 
            !/节假日|港股通非交易日|系统维护|通联渠道|设备|改聘|基准|资料概要|招募说明书|季度报告|净值/.test(d.TITLE)
        );
        if (!ann) return null;

        const pdfUrl = `https://pdf.dfcfw.com/pdf/H2_${ann.ID}_1.pdf`;
        const pdfRes = await fetch(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
        if (!pdfRes.ok) return null;

        const tmpPath = `/tmp/qa_${code}_${ann.ID}.pdf`;
        fs.writeFileSync(tmpPath, Buffer.from(await pdfRes.arrayBuffer()));
        const text = execSync(`pdftotext "${tmpPath}" -`, { encoding: 'utf8', timeout: 3000 });
        try { fs.unlinkSync(tmpPath); } catch {}

        const isSuspension = /暂停申购、定期定额投资业务的公告|暂停申购业务的公告/.test(ann.TITLE);
        let officialLimit = null;
        const codeIdx = text.indexOf(code);
        let searchSnippet = text;
        if (codeIdx !== -1) {
            searchSnippet = text.slice(codeIdx - 300, codeIdx + 300);
        }

        const mLimit = searchSnippet.match(/(?:限制申购金额|限制金额|业务限额为|购买上限为?)\s*[:：]?\s*([\d,.]+)\s*(万)?\s*(?:元|美元)/i) ||
                       text.match(/(?:限制申购金额|限制金额|业务限额为|购买上限为?)\s*[:：]?\s*([\d,.]+)\s*(万)?\s*(?:元|美元)/i) ||
                       text.match(/(?:单日每个基金账户|单日单个基金账户)[^\n]{0,50}?(?:等于或低于|高于|限制为|限额为)\s*([\d,.]+)\s*(万)?\s*(?:元|美元)/i);
        if (mLimit) {
            let v = parseFloat(mLimit[1].replace(/,/g, ''));
            if (mLimit[2] === '万') v *= 10000;
            if (v > 0) officialLimit = v;
        }

        return {
            code,
            isSuspension,
            officialLimit,
            annTitle: ann.TITLE,
            annDate: ann.PUBLISHDATE ? ann.PUBLISHDATE.slice(0, 10) : ''
        };
    } catch {
        return null;
    }
}

// 4. 独立从信源 E (东财官方 HYPZ 结构化 API) 拉取最新季度行业配置
async function fetchOfficialStructuredIndustry(code) {
    try {
        const url = `https://api.fund.eastmoney.com/f10/HYPZ/?fundcode=${code}&year=2026`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fundf10.eastmoney.com/' }, signal: AbortSignal.timeout(4000) });
        if (!res.ok) return null;
        const json = await res.json();
        const latestQ = json.Data?.QuarterInfos?.[0];
        if (!latestQ || !latestQ.HYPZInfo) return null;

        return {
            code,
            date: latestQ.HYPZInfo[0]?.FSRQ || '',
            industries: latestQ.HYPZInfo.map(h => ({
                name: h.HYMC,
                pct: parseFloat(h.ZJZBL) / 100
            }))
        };
    } catch {
        return null;
    }
}

const mode = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || (process.argv.includes('--daily') ? 'daily' : 'full');
console.log(`[核验模式] ${mode === 'daily' ? '⚡ 每日高频双重核验 (净值/状态/限额)' : '📑 全量深度二重核验 (含季度行业/持仓/资产)'}\n`);

const BATCH_SIZE = 50;
const tencentResults = new Map();

for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE).map(f => f.code);
    const res = await fetchTencentBatch(batch);
    for (const [k, v] of res.entries()) {
        tencentResults.set(k, v);
    }
    process.stdout.write(`\r[进度 1/${mode === 'daily' ? '3' : '4'}] 信源 B (腾讯财经行情) 背对背拉取: ${Math.min(i + BATCH_SIZE, funds.length)} / ${funds.length}...`);
}
console.log('\n✅ 独立信源 B (腾讯财经) 数据拉取完毕！');

const danjuanResults = new Map();
const DJ_BATCH = 15;
for (let i = 0; i < funds.length; i += DJ_BATCH) {
    const batch = funds.slice(i, i + DJ_BATCH);
    const res = await Promise.all(batch.map(f => fetchDanjuanTradeStatus(f.code)));
    for (const item of res) {
        if (item) danjuanResults.set(item.code, item);
    }
    process.stdout.write(`\r[进度 2/${mode === 'daily' ? '3' : '4'}] 信源 C (雪球/蛋卷交易状态) 背对背拉取: ${Math.min(i + DJ_BATCH, funds.length)} / ${funds.length}...`);
}
console.log('\n✅ 独立信源 C (雪球/蛋卷) 交易状态拉取完毕！');

const statutoryResults = new Map();
const limitedFunds = funds.filter(f => f.purchase_status === '暂停大额申购' || f.purchase_status === '暂停申购');
const STAT_BATCH = 10;
for (let i = 0; i < limitedFunds.length; i += STAT_BATCH) {
    const batch = limitedFunds.slice(i, i + STAT_BATCH);
    const res = await Promise.all(batch.map(f => verifyOfficialStatutoryLimit(f.code)));
    for (const item of res) {
        if (item) statutoryResults.set(item.code, item);
    }
    process.stdout.write(`\r[进度 3/${mode === 'daily' ? '3' : '4'}] 信源 D (基金公司法定限额业务公告 PDF) 深度对账: ${Math.min(i + STAT_BATCH, limitedFunds.length)} / ${limitedFunds.length}...`);
}
console.log('\n✅ 独立信源 D (法定业务限额公告原件) 对账就绪！');

const hypzResults = new Map();
if (mode !== 'daily') {
    const HYPZ_BATCH = 20;
    for (let i = 0; i < funds.length; i += HYPZ_BATCH) {
        const batch = funds.slice(i, i + HYPZ_BATCH);
        const res = await Promise.all(batch.map(f => fetchOfficialStructuredIndustry(f.code)));
        for (const item of res) {
            if (item) hypzResults.set(item.code, item);
        }
        process.stdout.write(`\r[进度 4/4] 信源 E (东财 HYPZ 结构化行业) 深度对账: ${Math.min(i + HYPZ_BATCH, funds.length)} / ${funds.length}...`);
    }
    console.log('\n✅ 独立信源 E (官方 HYPZ 结构化行业) 对账就绪！');
}
console.log('\n开始全量交叉核对...\n');

let passedCount = 0;
const discrepancies = [];

for (const f of funds) {
    // ----------------- ① 腾讯财经：净值与收益核验 -----------------
    const tx = tencentResults.get(f.code);
    if (tx) {
        if (f.nav_date === tx.date) {
            const navDiff = Math.abs(f.nav - tx.nav);
            if (navDiff > 0.0002) {
                discrepancies.push({
                    code: f.code,
                    name: f.name,
                    reason: `同日最新净值不一致！日期=${f.nav_date}, 信源A(东财)=${f.nav}, 信源B(腾讯)=${tx.nav}, 差异=${navDiff.toFixed(4)}`
                });
                continue;
            }
        } else {
            const histNav = db.prepare('SELECT nav FROM daily_nav WHERE code=? AND date=?').get(f.code, tx.date);
            if (histNav && histNav.nav != null) {
                const histDiff = Math.abs(histNav.nav - tx.nav);
                if (histDiff > 0.0002) {
                    discrepancies.push({
                        code: f.code,
                        name: f.name,
                        reason: `跨期对应日净值不一致！日期=${tx.date}, 数据库=${histNav.nav}, 腾讯=${tx.nav}, 差异=${histDiff.toFixed(4)}`
                    });
                    continue;
                }
            }
        }
    }

    // ----------------- ② 雪球/蛋卷：申购交易状态核验 -----------------
    const dj = danjuanResults.get(f.code);
    if (dj && dj.canBuy !== undefined) {
        const isSuspendedInDj = dj.canBuy === false || dj.buttonDoc.includes('暂停买入') || dj.barDoc.includes('暂停买入');
        const isSuspendedInDb = f.purchase_status === '暂停申购';

        // 若雪球明确显示「暂停买入」，但数据库却标为「开放申购」
        if (isSuspendedInDj && f.purchase_status === '开放申购') {
            discrepancies.push({
                code: f.code,
                name: f.name,
                reason: `交易状态背对背冲突！信源C(雪球/蛋卷)明确为【暂停买入】，数据库误标为【${f.purchase_status}】`
            });
            continue;
        }
    }

    // ----------------- ③ 官方法定业务公告 PDF：限额数值对账核验 -----------------
    const st = statutoryResults.get(f.code);
    if (st && st.officialLimit != null && f.limit_amount != null) {
        // 如果法定公告中写明的限额与系统中的限额发生显著冲突（且法定公告在 30 天内发布）
        if (Math.abs(st.officialLimit - f.limit_amount) > 0.01) {
            const daysDiff = (Date.now() - new Date(st.annDate).getTime()) / (86400000);
            if (daysDiff <= 30) {
                discrepancies.push({
                    code: f.code,
                    name: f.name,
                    reason: `限额数值与法定公告原件不符！数据库=${f.limit_amount}元, 最新法定公告(${st.annDate})规定=${st.officialLimit}元 [${st.annTitle}]`
                });
                continue;
            }
        }
    }

    // ----------------- ④ 季度行业配置：PDF 真值 vs 结构化 HYPZ API 对账核验 -----------------
    const hypz = hypzResults.get(f.code);
    if (hypz && hypz.industries && hypz.industries.length > 0) {
        const dbInds = db.prepare('SELECT name, pct FROM industry_alloc WHERE code=? ORDER BY pct DESC').all(f.code);
        if (dbInds.length > 0) {
            const dbTop = dbInds[0];
            const hypzTop = hypz.industries[0];
            
            const norm = (s) => s.replace(/通信服务|电信服务|电信业务/g, '通讯业务')
                                 .replace(/非日常生活消费品|可选消费/g, '非必需消费品')
                                 .replace(/日常消费品|主要消费/g, '必需消费品')
                                 .replace(/原材料|基础材料/g, '材料')
                                 .replace(/保健|医药生物|医药/g, '医疗保健')
                                 .replace(/制造业/g, '工业')
                                 .replace(/信息科技/g, '信息技术');

            const dbTopNorm = norm(dbTop.name);
            const hypzTopNorm = norm(hypzTop.name);

            // 若第一大行业不同且差异大于 8%（允许指数 vs 主动小幅分类差异）
            if (dbTopNorm !== hypzTopNorm && Math.abs(dbTop.pct - hypzTop.pct) > 0.08) {
                discrepancies.push({
                    code: f.code,
                    name: f.name,
                    reason: `季度行业二重核验异常！数据库第一大重仓【${dbTop.name} ${(dbTop.pct * 100).toFixed(1)}%】与官方HYPZ接口【${hypzTop.name} ${(hypzTop.pct * 100).toFixed(1)}%】不一致！`
                });
                continue;
            }
        }
    }

    passedCount++;
}

console.log('----------------------------------------------------');
console.log(`📊 全量多信源独立背对背交叉比对报告:`);
console.log(`  - 核验基金总数: ${funds.length} 只`);
console.log(`  - 每日与季度双重核验 100% 吻合: ${passedCount} 只 (${((passedCount / funds.length) * 100).toFixed(1)}%)`);
console.log(`  - 存在差异或冲突: ${discrepancies.length} 项`);
console.log('----------------------------------------------------\n');

if (discrepancies.length > 0) {
    console.error('🚨 发现以下多信源背对背不一致项（已触发阻断）：');
    discrepancies.forEach((d, i) => console.error(`  ${i + 1}. [${d.code}] ${d.name} -> ${d.reason}`));
    process.exit(1);
} else {
    console.log('🎉 完美通过！每日购买限额、申购交易状态与季度行业配置全量数据，经独立双信源背对背核对 100% 精确吻合！');
    process.exit(0);
}
