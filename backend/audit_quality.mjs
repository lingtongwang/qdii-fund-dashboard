// 全面数据质检脚本：对全部表做覆盖/数值/日期/比率/一致性审计
// 用法: node --experimental-sqlite backend/audit_quality.mjs
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, 'data', 'fund.db'));
const q = s => db.prepare(s).get();
const qa = s => db.prepare(s).all();
const VISIBLE = `(excluded=0 OR excluded IS NULL) AND mainstream=1 AND (region_excluded=0 OR region_excluded IS NULL)`;

console.log('========== 0. 总体规模 ==========');
console.log('funds 总:', q('SELECT count(*) c FROM funds').c);
console.log('mainstream:', q('SELECT count(*) c FROM funds WHERE mainstream=1').c);
console.log('visible(默认视图):', q(`SELECT count(*) c FROM funds WHERE ${VISIBLE}`).c);

console.log('\n========== 1. funds 基础字段 ==========');
const feeCover = q(`SELECT count(*) c FROM funds WHERE ${VISIBLE} AND fee_rate IS NOT NULL AND fee_rate<>''`).c;
console.log(`visible fee_rate 覆盖率: ${feeCover}/119`);
const feeSub = q(`SELECT count(*) c FROM funds WHERE ${VISIBLE} AND fee_subscribe IS NOT NULL`).c;
console.log(`visible fee_subscribe: ${feeSub}/119`);
const feeRed = q(`SELECT count(*) c FROM funds WHERE ${VISIBLE} AND fee_redeem IS NOT NULL`).c;
console.log(`visible fee_redeem: ${feeRed}/119`);
// fee_rate 格式检查
const badFee = qa(`SELECT code,name,fee_rate FROM funds WHERE ${VISIBLE} AND fee_rate IS NOT NULL AND fee_rate NOT LIKE '%/%'`).slice(0,5);
console.log('fee_rate 不含"/"格式的:', badFee.length, JSON.stringify(badFee));
// 管理费>3% 或托管费>1% 异常
const feeHigh = qa(`SELECT code,name,fee_rate FROM funds WHERE ${VISIBLE} AND fee_rate GLOB '[3-9]*%'`).slice(0,5);
console.log('管理费>=3% 异常样本:', feeHigh.length, JSON.stringify(feeHigh));
// scale 范围
const scaleBad = qa(`SELECT code,name,scale FROM funds WHERE ${VISIBLE} AND (scale<0.01 OR scale>10000)`).slice(0,8);
console.log('scale 异常(<0.01亿或>10000亿):', scaleBad.length, JSON.stringify(scaleBad));
const scaleNull = q(`SELECT count(*) c FROM funds WHERE ${VISIBLE} AND (scale IS NULL OR scale=0)`).c;
console.log('visible scale 缺失/为0:', scaleNull);
// risk_level
const rlNull = q(`SELECT count(*) c FROM funds WHERE ${VISIBLE} AND (risk_level IS NULL OR risk_level='')`).c;
console.log('visible risk_level 缺失:', rlNull);
// 名称空/重复
const dupRows = qa(`SELECT name,count(*) c FROM funds WHERE mainstream=1 GROUP BY name HAVING c>1`).slice(0,5);
console.log('mainstream 重名基金:', dupRows.length, JSON.stringify(dupRows));
// tab/pill 分布
console.log('tab 分布:', JSON.stringify(qa(`SELECT tab,count(*) c FROM funds WHERE mainstream=1 GROUP BY tab`)));
console.log('pill 分布:', JSON.stringify(qa(`SELECT pill,count(*) c FROM funds WHERE mainstream=1 GROUP BY pill`)));

console.log('\n========== 2. daily_nav 净值 ==========');
console.log('NAV 总行数:', q('SELECT count(*) c FROM daily_nav').c);
console.log('有净值的基金数:', q('SELECT count(*) c FROM (SELECT DISTINCT code FROM daily_nav)').c);
console.log('NAV 最新日期(全库):', q('SELECT max(date) m FROM daily_nav').m);
// 每只 visible 基金最新 NAV 日期分布
const stale = qa(`
  SELECT code, max(date) as lastdate FROM daily_nav
  WHERE code IN (SELECT code FROM funds WHERE ${VISIBLE})
  GROUP BY code HAVING lastdate < '2026-08-01' ORDER BY lastdate ASC LIMIT 10`);
