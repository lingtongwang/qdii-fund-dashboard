// 行业配置全量补录（绕过被网关的公告接口）：
//   数据源 = api.fund.eastmoney.com/f10/HYPZ/ （公开 JSONP，需带 year + callback 参数，否则 ErrCode:4）
//   覆盖 industry_alloc(code, report_date, name, pct)，每只基金仅保留最新一期。
// 用法：
//   node report_industry.mjs            # 跑一个时间片（~7min / 250 只）
//   node report_industry.mjs --batch 250
//   node report_industry.mjs --resume-only
import { getDb } from './db/sqlite.js';
import { getJson } from './lib/http.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS = join(__dirname, 'data', 'industry_progress.json');
const UA_REF = (code) => `https://fundf10.eastmoney.com/hytz_${code}.html`;
const YEARS = [2026, 2025, 2024];

const args = process.argv.slice(2);
const getFlag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? (args[i + 1] ?? true) : def; };
const BATCH = parseInt(getFlag('batch', '250'), 10);
const RESUME_ONLY = args.includes('--resume-only');
const BUDGET_MS = 7 * 60 * 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function loadProgress() { try { return JSON.parse(readFileSync(PROGRESS, 'utf8')); } catch { return {}; } }
function saveProgress(p) { mkdirSync(dirname(PROGRESS), { recursive: true }); writeFileSync(PROGRESS, JSON.stringify(p)); }

// 取单只基金最新一期行业配置
async function fetchIndustry(code) {
    let best = null; // { reportDate, rows:[{name,pct}] }
    for (const year of YEARS) {
        const url = `https://api.fund.eastmoney.com/f10/HYPZ/?fundCode=${code}&year=${year}&callback=?`;
        let j;
        try { j = await getJson(url, { referer: UA_REF(code) }); }
        catch { continue; }
        if (!j || j.ErrCode !== 0 || !j.Data || !Array.isArray(j.Data.QuarterInfos)) continue;
        for (const q of j.Data.QuarterInfos) {
            const rows = (q.HYPZInfo || []).map(r => ({
                name: r.HYMC,
                pct: parseFloat(r.ZJZBL) / 100,
            })).filter(r => r.name && !isNaN(r.pct));
            if (!rows.length) continue;
            const rd = q.JZRQ || q.FSRQ;
            if (!best || (rd && rd > best.reportDate)) best = { reportDate: rd, rows };
        }
        if (best) break; // 该年份已有数据，取最新一期即可
    }
    return best;
}

const db = getDb();
const codes = db.prepare('SELECT code FROM funds ORDER BY code').all().map(r => r.code);
const progress = loadProgress();
const cnt = k => Object.values(progress).filter(v => v === k).length;
console.log(`[start] 进度 done=${cnt('done')} skip=${cnt('skip')} 待处理=${codes.length - cnt('done') - cnt('skip')}`);
if (RESUME_ONLY) process.exit(0);

const delI = db.prepare('DELETE FROM industry_alloc WHERE code=?');
const insI = db.prepare('INSERT OR REPLACE INTO industry_alloc (code,report_date,name,pct) VALUES (?,?,?,?)');
function tx(code, info) {
    db.exec('BEGIN');
    try {
        delI.run(code);
        for (const r of info.rows) insI.run(code, info.reportDate, r.name, r.pct);
        db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
}

let processed = 0, ok = 0, skip = 0, fail = 0, consecutiveFail = 0;
const start = Date.now();
for (const code of codes) {
    if (progress[code] === 'done' || progress[code] === 'skip') continue;
    try {
        const info = await fetchIndustry(code);
        if (info && info.rows.length) {
            tx(code, info);
            progress[code] = 'done'; ok++;
            consecutiveFail = 0;
            if (processed % 25 === 0) console.log(`[OK] ${code} ${info.reportDate} rows=${info.rows.length} (cum ok=${ok})`);
        } else {
            progress[code] = 'skip'; skip++; consecutiveFail = 0; // 无行业数据（联接/债券/商品等），保留旧数据
        }
    } catch (e) {
        progress[code] = 'fail'; fail++; consecutiveFail++;
        console.log(`[FAIL] ${code}: ${String(e.message || e).slice(0, 80)}`);
        if (consecutiveFail >= 6) { console.log(`[cooldown] 连续失败${consecutiveFail}，冷却20s`); await sleep(20000); consecutiveFail = 0; }
    }
    saveProgress(progress);
    processed++;
    if (processed >= BATCH) { console.log(`[budget] 达本片上限 ${BATCH}，退出`); break; }
    if (Date.now() - start > BUDGET_MS) { console.log(`[budget] 达时间预算，退出`); break; }
    await sleep(200);
}
console.log(`[done] 本片 ok=${ok} skip=${skip} fail=${fail}`);
console.log(`[done] 累计 done=${cnt('done')} skip=${cnt('skip')} fail=${cnt('fail')} 剩余=${codes.length - cnt('done') - cnt('skip')}`);
if (codes.length - cnt('done') - cnt('skip') > 0) console.log('[done] 仍有剩余，请再次运行续跑');
else console.log('[done] 全部完成 ✅');
process.exit(0);
