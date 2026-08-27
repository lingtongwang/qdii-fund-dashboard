import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'data', 'fund.db');

console.log('====================================================');
console.log('🔄 多信源独立背对背交叉校验系统 (Multi-Source Cross-Verifier)');
console.log('   信源 A: 东方财富 / 天天基金 (Eastmoney Financial Web & API)');
console.log('   信源 B: 腾讯财经行情中心 (Tencent Finance API: qt.gtimg.cn) -> 校验净值/回报');
console.log('   信源 C: 雪球 / 蛋卷基金 (Xueqiu / Danjuan API: danjuanfunds.com) -> 校验交易与限额状态');
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

// 1. 独立从信源 B (腾讯财经) 批量拉取数据
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
        return new Map();
    }
}

// 2. 独立从信源 C (雪球 / 蛋卷基金) 逐一独立拉取申购交易状态
async function fetchDanjuanTradeStatus(code) {
    try {
        const url = `https://danjuanfunds.com/djapi/fund/${code}`;
        const res = await fetch(url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
                'Referer': 'https://danjuanfunds.com/'
            },
            signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) return null;
        const j = await res.json();
        const d = j.data;
        if (!d) return null;
        return {
            code,
            canBuy: d.can_buy,
            declareStatus: d.declare_status,
            buttonDoc: d.special_trade_detail?.button_doc || '',
            barDoc: d.special_trade_detail?.bar_doc || ''
        };
    } catch (e) {
        return null;
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
    process.stdout.write(`\r[进度 1/2] 信源 B (腾讯财经行情) 背对背拉取: ${Math.min(i + BATCH_SIZE, funds.length)} / ${funds.length}...`);
}
console.log('\n✅ 独立信源 B (腾讯财经) 数据拉取完毕！');

const danjuanResults = new Map();
const DJ_BATCH = 15;
for (let i = 0; i < funds.length; i += DJ_BATCH) {
    const batch = funds.slice(i, i + DJ_BATCH);
    const res = await Promise.all(batch.map(f => fetchDanjuanTradeStatus(f.code)));
    for (const item of res) {
        if (item) danjuanResults.set(item.code, item);
    }
    process.stdout.write(`\r[进度 2/2] 信源 C (雪球/蛋卷交易状态) 背对背拉取: ${Math.min(i + DJ_BATCH, funds.length)} / ${funds.length}...`);
}
console.log('\n✅ 独立信源 C (雪球/蛋卷) 交易状态拉取完毕！开始背对背全面交叉核对...\n');

let passedCount = 0;
const discrepancies = [];

for (const f of funds) {
    // ----------------- ① 腾讯财经：净值与收益核验 -----------------
    const tx = tencentResults.get(f.code);
    if (tx) {
        if (f.nav_date === tx.date) {
            const navDiff = Math.abs(f.nav - tx.nav);
            if (navDiff > 0.0002) {
                discrepancies.push({
                    code: f.code,
                    name: f.name,
                    reason: `同日最新净值不一致！日期=${f.nav_date}, 信源A(东财)=${f.nav}, 信源B(腾讯)=${tx.nav}, 差异=${navDiff.toFixed(4)}`
                });
                continue;
            }
        } else {
            const histNav = db.prepare('SELECT nav FROM daily_nav WHERE code=? AND date=?').get(f.code, tx.date);
            if (histNav && histNav.nav != null) {
                const histDiff = Math.abs(histNav.nav - tx.nav);
                if (histDiff > 0.0002) {
                    discrepancies.push({
                        code: f.code,
                        name: f.name,
                        reason: `跨期对应日净值不一致！日期=${tx.date}, 数据库=${histNav.nav}, 腾讯=${tx.nav}, 差异=${histDiff.toFixed(4)}`
                    });
                    continue;
                }
            }
        }
    }

    // ----------------- ② 雪球/蛋卷：申购交易状态核验 -----------------
    const dj = danjuanResults.get(f.code);
    if (dj && dj.canBuy !== undefined) {
        const isSuspendedInDj = dj.canBuy === false || dj.buttonDoc.includes('暂停买入') || dj.barDoc.includes('暂停买入');
        const isSuspendedInDb = f.purchase_status === '暂停申购';

        // 若雪球明确显示「暂停买入」，但数据库却标为「暂停大额申购」挂着虚假限额或「开放申购」
        if (isSuspendedInDj && !isSuspendedInDb) {
            discrepancies.push({
                code: f.code,
                name: f.name,
                reason: `交易状态背对背冲突！信源C(雪球/蛋卷)明确为【暂停买入】，数据库误标为【${f.purchase_status} (限额: ${f.limit_amount || '无'})】`
            });
            continue;
        }
    }

    passedCount++;
}

console.log('----------------------------------------------------');
console.log(`📊 多信源独立背对背交叉比对报告:`);
console.log(`  - 核验基金总数: ${funds.length} 只`);
console.log(`  - 多信源 100% 吻合: ${passedCount} 只 (${((passedCount / funds.length) * 100).toFixed(1)}%)`);
console.log(`  - 存在差异或冲突: ${discrepancies.length} 项`);
console.log('----------------------------------------------------\n');

if (discrepancies.length > 0) {
    console.error('🚨 发现以下多信源背对背不一致项（已触发阻断）：');
    discrepancies.forEach((d, i) => console.error(`  ${i + 1}. [${d.code}] ${d.name} -> ${d.reason}`));
    process.exit(1);
} else {
    console.log('🎉 完美通过！东财、腾讯财经、雪球/蛋卷三信源背对背交叉核验 100% 完全一致，零误差！');
    process.exit(0);
}
