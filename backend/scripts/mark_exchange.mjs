import { getDb } from '../db/sqlite.js';

const db = getDb();

// 1. 先重置 exchange_excluded = 0
db.prepare('UPDATE funds SET exchange_excluded=0').run();

// 2. 识别所有场内基金：
// - daily_nav 最新 purchase_status 包含 '场内'
// - 或 code 以 159, 513, 520, 560, 588 开头且名称包含 'ETF' 但不包含 '联接'
// - 或 raw_type 为 '指数型-海外股票' 且名称包含 'ETF' 且不含 '联接'
const rows = db.prepare(`
    SELECT f.code, f.name, f.raw_type, d.purchase_status
    FROM funds f
    LEFT JOIN daily_nav d ON f.code=d.code AND d.date=(SELECT max(d2.date) FROM daily_nav d2 WHERE d2.code=f.code)
    WHERE (d.purchase_status LIKE '%场内%' 
       OR (f.name LIKE '%ETF%' AND f.name NOT LIKE '%联接%')
       OR (f.code GLOB '159*' AND f.name NOT LIKE '%联接%')
       OR (f.code GLOB '513*' AND f.name NOT LIKE '%联接%')
       OR (f.code GLOB '520*' AND f.name NOT LIKE '%联接%'))
`).all();

console.log(`找到 ${rows.length} 只场内基金，正在标记 exchange_excluded=1（不删除，仅隐藏）...`);

const upd = db.prepare('UPDATE funds SET exchange_excluded=1 WHERE code=?');
db.exec('BEGIN');
try {
    for (const r of rows) {
        upd.run(r.code);
    }
    db.exec('COMMIT');
    console.log('标记完成！');
} catch (e) {
    db.exec('ROLLBACK');
    console.error('标记失败:', e);
}

// 统计当前可见池情况
const visibleCount = db.prepare(`
    SELECT count(*) c 
    FROM funds 
    WHERE mainstream=1 
      AND (excluded=0 OR excluded IS NULL) 
      AND (region_excluded=0 OR region_excluded IS NULL)
      AND (exchange_excluded=0 OR exchange_excluded IS NULL)
`).get().c;

console.log(`当前前端主列表可见的【纯场外 QDII 基金】总数: ${visibleCount} 只`);
