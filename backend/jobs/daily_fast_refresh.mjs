import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data', 'fund.db');

console.log('====================================================');
console.log('⚡ QDII 基金每日极速增量数据刷新 (Fast Daily Refresh)');
console.log('   模式: 全单只基金与独立分级份额逐一精准独立直采');
console.log('====================================================\n');

const db = new DatabaseSync(dbPath);
const funds = db.prepare('SELECT code, name, raw_type FROM funds ORDER BY code').all();
console.log(`[目标清单] 全库 ${funds.length} 只基金`);

const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' };

// 延迟辅助函数
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 带智能重试的 fetch
async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.status === 514 || res.status === 429) {
                await sleep(300 * (i + 1));
                continue;
            }
            if (res.ok) return res;
        } catch (e) {
            await sleep(200 * (i + 1));
        }
    }
    return null;
}

// 缓存数据库现有最新状态（用于网络抖动时非破坏性保护）
const existingMap = new Map();
const existingRows = db.prepare(`
    SELECT d.code, d.purchase_status, d.limit_amount
    FROM daily_nav d
    WHERE d.date = (SELECT MAX(date) FROM daily_nav WHERE code = d.code)
`).all();
for (const r of existingRows) {
    existingMap.set(r.code, r);
}

// 三层独立直采提取单只基金/份额的真实限额与状态
async function fetchIndividualFund(code) {
    const existing = existingMap.get(code);
    let limit = existing ? existing.limit_amount : null;
    let purchaseStatus = existing ? existing.purchase_status : '开放申购';
    let latestNav = null;

    // 1. Tier 1: 主页 HTML (fund.eastmoney.com/{code}.html)
    let html = '';
    let statusText = '';
    try {
        const res = await fetchWithRetry(`https://fund.eastmoney.com/${code}.html`, { 
            headers: { ...UA, 'Referer': 'https://fund.eastmoney.com/' } 
        });
        if (res) {
            html = await res.text();
            const mStatus = html.match(/交易状态[：:]\s*<\/span>\s*<span class="staticCell">([^<]+)<\/span>/i) ||
                           html.match(/交易状态[：:]\s*<\/span>\s*<span class="staticCell">\s*([^<]+)\s*<span/i);
            statusText = mStatus ? mStatus[1].trim() : '';

            const mLimit1 = html.match(/单日累计购买上限\s*([\d,.]+)\s*(万)?\s*元/i) ||
                            html.match(/单日申购上限\s*([\d,.]+)\s*(万)?\s*元/i) ||
                            html.match(/单日限额\s*([\d,.]+)\s*(万)?\s*元/i) ||
                            html.match(/购买上限\s*([\d,.]+)\s*(万)?\s*元/i);
            
            if (mLimit1) {
                let v = parseFloat(mLimit1[1].replace(/,/g, ''));
                if (mLimit1[2] === '万') v *= 10000;
                if (v > 0) {
                    limit = v;
                    purchaseStatus = '暂停大额申购';
                }
            }
        }
    } catch (e) {}

    // 2. Tier 2: 交易规则页 (fundf10.eastmoney.com/jjfl_{code}.html)
    if (!limit) {
        try {
            const res2 = await fetchWithRetry(`https://fundf10.eastmoney.com/jjfl_${code}.html`, { 
                headers: { ...UA, 'Referer': 'https://fundf10.eastmoney.com/' } 
            });
            if (res2) {
                const html2 = await res2.text();
                const mLimit2 = html2.match(/单日累计购买上限\s*([\d,.]+)\s*(万)?\s*元/i) ||
                                html2.match(/单日申购上限\s*([\d,.]+)\s*(万)?\s*元/i) ||
                                html2.match(/申购限额\s*([\d,.]+)\s*(万)?\s*元/i) ||
                                html2.match(/购买上限\s*([\d,.]+)\s*(万)?\s*元/i);
                if (mLimit2) {
                    let v = parseFloat(mLimit2[1].replace(/,/g, ''));
                    if (mLimit2[2] === '万') v *= 10000;
                    if (v > 0) {
                        limit = v;
                        purchaseStatus = '暂停大额申购';
                    }
                }
            }
        } catch (e) {}
    }

    // 3. Tier 3: 该分级专属公告直采 (针对限大额但两层均未直接写数字的次级/新设独立份额)
    if (!limit && (statusText.includes('限大额') || statusText.includes('暂停大额') || (html && html.includes('暂停大额申购')))) {
        purchaseStatus = '暂停大额申购';
        try {
            const mAnnLink = html.match(/href=[\"'](http:\/\/guba\.eastmoney\.com\/news,of[a-zA-Z0-9]+,\d+\.html)[\"'][^>]*title=[\"'][^\"']*(?:限额|大额|暂停申购|业务限额)[^\"']*/i);
            if (mAnnLink) {
                const resAnn = await fetchWithRetry(mAnnLink[1], { headers: { ...UA } });
                if (resAnn) {
                    const htmlAnn = await resAnn.text();
                    const codeIdx = htmlAnn.indexOf(code);
                    let targetSnippet = htmlAnn;
                    if (codeIdx !== -1) {
                        targetSnippet = htmlAnn.slice(codeIdx - 200, codeIdx + 400);
                    }
                    const mAnnLimit = targetSnippet.match(/(?:限额为|限制申购|不超过|上限为|调整为|限制金额)\s*[:：]?\s*([\d,.]+)\s*(万)?\s*元/i) ||
                                      htmlAnn.match(/(?:限额为|限制申购|不超过|上限为|调整为|限制金额)\s*[:：]?\s*([\d,.]+)\s*(万)?\s*元/i) ||
                                      htmlAnn.match(/单日累计购买上限\s*([\d,.]+)\s*(万)?\s*元/i);
                    if (mAnnLimit) {
                        let v = parseFloat(mAnnLimit[1].replace(/,/g, ''));
                        if (mAnnLimit[2] === '万') v *= 10000;
                        if (v > 0) limit = v;
                    }
                }
            }
        } catch (e) {}
    }

    // 非限大额状态判定
    if (!limit) {
        if (statusText.includes('暂停申购') || statusText.includes('暂停交易')) {
            purchaseStatus = '暂停申购';
            limit = null;
        } else if (statusText.includes('开放申购') || statusText.includes('开放')) {
            purchaseStatus = '开放申购';
            limit = null;
        } else if (statusText.includes('认购期') || statusText.includes('认购')) {
            purchaseStatus = '认购期';
            limit = null;
        } else if (statusText.includes('封闭期') || statusText.includes('封闭')) {
            purchaseStatus = '封闭期';
            limit = null;
        }
    }

    // 4. 抓取 lsjz 官方最新交易日净值
    try {
        const resNav = await fetchWithRetry(`https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`, {
            headers: { ...UA, 'Referer': 'https://fundf10.eastmoney.com/' }
        });
        if (resNav) {
            const jsonNav = await resNav.json();
            const latest = jsonNav?.Data?.LSJZList?.[0];
            if (latest) {
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
const BATCH_SIZE = 8;
const crawledResults = [];

for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE);
    const promises = batch.map(f => fetchIndividualFund(f.code));
    const res = await Promise.all(promises);
    crawledResults.push(...res);
    process.stdout.write(`\r[进度] 单只基金逐一独立直采: ${Math.min(i + BATCH_SIZE, funds.length)} / ${funds.length}...`);
    await sleep(40);
}
console.log(`\n✅ 抓取完毕，耗时 ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

db.exec('BEGIN TRANSACTION;');
const updStmt = db.prepare(`
    INSERT OR REPLACE INTO daily_nav (code, date, nav, acc_nav, daily_return, purchase_status, limit_amount, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
`);

let updatedCount = 0;
for (const m of crawledResults) {
    let finalLimit = m.limit;
    let finalStatus = m.purchaseStatus;

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
db.exec('COMMIT;');

console.log(`✅ 成功将 ${updatedCount} 条最新净值与真实独立限额写入 SQLite 数据库！`);
console.log(`🎉 全流程耗时: ${((Date.now() - startTime) / 1000).toFixed(2)}s\n`);
