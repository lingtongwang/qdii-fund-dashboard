import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import fs from 'fs';
import { stem } from '../normalize/shares.js';

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

// 精准解析交易状态与限额（严格优先判断主状态，严禁在暂停申购状态下误读历史限额！）
export function parseTradeStatusAndLimit(html) {
    if (!html) return { status: '开放申购', limit: null };

    // 匹配交易状态的主状态单元格（第一个 staticCell）
    const mBlock = html.match(/交易状态[：:]\s*<\/span>\s*<span class="staticCell">([\s\S]*?)<\/span>\s*<span class="staticCell">/i) ||
                   html.match(/交易状态[：:]\s*<\/span>\s*<span class="staticCell">([\s\S]*?)<\/span>/i);

    if (!mBlock) {
        return { status: '开放申购', limit: null };
    }

    const cellHtml = mBlock[1].trim();
    const pureText = cellHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // 1. 绝对暂停申购优先判定（严禁读取括号内的历史残留限额！）
    if (/^暂停申购|^暂停交易|^封闭期|^暂停/.test(pureText)) {
        return { status: '暂停申购', limit: null };
    }

    // 2. 限大额判定并提取真实限额
    if (/^限大额|^暂停大额/.test(pureText)) {
        const mLimit = cellHtml.match(/单日累计购买上限\s*([\d,.]+)\s*(万)?\s*元/i) ||
                       cellHtml.match(/单日申购上限\s*([\d,.]+)\s*(万)?\s*元/i) ||
                       cellHtml.match(/单日限额\s*([\d,.]+)\s*(万)?\s*元/i) ||
                       cellHtml.match(/购买上限\s*([\d,.]+)\s*(万)?\s*元/i) ||
                       html.match(/单日累计购买上限\s*([\d,.]+)\s*(万)?\s*元/i);

        let limit = null;
        if (mLimit) {
            let v = parseFloat(mLimit[1].replace(/,/g, ''));
            if (mLimit[2] === '万') v *= 10000;
            if (v > 0) limit = v;
        }
        return { status: '暂停大额申购', limit };
    }

    // 3. 开放申购
    if (/^开放申购|^开放/.test(pureText)) {
        return { status: '开放申购', limit: null };
    }

    // 4. 认购期
    if (/^认购期|^认购/.test(pureText)) {
        return { status: '认购期', limit: null };
    }

    return { status: '开放申购', limit: null };
}

// 独立从基金公司最新法定业务限额公告 PDF 提取真实限额
async function fetchOfficialPdfLimit(code) {
    try {
        const url = `https://api.fund.eastmoney.com/f10/JJGG?fundcode=${code}&pageIndex=1&pageSize=15&type=0`;
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fundf10.eastmoney.com/' }, signal: AbortSignal.timeout(3000) });
        if (!res.ok) return null;
        const json = await res.json();
        const ann = json.Data?.find(d => 
            /(?:大额申购|大额投资|申购限额|购买上限|暂停申购|恢复申购|恢复大额|限制申购)/.test(d.TITLE) && 
            !/节假日|港股通非交易日|系统维护|通联渠道|设备|改聘|基准|资料概要|招募说明书|季度报告|净值/.test(d.TITLE)
        );
        if (!ann) return null;

        const daysDiff = (Date.now() - new Date(ann.PUBLISHDATE).getTime()) / 86400000;
        if (daysDiff > 45) return null;

        const pdfUrl = `https://pdf.dfcfw.com/pdf/H2_${ann.ID}_1.pdf`;
        const pdfRes = await fetch(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) });
        if (!pdfRes.ok) return null;

        const tmpPath = `/tmp/lim_${code}_${ann.ID}.pdf`;
        fs.writeFileSync(tmpPath, Buffer.from(await pdfRes.arrayBuffer()));
        const text = execSync(`pdftotext "${tmpPath}" -`, { encoding: 'utf8', timeout: 2000 });
        try { fs.unlinkSync(tmpPath); } catch {}

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
        return officialLimit;
    } catch {
        return null;
    }
}

// 三层独立直采提取单只基金/份额的真实限额与状态
async function fetchIndividualFund(code) {
    const existing = existingMap.get(code);
    let limit = existing ? existing.limit_amount : null;
    let purchaseStatus = existing ? existing.purchase_status : '开放申购';
    let latestNav = null;

    // 1. Tier 1: 主页 HTML (fund.eastmoney.com/{code}.html)
    let html = '';
    try {
        const res = await fetchWithRetry(`https://fund.eastmoney.com/${code}.html`, { 
            headers: { ...UA, 'Referer': 'https://fund.eastmoney.com/' } 
        });
        if (res) {
            html = await res.text();
            const parsed = parseTradeStatusAndLimit(html);
            purchaseStatus = parsed.status;
            limit = parsed.limit;
        }
    } catch (e) {}

    // 2. Tier 2: 交易规则页 (fundf10.eastmoney.com/jjfl_{code}.html)（仅限限大额但主页无数字时补充）
    if (purchaseStatus === '暂停大额申购' && !limit) {
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
                    if (v > 0) limit = v;
                }
            }
        } catch (e) {}
    }

    // 3. Tier 3: 官方最新法定业务限额公告 PDF 优先对齐（覆盖网页滞后数字）
    if (purchaseStatus === '暂停大额申购') {
        const pdfLimit = await fetchOfficialPdfLimit(code);
        if (pdfLimit) limit = pdfLimit;
    }

    // 若依然无法获取具体限额数字（如全额暂停但前端残留限大额），自动纠正为暂停申购以符合业务不变式
    if (purchaseStatus === '暂停大额申购' && (!limit || limit <= 0)) {
        purchaseStatus = '暂停申购';
        limit = null;
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

// 构建母基金/同系份额限额映射表（用于次级份额 D/E/I 类继承同系主限额）
const fundNameMap = new Map(funds.map(f => [f.code, f.name]));
const stemLimitMap = new Map();
for (const m of crawledResults) {
    if (m.purchaseStatus === '暂停大额申购' && m.limit > 0) {
        const name = fundNameMap.get(m.code);
        if (name) {
            const s = stem(name);
            if (!stemLimitMap.has(s)) stemLimitMap.set(s, m.limit);
        }
    }
}

// 补齐同系次级份额的限额
for (const m of crawledResults) {
    if (m.purchaseStatus === '暂停大额申购' && !m.limit) {
        const name = fundNameMap.get(m.code);
        if (name) {
            const s = stem(name);
            const inherited = stemLimitMap.get(s);
            if (inherited) {
                m.limit = inherited;
            }
        }
    }
}

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
