// 导出当前默认可见基金（股票为主 + 主流 + 非港股/中概）为 Excel
// 默认视图口径：excluded=0 AND mainstream=1 AND region_excluded=0
import { getDb } from '../db/sqlite.js';
import { mkdirSync } from 'node:fs';
import ExcelJS from '/Users/lingtongwang/.workbuddy/binaries/node/workspace/node_modules/exceljs/excel.js';

const db = getDb();

const TAB_CN = { us: '美股', apac: '亚太', europe: '欧洲', other: '其他/全球' };
const PERIOD_COLS = [
    ['1m', '近1月%'], ['3m', '近3月%'], ['6m', '近6月%'],
    ['1y', '近1年%'], ['ytd', '年初至今%'], ['since', '成立以来%'], ['annual', '年化%'],
];

// 可见基金
const funds = db.prepare(
    `SELECT code,name,raw_type,tab,pill,scale,risk_level
     FROM funds WHERE excluded=0 AND mainstream=1 AND (region_excluded=0 OR region_excluded IS NULL)
     ORDER BY scale DESC`
).all();

// 文件名按实际数量动态命名，避免与实际行数不符
const OUT_DIR = '/Users/lingtongwang/Documents/Project/fund_dashboard/exports';
const OUT = `${OUT_DIR}/主流基金_${funds.length}只.xlsx`;
mkdirSync(OUT_DIR, { recursive: true });

// 预取各类数据
const perfRows = db.prepare('SELECT code,period,ret FROM performance').all();
const perfMap = {};
for (const r of perfRows) { (perfMap[r.code] ||= {})[r.period] = r.ret; }

const riskRows = db.prepare('SELECT code,sharpe,max_drawdown,volatility FROM risk_metrics').all();
const riskMap = {};
for (const r of riskRows) riskMap[r.code] = r;

const navStmt = db.prepare('SELECT date,nav FROM daily_nav WHERE code=? ORDER BY date DESC LIMIT 1');
const regionStmt = db.prepare('SELECT name,pct FROM region_alloc WHERE code=? ORDER BY pct DESC');
const limitStmt = db.prepare('SELECT limit_amount FROM daily_nav WHERE code=? AND limit_amount IS NOT NULL LIMIT 1');

// 注意口径：performance.ret 已是百分比(computePerformance 内 ×100)，直接保留；
// risk.max_drawdown/volatility 是小数(需 ×100)；sharpe 无量纲(原样)。
const asPct = (v) => (v === null || v === undefined ? null : +(+v).toFixed(2));      // 已是百分数
const fracToPct = (v) => (v === null || v === undefined ? null : +(v * 100).toFixed(2)); // 小数是比率

const rows = funds.map((f) => {
    const nav = navStmt.get(f.code);
    const regions = regionStmt.all(f.code);
    const lim = limitStmt.get(f.code);
    const perf = perfMap[f.code] || {};
    const risk = riskMap[f.code] || {};
    const regionSummary = regions.length
        ? regions.slice(0, 3).map(r => `${r.name}${(r.pct * 100).toFixed(1)}%`).join(' / ')
        : '—';
    return {
        code: f.code,
        name: f.name,
        type: f.raw_type || '',
        region: TAB_CN[f.tab] || f.tab || '',
        sub: f.pill || '',
        scale: f.scale ?? null,
        risk: f.risk_level || '',
        regionDist: regionSummary,
        limit: lim ? lim.limit_amount : '无限购',
        navDate: nav ? nav.date : '',
        nav: nav ? nav.nav : null,
        m1: asPct(perf['1m']), m3: asPct(perf['3m']), m6: asPct(perf['6m']),
        y1: asPct(perf['1y']), ytd: asPct(perf['ytd']), since: asPct(perf['since']), annual: asPct(perf['annual']),
        sharpe: asPct(risk.sharpe),
        mdd: fracToPct(risk.max_drawdown),
        vol: fracToPct(risk.volatility),
    };
});

// 写 Excel
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('主流基金');
ws.columns = [
    { header: '代码', key: 'code', width: 10 },
    { header: '名称', key: 'name', width: 34 },
    { header: '类型', key: 'type', width: 18 },
    { header: '地区大区', key: 'region', width: 10 },
    { header: '地区子标签', key: 'sub', width: 12 },
    { header: '规模(亿元)', key: 'scale', width: 12 },
    { header: '风险等级', key: 'risk', width: 9 },
    { header: '地区分布(晨星)', key: 'regionDist', width: 40 },
    { header: '单日限购', key: 'limit', width: 12 },
    { header: '最新净值日期', key: 'navDate', width: 14 },
    { header: '单位净值', key: 'nav', width: 10 },
    { header: '近1月%', key: 'm1', width: 9 },
    { header: '近3月%', key: 'm3', width: 9 },
    { header: '近6月%', key: 'm6', width: 9 },
    { header: '近1年%', key: 'y1', width: 9 },
    { header: '年初至今%', key: 'ytd', width: 11 },
    { header: '成立以来%', key: 'since', width: 11 },
    { header: '年化%', key: 'annual', width: 9 },
    { header: '夏普', key: 'sharpe', width: 8 },
    { header: '最大回撤%', key: 'mdd', width: 11 },
    { header: '波动率%', key: 'vol', width: 9 },
];
ws.getRow(1).font = { bold: true };
ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
const numFmt = { numFmt: '0.00' };
for (const r of rows) {
    const row = ws.addRow(r);
    for (const k of ['scale', 'nav', 'm1', 'm3', 'm6', 'y1', 'ytd', 'since', 'annual', 'sharpe', 'mdd', 'vol']) {
        const c = row.getCell(k);
        if (c.value !== null && c.value !== undefined) c.numFmt = '0.00';
    }
}

await wb.xlsx.writeFile(OUT);
console.log(`已导出 ${rows.length} 只基金 -> ${OUT}`);
console.log('列:', ws.columns.map(c => c.header).join(' | '));