console.log('visible 最新净值早于 2026-08-01 的基金:', stale.length, JSON.stringify(stale));
// 历史 NAV 最大/最小
console.log('nav 最大值:', q('SELECT max(nav) m FROM daily_nav').m, '最小值(>0):', q('SELECT min(nav) m FROM daily_nav WHERE nav>0').m);
console.log('nav<=0 行数:', q('SELECT count(*) c FROM daily_nav WHERE nav<=0').c);
// 日涨幅异常
const retBad = q(`SELECT count(*) c FROM daily_nav WHERE daily_return>0.15 OR daily_return<-0.15`);
console.log('daily_return 超±15% 行数:', retBad.c);
const retBadSample = qa(`SELECT code,date,nav,daily_return FROM daily_nav WHERE daily_return>0.15 OR daily_return<-0.15 ORDER BY abs(daily_return) DESC LIMIT 5`);
console.log('日涨幅异常样本:', JSON.stringify(retBadSample));

console.log('\n========== 3. limit_amount 限额 ==========');
// 可见基金最新限额分布
const fs = qa(`SELECT code FROM funds WHERE ${VISIBLE}`).map(r=>r.code);
let limStats = { null:0, ok:0, huge:0 }, limSample=[];
for (const c of fs) {
  const r = db.prepare('SELECT limit_amount FROM daily_nav WHERE code=? ORDER BY date DESC LIMIT 1').get(c);
  const v = r ? r.limit_amount : null;
  if (v == null) limStats.null++;
  else if (v > 0 && v < 1000000) { limStats.ok++; if(limSample.length<8) limSample.push({code:c,v}); }
  else limStats.huge++;
}
console.log('visible 最新限额: null(无限额)', limStats.null, '合理值', limStats.ok, '异常(0或>=100万)', limStats.huge);
console.log('限额合理样本:', JSON.stringify(limSample));
// 限额是否写入历史所有日期(应只出现在最新状态)
const rowsPer = q(`SELECT count(*) c FROM daily_nav WHERE limit_amount IS NOT NULL`).c;
console.log('limit_amount 非空行数(全库):', rowsPer, '← 若过大说明写满历史');

console.log('\n========== 4. holdings 持仓 ==========');
console.log('holdings 行数:', q('SELECT count(*) c FROM holdings').c);
console.log('有持仓的基金数:', q('SELECT count(*) c FROM (SELECT DISTINCT code FROM holdings)').c);
// 日期格式
const hDates = qa('SELECT report_date, count(*) c FROM holdings GROUP BY report_date ORDER BY c DESC LIMIT 10');
console.log('report_date 分布:', JSON.stringify(hDates));
// pct 范围与合计(抽样)
const hBad = q(`SELECT count(*) c FROM holdings WHERE pct<=0 OR pct>100`);
console.log('pct 越界(<=0或>100) 行数:', hBad.c);
const hSum = qa(`
  SELECT code, report_date, sum(pct) s, count(*) n FROM holdings
  WHERE code IN (SELECT code FROM funds WHERE ${VISIBLE})
  GROUP BY code, report_date HAVING s>110 OR s<10 ORDER BY s DESC LIMIT 8`);
console.log('前十大合计异常(<10%或>110%) visible 基金:', JSON.stringify(hSum));
// rank 连续性
const rankBad = qa(`SELECT code, count(*) c FROM holdings WHERE rank NOT BETWEEN 1 AND 10 GROUP BY code LIMIT 3`);
console.log('rank 越界(非1-10) 基金数:', rankBad.length, JSON.stringify(rankBad));

console.log('\n========== 5. region_alloc 地区 ==========');
console.log('region 行数:', q('SELECT count(*) c FROM region_alloc').c);
console.log('有地区数据的基金数:', q('SELECT count(*) c FROM (SELECT DISTINCT code FROM region_alloc)').c);
const rDates = qa('SELECT report_date, count(*) c FROM region_alloc GROUP BY report_date ORDER BY c DESC LIMIT 8');
console.log('report_date 分布:', JSON.stringify(rDates));
console.log('report_date=morningstar 残留:', q(`SELECT count(*) c FROM region_alloc WHERE report_date='morningstar'`).c);
// 每基金 pct 合计(visible)
const rSum = qa(`
  SELECT code, sum(pct) s, count(*) n, min(report_date) d FROM region_alloc
  WHERE code IN (SELECT code FROM funds WHERE ${VISIBLE})
  GROUP BY code HAVING s<0.5 OR s>1.5 ORDER BY s DESC LIMIT 8`);
console.log('visible 地区合计<50%或>150% 基金:', JSON.stringify(rSum));
// pct 越界
console.log('region pct 越界行数:', q(`SELECT count(*) c FROM region_alloc WHERE pct<=0 OR pct>1.5`).c);

