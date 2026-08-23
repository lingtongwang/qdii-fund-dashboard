// 单日申购限额(limit_amount)回填脚本
// 仅依赖基金主页 fund.eastmoney.com/{code}.html（与被限流的季报正文 API 无关），可从沙箱直接跑。
// 写入 daily_nav.limit_amount（同一基金所有 NAV 行共享同一限额值）。
// 断点续跑：data/limit_progress.json（done=已处理，含开放申购；fail=抓取失败）。
import { FUNDS } from './config/funds.js';
import { fetchTradeLimit } from './adapters/report.js';
import { getDb } from './db/sqlite.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, 'data');
const PROGRESS = join(DATA, 'limit_progress.json');

let progress = {};
try { progress = JSON.parse(readFileSync(PROGRESS, 'utf8')); } catch {}

const BATCH = parseInt(process.env.BATCH || '400', 10);
const BUDGET_MS = 7 * 60 * 1000; // 自退预算
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function saveProgress(p) { writeFileSync(PROGRESS, JSON.stringify(p)); }

const db = getDb();
const upd = db.prepare('UPDATE daily_nav SET limit_amount=? WHERE code=?');

const start = Date.now();
let processed = 0, ok = 0, open = 0, fail = 0, consecutiveFail = 0;

// 预检：主页可达性（不依赖被限流的 np-cnotice-fund）
try {
  const probe = await fetchTradeLimit(FUNDS[0].code);
  console.log(`[limit] 预检主页可达 ${FUNDS[0].code} -> ${probe == null ? '开放/无上限' : probe + '元'}`);
} catch (e) {
  console.log(`[limit] 预检失败，主页可能不可达：${e.message}。退出。`);
  process.exit(0);
}

for (const f of FUNDS) {
  if (progress[f.code] === 'done') continue;
  try {
    const v = await fetchTradeLimit(f.code);
    if (v != null) {
      upd.run(v, f.code);
      progress[f.code] = 'done';
      ok++;
    } else {
      // 开放申购 / 无明确上限：保持 null，标记为已处理
      progress[f.code] = 'done';
      open++;
    }
    consecutiveFail = 0;
  } catch (e) {
    progress[f.code] = 'fail';
    fail++;
    consecutiveFail++;
    if (consecutiveFail >= 6) {
      console.log(`[limit] 连续失败 ${consecutiveFail} 次，冷却 25s`);
      await sleep(25000);
      consecutiveFail = 0;
    }
  }
  saveProgress(progress);
  processed++;
  if (processed >= BATCH) { console.log(`[limit] 达到本片上限 ${BATCH}，主动退出`); break; }
  if (Date.now() - start > BUDGET_MS) { console.log(`[limit] 达到时间预算，主动退出`); break; }
  await sleep(120);
}

const total = Object.values(progress).filter((x) => x === 'done').length;
console.log(`[limit] 本片: 限大额=${ok} 开放=${open} 失败=${fail} | 累计已处理=${total}/${FUNDS.length}`);
if (total >= FUNDS.length) console.log('[limit] 全部完成 ✅');
