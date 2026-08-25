import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stem } from '../normalize/shares.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data', 'fund.db');

console.log('====================================================');
console.log('⚡ QDII 基金每日极速增量数据刷新 (Fast Daily Refresh)');
console.log('====================================================\n');

const db = new DatabaseSync(dbPath);
const funds = db.prepare('SELECT code, name, raw_type FROM funds ORDER BY code').all();
console.log(`[目标清单] 全库 ${funds.length} 只基金`);

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

async function fetchLatestNavAndLimit(code) {
    let limit = null;
    let purchaseStatus = '开放申购';
    let latestNav = null;

    // 1. 抓取基金主页 HTML 提取限额与交易状态
    try {
        const res = await fetch(`https://fund.eastmoney.com/${code}.html`, { 
            headers: { ...UA, 'Referer': 'https://fund.eastmoney.com/' } 
        });
        if (res.ok) {
            const html = await res.text();
            
            // 提取限额数值
            const mLimit = html.match(/单日累计购买上限\s*([\d,.]+)\s*(万)?\s*元/i) ||
                           html.match(/单日申购上限\s*([\d,.]+)\s*(万)?\s*元/i) ||
                           html.match(/单日限额\s*([\d,.]+)\s*(万)?\s*元/i) ||
                           html.match(/购买上限\s*([\d,.]+)\s*(万)?\s*元/i);
            
            if (mLimit) {
                let v = parseFloat(mLimit[1].replace(/,/g, ''));
                if (mLimit[2] === '万') v *= 10000;
                if (v > 0) {
                    limit = v;
                    purchaseStatus = '暂停大额申购';
                }
            }

            if (!mLimit) {
                if (html.includes('限大额') || html.includes('暂停大额')) {
                    purchaseStatus = '暂停大额申购';
                } else if (html.includes('暂停申购') || html.includes('暂停交易')) {
                    purchaseStatus = '暂停申购';
                } else if (html.includes('开放申购')) {
                    purchaseStatus = '开放申购';
                } else if (html.includes('认购期')) {
                    purchaseStatus = '认购期';
                } else if (html.includes('封闭期')) {
                    purchaseStatus = '封闭期';
                }
            }
        }
    } catch (e) {}

    // 2. 抓取 lsjz 官方最新交易日净值数据（仅提取日期、净值、涨跌幅，不覆盖主页的限额与限大额状态）
    try {
        const res2 = await fetch(`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`, {
            headers: { ...UA, 'Referer': 'https://fundf10.eastmoney.com/' }
        });
        if (res2.ok) {
            const json2 = await res2.json();
            const latest = json2?.Data?.LSJZList?.[0];
            if (latest) {
                // 若主页未识别到状态，才以 lsjz SGZT 兜底
                if (!purchaseStatus || purchaseStatus === '开放申购') {
                    if (latest.SGZT && (latest.SGZT.includes('暂停') || latest.SGZT.includes('大额'))) {
                        purchaseStatus = latest.SGZT.includes('大额') ? '暂停大额申购' : '暂停申购';
                    }
                }
                latestNav = {
                    date: latest.FSRQ,
                    nav: latest.DWJZ ? parseFloat(latest.DWJZ) : null,
                    accNav: latest.LJJZ ? parseFloat(latest.LJJZ) : null,
                    dailyReturn: latest.JZZZL ? parseFloat(latest.JZZZL) : 0
                };
            }
        }
    } catch (e) {}

    return { code, purchaseStatus, limit, latestNav };
}

const startTime = Date.now();
const BATCH_SIZE = 30;
const crawledResults = new Map();

for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE);
    const promises = batch.map(f => fetchLatestNavAndLimit(f.code));
    const res = await Promise.all(promises);
    for (const r of res) {
        crawledResults.set(r.code, r);
    }
    process.stdout.write(`\r[进度] 并发抓取: ${Math.min(i + BATCH_SIZE, funds.length)} / ${funds.length}...`);
}
console.log(`\n✅ 抓取完毕，耗时 ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

// 基金家族份额联动对齐
const families = {};
for (const f of funds) {
    const k = stem(f.name);
    if (!families[k]) families[k] = [];
    families[k].push({ ...f, ...crawledResults.get(f.code) });
}

db.exec('BEGIN TRANSACTION;');
const updStmt = db.prepare(`
    INSERT OR REPLACE INTO daily_nav (code, date, nav, acc_nav, daily_return, purchase_status, limit_amount, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

let updatedCount = 0;
for (const [k, members] of Object.entries(families)) {
    const rmbMembers = members.filter(m => !m.name.includes('美元') && !m.name.includes('现钞') && !m.name.includes('现汇'));
    const validCanonical = rmbMembers.find(m => m.limit != null && m.limit > 0) || null;
    const isFamilyRestricted = rmbMembers.some(m => m.purchaseStatus === '暂停大额申购');

    for (const m of members) {
        let finalLimit = m.limit;
        let finalStatus = m.purchaseStatus;

        if (validCanonical && !m.name.includes('美元') && !m.name.includes('现钞') && !m.name.includes('现汇')) {
            if (isFamilyRestricted && finalLimit == null) {
                finalLimit = validCanonical.limit;
                finalStatus = '暂停大额申购';
            }
        }
        if (finalStatus === '开放申购' || finalStatus === '暂停申购') {
            finalLimit = null;
        }

        if (m.latestNav && m.latestNav.date && m.latestNav.nav != null) {
            updStmt.run(
                m.code,
                m.latestNav.date,
                m.latestNav.nav,
                m.latestNav.accNav || m.latestNav.nav,
                m.latestNav.dailyReturn || 0,
                finalStatus,
                finalLimit
            );
            updatedCount++;
        }
    }
}
db.exec('COMMIT;');

console.log(`✅ 成功将 ${updatedCount} 条最新净值与真实限额写入 SQLite 数据库！`);
console.log(`🎉 全流程耗时: ${((Date.now() - startTime) / 1000).toFixed(2)}s\n`);
