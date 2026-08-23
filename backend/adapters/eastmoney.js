// 东方财富适配器（免费 HTTP 端点，无需 token）
// 主源：pingzhongdata/{code}.js（一份文件含规模/费率/经理/NAV历史/资产配置/收益）
// 状态源：api.fund.eastmoney.com/f10/lsjz（申购/赎回状态）
// 持仓源：FundArchivesDatas.aspx?type=jjcc（前十大名称+占比）
import { getString, getJson } from '../lib/http.js';

const UA = { 'User-Agent': 'Mozilla/5.0' };

// ---- 从 pingzhongdata.js 文本中抽取指定 var 的 JSON 值 ----
function extractVar(text, name) {
    const idx = text.search(new RegExp('var\\s+' + name.replace(/[$]/g, '\\$') + '\\s*='));
    if (idx < 0) return undefined;
    let p = text.indexOf('=', idx) + 1;
    let depth = 0, inStr = null, start = p;
    for (; p < text.length; p++) {
        const c = text[p];
        if (inStr) { if (c === inStr) inStr = null; continue; }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if (c === '{' || c === '[' || c === '(') depth++;
        else if (c === '}' || c === ']' || c === ')') { depth--; if (depth === 0) { p++; break; } }
        else if (c === ';' && depth === 0) break;
    }
    const raw = text.slice(start, p).trim();
    try { return JSON.parse(raw); } catch { return undefined; }
}

// 取最新一期的资产配置百分比（含真实季度日，如 2026-06-30）
function latestAssetAlloc(alloc) {
    if (!alloc || !alloc.series) return [];
    const cats = alloc.categories || [];
    const lastIdx = cats.length - 1;
    if (lastIdx < 0) return [];
    const date = cats[lastIdx] || null; // 真实报告期
    const out = [];
    for (const s of alloc.series) {
        if (s.type === 'line') continue; // 净资产是副轴折线，跳过
        const v = (s.data && s.data[lastIdx]) ?? null;
        if (v == null) continue;
        // 名称如 "股票占净比" → 取 "股票"
        const name = s.name.replace(/占净比|占值比|占比/g, '');
        out.push({ name, pct: Number(v), date });
    }
    return out;
}

