// 定向补数：仅刷新「申购/赎回费率 + 持仓(真实季报日) + 单日限额(校验后)」
// 不重刷 NAV/业绩/风险（这些数据已验证正确，重刷 32 万行无必要且有风险）。
// 用法：node refresh_extras.mjs            # 全量主流基金
//       node refresh_extras.mjs --resume   # 仅处理未完成（按进度文件）
import { getDb } from './db/sqlite.js';
import { fetchFees, fetchHoldings } from './adapters/eastmoney.js';
import { fetchTradeLimit } from './adapters/report.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS = join(__dirname, 'data', 'extras_progress.json');
const RESUME = process.argv.includes('--resume');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BUDGET_MS = 20 * 60 * 1000;

const db = getDb();
const codes = db.prepare("SELECT code FROM funds WHERE mainstream=1 ORDER BY code").all().map(r => r.code);
let progress = {};
try { progress = JSON.parse(readFileSync(PROGRESS, 'utf8')); } catch {}
const save = () => { try { mkdirSync(dirname(PROGRESS), { recursive: true }); writeFileSync(PROGRESS, JSON.stringify(progress)); } catch {} };
if (!RESUME) { progress = {}; } // 全量重跑：清空进度，确保每只都按新逻辑刷新

const updFees = db.prepare("UPDATE funds SET fee_subscribe=?, fee_redeem=?, updated_at=datetime('now') WHERE code=?");
const delH = db.prepare('DELETE FROM holdings WHERE code=?');
const insH = db.prepare('INSERT INTO holdings (code,rank,name,pct,report_date) VALUES (?,?,?,?,?)');
const updLimit = db.prepare('UPDATE daily_nav SET limit_amount=? WHERE code=?');

let ok = 0, fail = 0, done = 0;
const start = Date.now();
for (const code of codes) {
  if (progress[code] === 'done') { done++; continue; }
  try {
    const fees = await fetchFees(code).catch(() => ({ subscribe: null, redeem: null }));
    const h = await fetchHoldings(code).catch(() => ({ rows: [], reportDate: null }));
    const limit = await fetchTradeLimit(code).catch(() => null); // 含 <1000 校验，脏值返回 null

    db.exec('BEGIN');
    try {
      updFees.run(fees.subscribe, fees.redeem, code);
      delH.run(code);
      const hdate = h.reportDate || null;
      for (const x of (h.rows || [])) insH.run(code, x.rank, x.name, x.pct, hdate);
      updLimit.run(limit, code); // 始终更新（null=无限额/未知；脏值已被校验为 null）
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }

    progress[code] = 'done'; ok++;
    if (done % 25 === 0) console.log(`[extras] done=${done} ok=${ok} fail=${fail} (${code})`);
  } catch (e) {
    progress[code] = 'fail'; fail++;
    console.log(`[extras FAIL] ${code}: ${String(e.message || e).slice(0, 80)}`);
  }
  save();
  done++;
  if (Date.now() - start > BUDGET_MS) { console.log('[extras] 达时间预算，退出'); break; }
  await sleep(350);
}
const remain = codes.length - Object.values(progress).filter(v => v === 'done').length;
console.log(`[extras DONE] ok=${ok} fail=${fail} 剩余=${remain}`);
if (remain > 0) console.log('[extras] 仍有剩余，再次运行 node refresh_extras.mjs --resume');
save();
process.exit(0);