console.log('\n========== 6. industry_alloc 行业 ==========');
console.log('industry 行数:', q('SELECT count(*) c FROM industry_alloc').c);
console.log('有行业数据的基金数:', q('SELECT count(*) c FROM (SELECT DISTINCT code FROM industry_alloc)').c);
const iDates = qa('SELECT report_date, count(*) c FROM industry_alloc GROUP BY report_date ORDER BY c DESC LIMIT 8');
console.log('report_date 分布:', JSON.stringify(iDates));
const iBad = qa(`SELECT report_date,count(*) c FROM industry_alloc WHERE report_date NOT LIKE '20%' GROUP BY report_date`);
console.log('非日期格式 report_date:', JSON.stringify(iBad));
const iSum = qa(`
  SELECT code, sum(pct) s, count(*) n FROM industry_alloc
  WHERE code IN (SELECT code FROM funds WHERE ${VISIBLE})
  GROUP BY code HAVING s<0.5 OR s>1.5 ORDER BY s DESC LIMIT 8`);
console.log('visible 行业合计<50%或>150% 基金:', JSON.stringify(iSum));
console.log('industry pct 越界行数:', q(`SELECT count(*) c FROM industry_alloc WHERE pct<=0 OR pct>1.5`).c);

console.log('\n========== 7. asset_alloc 资产配置 ==========');
console.log('asset 行数:', q('SELECT count(*) c FROM asset_alloc').c);
console.log('有资产数据的基金数:', q('SELECT count(*) c FROM (SELECT DISTINCT code FROM asset_alloc)').c);
const aDates = qa('SELECT report_date, count(*) c FROM asset_alloc GROUP BY report_date ORDER BY c DESC LIMIT 8');
console.log('report_date 分布:', JSON.stringify(aDates));
const aBad = qa(`SELECT report_date,count(*) c FROM asset_alloc WHERE report_date NOT LIKE '20%' GROUP BY report_date`);
console.log('非日期格式 report_date:', JSON.stringify(aBad));
const aSum = qa(`
  SELECT code, sum(pct) s, count(*) n FROM asset_alloc
  WHERE code IN (SELECT code FROM funds WHERE ${VISIBLE})
  GROUP BY code HAVING s<0.6 OR s>1.6 ORDER BY s DESC LIMIT 8`);
console.log('visible 资产合计<60%或>160% 基金:', JSON.stringify(aSum));

console.log('\n========== 8. performance / risk_metrics ==========');
for (const t of ['performance','risk_metrics']) {
  try {
    const cols = db.prepare('PRAGMA table_info('+t+')').all().map(c=>c.name);
    console.log(`${t} 列:`, cols.join(', '));
    console.log(`${t} 行数:`, q(`SELECT count(*) c FROM ${t}`).c);
  } catch(e){ console.log(`${t}: ERR ${e.message}`); }
}
// performance 数值范围
try {
  const pCols = db.prepare('PRAGMA table_info(performance)').all().map(c=>c.name);
  const numCols = pCols.filter(n=>!['code','report_date'].includes(n));
  for (const col of numCols.slice(0,8)) {
    const r = q(`SELECT min(${col}) mn, max(${col}) mx FROM performance WHERE ${col} IS NOT NULL`);
    console.log(`performance.${col}: min=${r.mn} max=${r.mx}`);
  }
} catch(e){ console.log('performance 数值检查 ERR', e.message); }
// risk_metrics 数值范围
try {
  const rCols = db.prepare('PRAGMA table_info(risk_metrics)').all().map(c=>c.name);
  const numCols = rCols.filter(n=>!['code','report_date'].includes(n));
  for (const col of numCols.slice(0,10)) {
    const r = q(`SELECT min(${col}) mn, max(${col}) mx FROM risk_metrics WHERE ${col} IS NOT NULL`);
    console.log(`risk_metrics.${col}: min=${r.mn} max=${r.mx}`);
  }
} catch(e){ console.log('risk_metrics 数值检查 ERR', e.message); }

console.log('\n========== 9. 关联一致性 ==========');
// visible 基金在各表的存在率
const cov = qa(`
  SELECT
    count(*) funds,
    sum(CASE WHEN code IN (SELECT DISTINCT code FROM daily_nav) THEN 1 ELSE 0 END) has_nav,
    sum(CASE WHEN code IN (SELECT DISTINCT code FROM holdings) THEN 1 ELSE 0 END) has_hold,
    sum(CASE WHEN code IN (SELECT DISTINCT code FROM region_alloc) THEN 1 ELSE 0 END) has_region,
    sum(CASE WHEN code IN (SELECT DISTINCT code FROM industry_alloc) THEN 1 ELSE 0 END) has_ind,
    sum(CASE WHEN code IN (SELECT DISTINCT code FROM asset_alloc) THEN 1 ELSE 0 END) has_asset,
    sum(CASE WHEN code IN (SELECT DISTINCT code FROM performance) THEN 1 ELSE 0 END) has_perf,
    sum(CASE WHEN code IN (SELECT DISTINCT code FROM risk_metrics) THEN 1 ELSE 0 END) has_risk
  FROM funds WHERE ${VISIBLE}`);
console.log('visible 基金各表覆盖率:', JSON.stringify(cov));
console.log('\n========== 审计完成 ==========');