export async function fetchPingzhong(code) {
    const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js`;
    const text = await getString(url, { referer: 'https://fund.eastmoney.com/', headers: UA });
    if (!text || text.length < 1000) throw new Error('pingzhongdata 返回异常');

    const name = extractVar(text, 'fS_name');
    const fluct = extractVar(text, 'Data_fluctuationScale');
    const rate = extractVar(text, 'fund_Rate');
    const sourceRate = extractVar(text, 'fund_sourceRate');
    const minSg = extractVar(text, 'fund_minsg');
    const managers = extractVar(text, 'Data_currentFundManager');
    const netWorth = extractVar(text, 'Data_netWorthTrend') || [];
    const acWorth = extractVar(text, 'Data_ACWorthTrend') || [];
    const assetAlloc = extractVar(text, 'Data_assetAllocation');
    const rateInSimilar = extractVar(text, 'Data_rateInSimilarType');

    // 官方阶段收益率
    const syl1y = extractVar(text, 'syl_1y'); // 近1月
    const syl3y = extractVar(text, 'syl_3y'); // 近3月
    const syl6y = extractVar(text, 'syl_6y'); // 近6月
    const syl1n = extractVar(text, 'syl_1n'); // 近1年

    // 规模：最新一期净资产（亿元）
    let scale = null;
    if (fluct && fluct.series && fluct.series.length) {
        scale = Number(fluct.series[fluct.series.length - 1].y);
    }

    // 申购原费率 / 优惠费率（注意：EM 的 fund_sourceRate 为申购原费率，真实管理费/托管费在 jjfl 页面）
    const subscribeSourceRate = sourceRate != null ? `${sourceRate}%` : null;
    const subscribeDiscountRate = rate != null ? `${rate}%` : null;

    const fm = (Array.isArray(managers) && managers[0] && managers[0].name) ? managers[0].name : null;

    // NAV 历史：合并净值 + 累计净值 + 日涨跌
    const accMap = new Map(acWorth.map(([x, y]) => [x, y]));
    const navHistory = netWorth.map(r => ({
        date: new Date(r.x).toISOString().slice(0, 10),
        nav: Number(r.y),
        accNav: accMap.has(r.x) ? Number(accMap.get(r.x)) : Number(r.y),
        dailyReturn: (r.equityReturn != null) ? Number(r.equityReturn) : null,
    }));

    return {
        name: name || null,
        subscribeSourceRate,
        subscribeDiscountRate,
        minSg,                      // 起购金额（元）
        fm,                         // 基金经理
        navHistory,                 // [{date,nav,accNav,dailyReturn}]
        acWorthHistory: acWorth,    // 完整累计净值序列（自成立以来）
        stageReturns: {
            '1m': syl1y != null && syl1y !== '' ? Number(syl1y) : null,
            '3m': syl3y != null && syl3y !== '' ? Number(syl3y) : null,
            '6m': syl6y != null && syl6y !== '' ? Number(syl6y) : null,
            '1y': syl1n != null && syl1n !== '' ? Number(syl1n) : null,
        },
        assetAlloc: latestAssetAlloc(assetAlloc), // [{name,pct}]
        rateInSimilar,              // 排名原始数据（尽力解析）
    };
}

// jbgk：抓取基金基本概况（管理人、托管人、成立日期、基准、跟踪标的）
export async function fetchJbgk(code) {
    try {
        const url = `https://fundf10.eastmoney.com/jbgk_${code}.html`;
        const html = await getString(url, { referer: 'https://fundf10.eastmoney.com/', headers: UA });
        const { load } = await import('cheerio');
        const $ = load(html);
        const info = {};
        $('table.info tr').each((_, el) => {
            const ths = $(el).find('th');
            const tds = $(el).find('td');
            ths.each((j, th) => {
                const key = $(th).text().trim();
                const val = $(tds[j]).text().trim();
                if (key && val) info[key] = val;
            });
        });
        return {
            fullName: info['基金全称'] || null,
            shortName: info['基金简称'] || null,
            manager: info['基金管理人'] || null,
            custodian: info['基金托管人'] || null,
            inceptionDate: info['成立日期/规模'] || null,
            benchmark: info['业绩比较基准'] || null,
            trackingIndex: info['跟踪标的'] || null,
        };
    } catch {
        return null;
    }
}

