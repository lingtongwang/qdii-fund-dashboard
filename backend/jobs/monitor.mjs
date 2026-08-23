// 数据质量监控：检查各层覆盖率 + 净值停更，输出告警。
// 用法：node jobs/monitor.mjs     （独立运行，打印报告）
// 或由 scheduler 在每日/季度任务后调用 checkHealth() 打印日志。
import { getDb } from '../db/sqlite.js';
import { FUNDS } from '../config/funds.js';

// 计算从指定日期到今天之间的「交易日」天数（跳过周六日）
function businessDaysSince(dateStr) {
  if (!dateStr) return 999;
  const start = new Date(dateStr + 'T00:00:00');
  const end = new Date();
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return Math.max(0, count - 1); // 不含起始当天
}

export async function checkHealth() {
  const db = getDb();
  const TOTAL = FUNDS.length;
  const q = (sql) => Object.values(db.prepare(sql).get())[0];
  const cov = {
    funds: q('SELECT count(*) FROM funds'),
    dailyNav: q('SELECT count(DISTINCT code) FROM daily_nav'),
    risk: q('SELECT count(DISTINCT code) FROM risk_metrics'),
    asset: q('SELECT count(DISTINCT code) FROM asset_alloc'),
    performance: q('SELECT count(DISTINCT code) FROM performance'),
    region: q('SELECT count(DISTINCT code) FROM region_alloc'),
    industry: q('SELECT count(DISTINCT code) FROM industry_alloc'),
    holdings: q('SELECT count(DISTINCT code) FROM holdings'),
    limit: q('SELECT count(DISTINCT code) FROM (SELECT DISTINCT code FROM daily_nav WHERE limit_amount IS NOT NULL)'),
  };

  const lastNav = db.prepare('SELECT max(date) mx FROM daily_nav').get().mx;
  const daysGap = businessDaysSince(lastNav);

  const alerts = [];
  // 核心层覆盖率下限（地区/行业天然有源无数据的缺口，不计入告警）
  const coreMin = { funds: 100, dailyNav: 97, risk: 97, asset: 97, performance: 97 };
  for (const [k, min] of Object.entries(coreMin)) {
    const pct = (cov[k] / TOTAL) * 100;
    if (pct < min) alerts.push(`覆盖率偏低: ${k} ${pct.toFixed(1)}% < ${min}%`);
  }
  if (daysGap > 3) alerts.push(`净值停更: 最新 ${lastNav}，已 ${daysGap} 个交易日未更新（预期每个交易日刷新）`);

  return { TOTAL, cov, lastNav, daysGap, alerts };
}

// 独立运行
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await checkHealth();
  console.log('=== 数据质量监控 ===');
  console.log(`基金总数: ${r.TOTAL}`);
  console.log(`净值最新日期: ${r.lastNav}  (距今天 ${r.daysGap} 个交易日)`);
  for (const [k, v] of Object.entries(r.cov)) {
    console.log(`  ${k.padEnd(12)} ${v}/${r.TOTAL}  (${(v / r.TOTAL * 100).toFixed(1)}%)`);
  }
  if (r.alerts.length) {
    console.log('\n⚠️  告警:');
    for (const a of r.alerts) console.log('  - ' + a);
  } else {
    console.log('\n✅ 全部指标正常');
  }
  process.exit(0);
}
