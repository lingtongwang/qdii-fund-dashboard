// 绕开东财封禁：从晨星中国(morningstar.cn)批量抓取「股票地区分布」补齐 region_alloc
// 口径：晨星洲/地区级（北美 / 大欧洲地区 / 大亚洲地区 / 日本 / 非洲中东 等），合计≈100%
// 域名独立、沙箱代理可达，故可由沙箱代跑，用户零操作。
// 每只基金：DELETE 旧 region 行（统一晨星口径，覆盖东财国家级旧数据）→ INSERT 晨星 row-head 地区行。
import { FUNDS } from './config/funds.js';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, 'data', 'fund.db');
const PROGRESS_PATH = join(__dirname, 'data', 'report_ms_progress.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const db = new DatabaseSync(DB_PATH);
const BATCH = parseInt(process.env.BATCH || '400', 10);
const BUDGET_MS = (parseInt(process.env.BUDGET_MS || '7', 10)) * 60 * 1000;  // 默认7min，可由环境变量放大
const BASE_DELAY = 700;
const BREATHER_EVERY = 25, BREATHER_MS = 10000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = ms => ms + Math.floor(Math.random() * 400);

function loadProgress() {
  try { return JSON.parse(readFileSync(PROGRESS_PATH, 'utf8')); } catch { return {}; }
}
function saveProgress(p) { mkdirSync(dirname(PROGRESS_PATH), { recursive: true }); writeFileSync(PROGRESS_PATH, JSON.stringify(p, null, 0)); }
const progress = loadProgress();

const RESUME_ONLY = process.argv.includes('--resume-only');

async function fetchMorningstar(code) {
  const c = new AbortController(); const id = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(`https://www.morningstar.cn/fund/${code}.html`, {
      headers: { 'User-Agent': UA, Referer: 'https://www.morningstar.cn/' }, signal: c.signal,
    });
    clearTimeout(id);
    return await r.text();
  } catch (e) { clearTimeout(id); throw e; }
}

// 解析「股票地区分布」表格：只取 row-head（大洲/地区级汇总行），合计≈100%
function parseRegions(html) {
  const i = html.indexOf('股票地区分布');
  if (i < 0) return [];
  const chunk = html.slice(i, i + 6000);
  const rows = [];
  const re = /<tr class="row-head"[^>]*>\s*<td class="col-name"[^>]*>([^<]+)<\/td>\s*<td[^>]*>([\d.]+)<\/td>/g;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    const name = m[1].trim();
    const pct = parseFloat(m[2]);
    if (!isNaN(pct) && pct > 0) rows.push({ name, pct: pct / 100 });
  }
  return rows;
}

// 抽取地区数据的报告期（晨星页在「股票地区分布」附近标注，如 2025-12-31）
function parseRegionDate(html) {
  const i = html.indexOf('股票地区分布');
  if (i < 0) return null;
  const chunk = html.slice(i, i + 6000);
  const m = chunk.match(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|20\d{2}年\d{1,2}月\d{1,2}日/);
  if (m) {
    const s = m[0].replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-');
    const parts = s.split('-');
    if (parts.length === 3) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  return null;
}

function stats() {
  const v = Object.values(progress);
  return { done: v.filter(x => x === 'done').length, none: v.filter(x => x === 'none').length, fail: v.filter(x => x === 'fail').length };
}
function logProgress(tag) {
  const s = stats();
  console.log(`[ms ${tag}] done=${s.done} none=${s.none} fail=${s.fail} 待处理=${FUNDS.length - s.done - s.none}`);
}

console.log(`[ms] 基金总数: ${FUNDS.length}`);
logProgress('resume');
if (RESUME_ONLY) process.exit(0);

let shuttingDown = false;
process.on('SIGINT', () => {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log('\n[ms signal] 保存进度后退出');
  saveProgress(progress);
  setTimeout(() => process.exit(0), 300);
});

const start = Date.now();
let processed = 0, okThis = 0, noneThis = 0, failThis = 0, consecutiveFail = 0;

for (const f of FUNDS) {
  if (shuttingDown) break;
  const st = progress[f.code];
  if (st === 'done' || st === 'none') continue;

  try {
    const html = await fetchMorningstar(f.code);
    const regions = parseRegions(html);
    const rdate = parseRegionDate(html) || 'morningstar';
    // 统一晨星口径：先清旧行，再写晨星（report_date 用真实报告期，回退 morningstar）
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM region_alloc WHERE code=?').run(f.code);
      const ins = db.prepare('INSERT INTO region_alloc (code, report_date, name, pct, source) VALUES (?,?,?,?,?)');
      for (const r of regions) ins.run(f.code, rdate, r.name, r.pct, 'morningstar');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }

    if (regions.length) { progress[f.code] = 'done'; okThis++; consecutiveFail = 0; }
    else { progress[f.code] = 'none'; noneThis++; consecutiveFail = 0; }
    console.log(`[${regions.length ? 'OK ' : 'NONE'}] ${f.code} ${f.name} reg=${regions.length}${regions.length ? ' ' + regions.slice(0, 3).map(r => r.name + ':' + (r.pct * 100).toFixed(1) + '%').join(',') : ''}`);
  } catch (e) {
    progress[f.code] = 'fail'; failThis++; consecutiveFail++;
    console.log(`[FAIL] ${f.code} ${f.name}: ${String(e.message || e).slice(0, 80)}`);
    if (consecutiveFail >= 6) { console.log(`[ms cooldown] 连续失败 ${consecutiveFail} 次，冷却 25s`); await sleep(25000); consecutiveFail = 0; }
  }

  saveProgress(progress);
  processed++;
  if (processed >= BATCH) { console.log(`[ms] 达本片上限 ${BATCH}，主动退出`); break; }
  if (Date.now() - start > BUDGET_MS) { console.log(`[ms] 达时间预算，主动退出`); break; }
  await sleep(jitter(BASE_DELAY));
  if (processed % BREATHER_EVERY === 0) { console.log(`[ms breather] 已处理 ${processed} 只，喘息`); await sleep(BREATHER_MS); }
}

logProgress('end');
const s = stats();
if (FUNDS.length - s.done - s.none === 0) {
  console.log('[ms] 全部完成 ✅');
  saveProgress(progress);
  process.exit(0);
}
saveProgress(progress);
process.exit(0);