// lsjz：取最新若干行，主要拿申购/赎回状态（SGZT/SHZT）
export async function fetchLsjzLatest(code) {
    const ts = Date.now();
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=5&_=${ts}`;
    const json = await getJson(url, { referer: 'https://fundf10.eastmoney.com/', headers: UA });
    const list = json?.Data?.LSJZList || [];
    if (!list.length) return null;
    // 列表按日期降序，取最新一条
    const r = list[0];
    return {
        date: r.FSRQ,
        nav: r.DWJZ != null ? Number(r.DWJZ) : null,
        accNav: r.LJJZ != null ? Number(r.LJJZ) : null,
        dailyReturn: r.JZZZL != null ? Number(r.JZZZL) : null,
        purchaseStatusRaw: r.SGZT || '开放',
        redeemStatusRaw: r.SHZT || '开放',
    };
}

// 申购状态归一化（对齐前端 purchaseStatus 取值）
export function normalizePurchaseStatus(raw) {
    if (!raw) return '开放';
    if (raw.includes('暂停')) return raw.includes('大额') ? '暂停大额申购' : '暂停';
    if (raw.includes('限制')) return '暂停大额申购';
    if (raw.includes('开放')) return '开放';
    return raw;
}

// jjcc：前十大持仓（名称 + 占净值比例），并抽取真实季报日（报告期）
export async function fetchHoldings(code) {
    const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=`;
    const text = await getString(url, { referer: 'https://fundf10.eastmoney.com/', headers: UA });
    const m = text.match(/content\s*:\s*"(?:[^"\\]|\\.)*"/);
    if (!m) return { rows: [], reportDate: null };
    const html = m[0].slice(m[0].indexOf('"') + 1, -1).replace(/\\"/g, '"').replace(/\\r|\\n|\\t/g, '');
    const { load } = await import('cheerio');
    const $ = load(html);
    // 取第一个 boxitem（最新报告期）内的表格
    const boxitem = $('.boxitem').first();
    const table = boxitem.find('table').first();
    if (!table.length) return { rows: [], reportDate: null };
    // 报告期：第一个 boxitem 内最新的日期（格式 2026-06-30 或 2026年06月30日）
    const boxText = boxitem.text();
    const dates = [...boxText.matchAll(/(20\d{2})[-年.](\d{1,2})[-月.](\d{1,2})/g)]
        .map(x => `${x[1]}-${x[2].padStart(2, '0')}-${x[3].padStart(2, '0')}`);
    const reportDate = dates.length ? dates.sort().pop() : null;
    // 按表头动态定位「名称」列与「占净值比例」列，兼容股票/债券/基金持仓
    const headerCells = table.find('tr').first().find('th,td');
    let nameCol = -1, pctCol = -1;
    headerCells.each((i, el) => {
        const txt = $(el).text().trim();
        if (nameCol < 0 && /名称/.test(txt)) nameCol = i;
        if (pctCol < 0 && /占净值比例/.test(txt)) pctCol = i;
    });
    if (nameCol < 0) nameCol = 2; // 兜底
    if (pctCol < 0) pctCol = 6;
    const rows = [];
    table.find('tr').each((_, tr) => {
        const tds = $(tr).find('td');
        if (tds.length <= nameCol) return; // 跳过表头行
        const name = $(tds[nameCol]).text().trim();
        const pctText = $(tds[pctCol]).text().trim();
        const pct = parseFloat(pctText.replace('%', ''));
        if (name && !isNaN(pct)) {
            rows.push({ rank: rows.length + 1, name, pct });
        }
    });
    return { rows: rows.slice(0, 10), reportDate };
}

