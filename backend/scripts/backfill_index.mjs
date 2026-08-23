import { getDb } from '../db/sqlite.js';
import { fetchFundBasicInfo } from '../adapters/eastmoney.js';
import { classify } from '../classify.js';

const db = getDb();
const funds = db.prepare('SELECT code, name, raw_type FROM funds').all();

console.log(`Starting to backfill tracking index for ${funds.length} funds...`);

const updIndex = db.prepare('UPDATE funds SET tracking_index=?, index_code=? WHERE code=?');
const updClass = db.prepare('UPDATE funds SET tab=?, pill=?, classify_basis=? WHERE code=?');

let count = 0;
let withIndex = 0;

for (const f of funds) {
    count++;
    try {
        const info = await fetchFundBasicInfo(f.code);
        if (info.indexName) {
            updIndex.run(info.indexName, info.indexCode, f.code);
            withIndex++;
        }
    } catch (e) {
        // ignore single failure
    }
    if (count % 50 === 0) {
        console.log(`Progress: ${count}/${funds.length} (found ${withIndex} index funds)...`);
    }
}

console.log(`\nBackfill complete! Total with explicit tracking index: ${withIndex} / ${funds.length}`);

console.log('\nRe-classifying all funds based on tracking_index + region_alloc...');
db.exec('BEGIN');
try {
    for (const f of funds) {
        const row = db.prepare('SELECT tracking_index FROM funds WHERE code=?').get(f.code);
        const regions = db.prepare('SELECT name, pct FROM region_alloc WHERE code=?').all(f.code);
        const cls = classify(f.name, f.raw_type, regions, row?.tracking_index || '');
        updClass.run(cls.tab, cls.pill, cls.basis, f.code);
    }
    db.exec('COMMIT');
    console.log('All classifications recomputed successfully!');
} catch (e) {
    db.exec('ROLLBACK');
    console.error('Classification error:', e);
}

// 检查 160140 的最新分类情况
const f160140 = db.prepare('SELECT code, name, tracking_index, tab, pill, classify_basis FROM funds WHERE code="160140"').get();
console.log('\n--- 160140 最新分类结果 ---');
console.log(f160140);
