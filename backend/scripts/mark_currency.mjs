import { getDb } from '../db/sqlite.js';

const db = getDb();

// 1. 重置 currency_excluded = 0
db.prepare('UPDATE funds SET currency_excluded=0').run();

// 2. 识别所有美元/外币份额基金（含美元、USD、美钞、美汇、现汇、现钞、港币、HKD、欧元、EUR、英镑、GBP）
const rows = db.prepare(`
    SELECT code, name 
    FROM funds 
    WHERE name LIKE '%美元%' 
       OR name LIKE '%USD%' 
       OR name LIKE '%美钞%' 
       OR name LIKE '%美汇%' 
       OR name LIKE '%现汇%' 
       OR name LIKE '%现钞%' 
       OR name LIKE '%港币%' 
       OR name LIKE '%HKD%' 
       OR name LIKE '%欧元%' 
       OR name LIKE '%EUR%' 
       OR name LIKE '%英镑%'
`).all();

console.log(`找到 ${rows.length} 只美元/外币份额基金，正在标记 currency_excluded=1...`);

const upd = db.prepare('UPDATE funds SET currency_excluded=1 WHERE code=?');
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

const visibleCount = db.prepare(`
    SELECT count(*) c 
    FROM funds 
    WHERE mainstream=1 
      AND (excluded=0 OR excluded IS NULL) 
      AND (region_excluded=0 OR region_excluded IS NULL)
      AND (exchange_excluded=0 OR exchange_excluded IS NULL)
      AND (currency_excluded=0 OR currency_excluded IS NULL)
`).get().c;

console.log(`当前前端主列表可见的【纯场外·人民币份额 QDII 基金】总数: ${visibleCount} 只`);
