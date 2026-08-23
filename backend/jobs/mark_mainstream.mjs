// 标记"主流基金"：在已保留的股票基金（excluded=0）内，进一步收窄到主流集合。
// 规则（家族史，避免份额虚高）：
//   1) 同基金多份额合并为一个"家族"（按归一化名），每家族只保留 1 只代表份额；
//   2) 家族保留条件：代表份额规模 >= SCALE_MIN 亿，且家族内至少有份额含净值+地区数据；
//   3) 代表份额优先：规模大者；并列时优先「非美元/港币」「非 C 类」「A 类」。
// 标记机制：主流=1，其余股票基金（冗余份额 / 迷你 / 数据残缺）=0；bond/商品/REITs 不动（仍 excluded=1）。
// 不影响任何数据；gatherAll 默认只返回 mainstream=1 且 excluded=0。?all=1 看全量。
// 用法：
//   node jobs/mark_mainstream.mjs            # 按当前阈值标记
//   node jobs/mark_mainstream.mjs --reset   # 全部股票基金 mainstream=1（恢复去重前 614 视图）
//   node jobs/mark_mainstream.mjs --min=2    # 改阈值（亿元），如 --min=2 / --min=10

import { getDb } from '../db/sqlite.js';

const SCALE_MIN = (() => {
    const m = process.argv.find(a => a.startsWith('--min='));
    return m ? parseFloat(m.split('=')[1]) : 0; // 解除 5 亿生硬规模门槛，全部正常基金家族均纳入
})();
const reset = process.argv.includes('--reset');
const db = getDb();

if (reset) {
    db.prepare("UPDATE funds SET mainstream=1 WHERE excluded=0").run();
    const n = db.prepare("SELECT count(*) c FROM funds WHERE excluded=0 AND mainstream=1").get().c;
    console.log(`[mark_mainstream] --reset 完成：股票基金 mainstream=1 共 ${n} 只（恢复去重前视图）`);
    process.exit(0);
}

// 归一化：去币种 + 份额后缀，得到基金家族名
function stem(n) {
    return n
        .replace(/美元现钞|美元现汇|美元|港币|人民币|RMB|欧元/g, '')
        .replace(/（.*?）|\(.*?\)/g, '')
        .replace(/(发起式|联接|母基|指数|ETF|LOF)?\s*(A|B|C|D|E|F|H|I|O|R|Y|后端)$/i, '')
        .replace(/\s+/g, '').trim();
}
// 代表份额打分：优先人民币份额 > 优先 A 类 > 规模大优先
function score(f) {
    const s = f.scale || 0;
    const noCur = /美元|港币|现钞|现汇|美钞|美汇|USD|HKD|EUR/.test(f.name) ? 0 : 1000;
    const isA = /A$/i.test(f.name.replace(/\s/g, '')) ? 50 : 0;
    const isC = /C$/i.test(f.name.replace(/\s/g, '')) ? 20 : 0;
    return noCur + isA + isC + (s * 10);
}

const stock = db.prepare("SELECT code,name,scale FROM funds WHERE excluded=0 OR excluded IS NULL").all();
const groups = {};
for (const f of stock) { const k = stem(f.name); (groups[k] = groups[k] || []).push(f); }

let famTotal = 0, famKept = 0, keptCodes = 0, dropTiny = 0, dropData = 0, dropDup = 0;
const updates = []; // [code, mainstream]
for (const [k, shares] of Object.entries(groups)) {
    famTotal++;
    const rep = shares.slice().sort((a, b) => score(b) - score(a))[0];
    const maxS = Math.max(0, ...shares.map(x => x.scale || 0));
    const hasNav = shares.some(x => db.prepare("SELECT 1 FROM daily_nav WHERE code=? LIMIT 1").get(x.code));
    const keep = hasNav; // 只要有净值数据即保留代表份额
    if (keep) famKept++;
    for (const f of shares) {
        if (keep && f.code === rep.code) { updates.push([f.code, 1]); keptCodes++; }
        else {
            updates.push([f.code, 0]);
            if (keep) dropDup++;            // 同家族被去重的其余份额
            else if (maxS < SCALE_MIN) dropTiny++;
            else dropData++;
        }
    }
}

db.exec('BEGIN');
try {
    for (const [code, m] of updates) db.prepare("UPDATE funds SET mainstream=? WHERE code=?").run(m, code);
    db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }

console.log(`[mark_mainstream] 阈值: 规模>=${SCALE_MIN}亿 且 含净值+地区`);
console.log(`  股票基金 code 数: ${stock.length}`);
console.log(`  归一化基金家族: ${famTotal} 个，保留家族: ${famKept} 个`);
console.log(`  标记 mainstream=1 (主流代表份额): ${keptCodes} 只`);
console.log(`  标记 mainstream=0: ${updates.length - keptCodes} 只`);
console.log(`    - 同家族冗余份额(去重): ${dropDup}`);
console.log(`    - 规模<${SCALE_MIN}亿(迷你): ${dropTiny}`);
console.log(`    - 缺净值/地区(数据残缺): ${dropData}`);
console.log(`  => 仪表盘默认工作集: ${keptCodes} 只主流基金`);
