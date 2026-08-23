// 标记/取消标记"暂时不用"的基金类别（不删除数据，仅打 excluded 标记）
// 用途：QDII 基金过多，先只保留股票为主的基金；债券/商品/REITs 三类暂时不用。
// 用法：
//   node jobs/mark_excluded.mjs            # 按当前 EXCLUDE_PILLS 标记（默认：债券/商品/REITs）
//   node jobs/mark_excluded.mjs --reset    # 全部取消标记（excluded=0），恢复全量
// 设计：标记只影响 funds.excluded，不影响任何数据；gatherAll() 默认过滤 excluded=1。
//       /api/funds?all=1 可临时查看全量（含被标记基金）。

import { getDb } from '../db/sqlite.js';

// 需要"暂时不用"的子类别（与 classify.js 的 pill 输出一致）
const EXCLUDE_PILLS = ['QDII债券', 'QDII商品', 'QDII REITs'];

const reset = process.argv.includes('--reset');
const db = getDb();

if (reset) {
    db.prepare('UPDATE funds SET excluded=0').run();
    const total = db.prepare('SELECT count(*) c FROM funds').get().c;
    console.log(`[mark_excluded] --reset 完成：全部 ${total} 只基金 excluded=0（恢复全量）`);
    process.exit(0);
}

// 标记前统计
const total = db.prepare('SELECT count(*) c FROM funds').get().c;
const before = db.prepare('SELECT count(*) c FROM funds WHERE excluded=1').get().c;

// 执行标记（仅对目标 pill；已是 excluded 的不动，未标记的补上）
const placeholders = EXCLUDE_PILLS.map(() => '?').join(',');
const info = db.prepare(`UPDATE funds SET excluded=1 WHERE pill IN (${placeholders})`).run(...EXCLUDE_PILLS);
const after = db.prepare('SELECT count(*) c FROM funds WHERE excluded=1').get().c;
const active = total - after;

console.log(`[mark_excluded] 目标类别: ${EXCLUDE_PILLS.join(' / ')}`);
console.log(`  总基金: ${total}`);
console.log(`  标记前 excluded=${before}，本轮新增=${(after - before)}，标记后 excluded=${after}`);
console.log(`  => 保留（股票为主）: ${active} 只，暂时不用: ${after} 只`);

// 按 pill 列出被标记的数量，便于核对
for (const p of EXCLUDE_PILLS) {
    const n = db.prepare('SELECT count(*) c FROM funds WHERE pill=? AND excluded=1').get(p).c;
    console.log(`    - ${p}: ${n} 只`);
}
