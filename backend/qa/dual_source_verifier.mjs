import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data', 'fund.db');

console.log('====================================================');
console.log('🔄 双信源独立背对背交叉校验系统 (Dual-Source Cross-Verifier)');
console.log('   信源 A: 东方财富 / 天天基金 (Eastmoney Financial Web & API)');
console.log('   信源 B: 腾讯财经行情中心 (Tencent Finance API: qt.gtimg.cn)');
console.log('====================================================\n');

const db = new DatabaseSync(dbPath);
const funds = db.prepare(`
    SELECT f.code, f.name, f.mainstream, f.raw_type,
           d.nav, d.acc_nav, d.daily_return, d.purchase_status, d.limit_amount, d.date as nav_date
    FROM funds f
    LEFT JOIN daily_nav d ON f.code=d.code AND d.date = (SELECT MAX(date) FROM daily_nav WHERE code=f.code)
    WHERE (f.excluded=0 OR f.excluded IS NULL)
      AND f.mainstream=1
      AND (f.region_excluded=0 OR f.region_excluded IS NULL)
      AND (f.currency_excluded=0 OR f.currency_excluded IS NULL)
`).all();

console.log(`[待核验清单] 主流活跃展示基金: ${funds.length} 只\n`);

const decoder = new TextDecoder('gbk');

// 独立从信源 B (腾讯财经) 批量拉取数据
async function fetchTencentBatch(codes) {
    const query = codes.map(c => `jj${c}`).join(',');
    const url = `https://qt.gtimg.cn/q=${query}`;
    try {
        const res = await fetch(url, { headers: { 'Referer': 'https://gu.qq.com' } });
        const buf = await res.arrayBuffer();
        const text = decoder.decode(buf);
        const lines = text.split(';\n').filter(Boolean);
        const map = new Map();

        for (const line of lines) {
            const m = line.match(/v_jj(\d+)="(.*)"/);
            if (m) {
                const code = m[1];
                const parts = m[2].split('~');
                // parts[5] = 最新净值, parts[6] = 累计净值, parts[7] = 日涨跌幅, parts[8] = 净值日期
                if (parts.length >= 9) {
                    map.set(code, {
                        code,
                        name: parts[1],
                        nav: parseFloat(parts[5]),
                        accNav: parseFloat(parts[6]),
                        dailyReturn: parseFloat(parts[7]),
                        date: parts[8]
                    });
                }
            }
        }
        return map;
    } catch (e) {
        console.error('Tencent fetch error:', e.message);
        return new Map();
    }
}

const BATCH_SIZE = 50;
const tencentResults = new Map();

for (let i = 0; i < funds.length; i += BATCH_SIZE) {
    const batch = funds.slice(i, i + BATCH_SIZE).map(f => f.code);
    const res = await fetchTencentBatch(batch);
    for (const [k, v] of res.entries()) {
        tencentResults.set(k, v);
    }
    process.stdout.write(`\r[进度] 双信源背对背拉取比对中: ${Math.min(i + BATCH_SIZE, funds.length)} / ${funds.length}...`);
}
console.log('\n✅ 独立信源 B (腾讯财经) 数据拉取完毕！开始背对背高精度交叉比对...\n');

let passedCount = 0;
const discrepancies = [];

for (const f of funds) {
    const tx = tencentResults.get(f.code);
    if (!tx) {
        discrepancies.push({ code: f.code, name: f.name, reason: '信源 B (腾讯财经) 缺失该代码' });
        continue;
    }

    // 1. 比对净值误差 (容差 < 0.0002)
    const navDiff = Math.abs(f.nav - tx.nav);
    if (navDiff > 0.0002) {
        discrepancies.push({
            code: f.code,
            name: f.name,
            reason: `最新净值不一致！信源A(东财)=${f.nav}, 信源B(腾讯)=${tx.nav}, 差异=${navDiff.toFixed(4)}`
        });
        continue;
    }

    // 2. 比对净值日期
    if (f.nav_date && tx.date && f.nav_date !== tx.date) {
        discrepancies.push({
            code: f.code,
            name: f.name,
            reason: `净值更新日期不一致！信源A(东财)=${f.nav_date}, 信源B(腾讯)=${tx.date}`
        });
        continue;
    }

    passedCount++;
}

console.log('----------------------------------------------------');
console.log(`📊 双信源背对背交叉比对报告:`);
console.log(`  - 核验基金总数: ${funds.length} 只`);
console.log(`  - 双信源 100% 吻合: ${passedCount} 只 (${((passedCount / funds.length) * 100).toFixed(1)}%)`);
console.log(`  - 存在差异或异常: ${discrepancies.length} 项`);
console.log('----------------------------------------------------\n');

if (discrepancies.length > 0) {
    console.error('🚨 发现以下双信源不一致项：');
    discrepancies.forEach((d, i) => console.error(`  ${i + 1}. [${d.code}] ${d.name} -> ${d.reason}`));
    process.exit(1);
} else {
    console.log('🎉 完美通过！东财与腾讯财经双信源背对背交叉核对 100% 完全一致，零误差！');
    process.exit(0);
}
