// 标记「投资离岸中国为主」的基金为 region_excluded=1（用户不用，从默认视图去除）
// 范围 = 港股为主 + 中概股为主（中概 = 海外上市中国概念股，如中概互联/海外中国/中证海外中国互联网）
// 与 excluded(资产类别) / mainstream(规模去重) 相互独立、可逆，数据零删除。
//
// 判定口径（比 classify.js 的「中国香港」更全，收进被它归到「其他」的港股/中概基金）：
//   名称含 香港 / 恒生 / 港股 / 港股通 / H股 / 红筹 / 大中华 / 中概 / 中国互联网 / 中国互联 / 海外中国 / 中证海外
//         / hang seng / hong kong / h-share
// 晨星 region_alloc 仅把香港单独拆出 7 只、且中概与港股同归「大亚洲」，不足以区分，故以名称口径为准。
//
// 用法：
//   node jobs/mark_hk.mjs           标记港股/中概为主基金
//   node jobs/mark_hk.mjs --reset   取消全部标记（恢复进默认视图）
//
// 注意：gatherAll 默认 WHERE 含 (region_excluded=0 OR NULL)，故标记后默认视图自动剔除。

import { getDb } from '../db/sqlite.js';

const db = getDb();
const RESET = process.argv.includes('--reset');

// 离岸中国为主关键词（港股 + 中概 + 中国主题；含中英文，大小写无关）
const HK_PATTERNS = [
    '香港', '恒生', '港股', '港股通', 'H股', '红筹', '大中华',
    '中概', '中国互联网', '中国互联', '海外中国', '中证海外',
    '中国世纪', '中国生物医药', '中国中小盘', '中国新兴经济', '中国优势', '中国概念', '中国价值',
    '中国海外', '中华', 'hang seng', 'hong kong', 'h-share', 'hsbc', 'greater china',
];
function isHK(name = '') {
    const t = name.toLowerCase();
    return HK_PATTERNS.some(p => t.includes(p.toLowerCase()));
}

if (RESET) {
    db.exec('BEGIN');
    db.prepare("UPDATE funds SET region_excluded=0 WHERE region_excluded=1").run();
    db.exec('COMMIT');
    const total = db.prepare('SELECT count(*) c FROM funds').get().c;
    const active = db.prepare("SELECT count(*) c FROM funds WHERE excluded=0 AND mainstream=1 AND (region_excluded=0 OR region_excluded IS NULL)").get().c;
    console.log(`[reset] 已取消全部港股标记。默认可见(股票+主流): ${active} / 总 ${total}`);
    process.exit(0);
}

// 1) 收集所有港股/中国资产为主的 code：
//   - 规则 A: 基金名称含港股/中国概念关键词
//   - 规则 B: 官方季报真实持仓 (中国大陆 + 中国香港) 占比 >= 50%
const all = db.prepare('SELECT code, name FROM funds').all();
const chinaAllocCodes = new Set(
    db.prepare("SELECT code FROM region_alloc WHERE name IN ('中国大陆', '中国香港', '中国') GROUP BY code HAVING sum(pct) >= 0.50").all().map(r => r.code)
);

const hkCodes = all.filter(f => isHK(f.name) || chinaAllocCodes.has(f.code)).map(f => f.code);

// 2) 幂等写入 region_excluded=1
db.exec('BEGIN');
db.prepare('UPDATE funds SET region_excluded=0').run();
const upd = db.prepare('UPDATE funds SET region_excluded=1 WHERE code=?');
for (const code of hkCodes) upd.run(code);
db.exec('COMMIT');

// 3) 统计影响
const totalMarked = db.prepare('SELECT count(*) c FROM funds WHERE region_excluded=1').get().c;
const inWorking = db.prepare("SELECT count(*) c FROM funds WHERE region_excluded=1 AND excluded=0 AND mainstream=1").get().c;
const visibleNow = db.prepare("SELECT count(*) c FROM funds WHERE excluded=0 AND mainstream=1 AND (region_excluded=0 OR region_excluded IS NULL)").get().c;

// 仅看"港股为主"在各子口径的拆分
const byPill = db.prepare(`SELECT pill, count(*) c FROM funds WHERE region_excluded=1 GROUP BY pill ORDER BY c DESC`).all();

console.log('=== 离岸中国(港股/中概)为主基金标记完成 ===');
console.log(`标记总数(全量): ${totalMarked} 只`);
console.log(`其中处于「股票+主流」工作集、已被默认视图剔除: ${inWorking} 只`);
console.log(`默认可见(股票+主流+非港股/中概): ${visibleNow} 只（本次剔除 ${inWorking} 只，由 ${visibleNow + inWorking} 降至 ${visibleNow}）`);
console.log('\n按子标签拆分(标记总数):');
for (const r of byPill) console.log('  ' + String(r.pill).padEnd(16) + ' ' + r.c);
console.log('\n数据零删除；恢复: node jobs/mark_hk.mjs --reset');