// jjfl：管理费率 / 托管费率 / 申购费率 / 赎回费率
// 申购费率取首个「原费率」；赎回费率跳过 <7天 惩罚档，取标准档（通常为 7天~1年 那一档）。
export async function fetchFees(code) {
    const url = `https://fundf10.eastmoney.com/jjfl_${code}.html`;
    const html = await getString(url, { referer: 'https://fundf10.eastmoney.com/', headers: UA });
    let subscribe = null, redeem = null, manage = null, custody = null;

    // 管理费率与托管费率（运作费用表）
    const mManage = html.match(/管理费率<\/td>\s*<td[^>]*>([\d.]+)%/);
    if (mManage) manage = mManage[1] + '%';
    const mCustody = html.match(/托管费率<\/td>\s*<td[^>]*>([\d.]+)%/);
    if (mCustody) custody = mCustody[1] + '%';

    // 申购费率：首个 <td>数字%</td>（原费率档）
    const si = html.indexOf('申购费率');
    if (si >= 0) {
        const sm = html.slice(si).match(/<td[^>]*>([\d.]+)%<\/td>/);
        if (sm) subscribe = sm[1] + '%';
    }
    // 赎回费率：定位赎回费率表，跳过 <7天 惩罚档，取首个标准档费率
    const ri = html.indexOf('赎回费率');
    if (ri >= 0) {
        const seg = html.slice(ri);
        const t0 = seg.indexOf('<table');
        if (t0 >= 0) {
            const t1 = seg.indexOf('</table>', t0);
            const table = seg.slice(t0, t1 > 0 ? t1 : undefined);
            const rowMatches = [...table.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map(x => x[1]);
            for (const row of rowMatches) {
                const period = row.replace(/<[^>]+>/g, ' ');
                if (/7\s*天/.test(period)) continue;       // 跳过 <7天 惩罚档
                const cells = [...row.matchAll(/<td[^>]*>([\d.]+)%<\/td>/g)].map(x => x[1]);
                if (cells.length) { redeem = cells[cells.length - 1] + '%'; break; }
            }
        }
    }
    const feeRate = (manage && custody) ? `${manage} / ${custody}` : null;
    return { subscribe, redeem, manage, custody, feeRate };
}

// zcpz: 季报资产组合情况（精准明细：含股票、存托凭证、债券、现金、基金等完整披露）
export async function fetchZcpzAssetAlloc(code) {
    try {
        const url = `https://fundf10.eastmoney.com/zcpz_${code}.html`;
        const html = await getString(url, { referer: 'https://fundf10.eastmoney.com/', headers: UA });
        const { load } = await import('cheerio');
        const $ = load(html);

        const table = $('table').filter((i, el) => $(el).text().includes('股票占净比') || $(el).text().includes('现金占净比')).first();
        if (!table.length) return [];

        const colNames = [];
        const headerRow = table.find('thead tr').first().length ? table.find('thead tr').first() : table.find('tr').first();
        headerRow.find('th, td').each((i, el) => {
            let txt = $(el).text().trim();
            txt = txt.replace(/占净比|占净值比|占资产比/g, '');
            colNames.push(txt);
        });

        const dataRows = table.find('tbody tr').length ? table.find('tbody tr') : table.find('tr').slice(1);
        let targetRow = null;
        dataRows.each((i, el) => {
            if (!targetRow && $(el).find('td').length >= 3) {
                targetRow = $(el);
            }
        });
        if (!targetRow) return [];

        const cells = [];
        targetRow.find('td').each((i, el) => cells.push($(el).text().trim()));

        const reportDate = cells[0]?.match(/\d{4}[-年.]\d{1,2}[-月.]\d{1,2}/)?.[0]?.replace(/[年月]/g, '-').replace(/日/g, '') || null;

        const result = [];
        for (let i = 1; i < colNames.length && i < cells.length; i++) {
            const name = colNames[i];
            if (name.includes('净资产') || name.includes('报告期')) continue;
            const valStr = cells[i];
            if (!valStr || valStr === '---' || valStr === '--') continue;
            const num = parseFloat(valStr.replace(/,/g, '').replace(/%/g, ''));
            if (!isNaN(num) && num > 0) {
                result.push({
                    name,
                    pct: num / 100, // 存入数据库为小数 (0.xx)
                    date: reportDate
                });
            }
        }
        return result;
    } catch {
        return [];
    }
}

// 获取基金基础概况（包含指数基金跟踪标的指数名称 INDEXNAME、指数代码 INDEXCODE、基金类型 FTYPE 等）
export async function fetchFundBasicInfo(code) {
    try {
        const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNBasicInformation?FCODE=${code}&deviceid=Wap&plat=Wap&product=EFund&version=2.0.0`;
        const json = await getJson(url, { referer: 'https://fundf10.eastmoney.com/', headers: UA });
        const d = json?.Datas || {};
        const indexName = (d.INDEXNAME && d.INDEXNAME !== '--' && d.INDEXNAME !== '---') ? d.INDEXNAME.trim() : null;
        const indexCode = (d.INDEXCODE && d.INDEXCODE !== '--' && d.INDEXCODE !== '---') ? d.INDEXCODE.trim() : null;
        return {
            indexName,
            indexCode,
            fType: d.FTYPE || null,
            shortName: d.SHORTNAME || null
        };
    } catch {
        return { indexName: null, indexCode: null, fType: null, shortName: null };
    }
}
