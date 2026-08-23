// 编排器：逐基金抓取 → 持久化；并提供 API 聚合读取
import { getDb } from './db/sqlite.js';
import { fetchPingzhong, fetchLsjzLatest, fetchHoldings, fetchFees, normalizePurchaseStatus, fetchZcpzAssetAlloc, fetchJbgk } from './adapters/eastmoney.js';
import { findQuarterlyArtCode, parseReportContent, fetchAnnContent, fetchTradeLimit } from './adapters/report.js';
import { classify } from './classify.js';
import { computeRisk } from './risk.js';
import { mapFund } from './normalize/mapper.js';
import { formatMergedFundName, stem } from './normalize/shares.js';
import { throttle, sleep } from './lib/http.js';

const RISK_BY_TYPE = {
    'QDII-普通股票': 'R4-中高风险',
    'QDII-混合偏股': 'R4-中高风险',
    'QDII-混合灵活': 'R4-中高风险',
    'QDII-混合平衡': 'R4-中高风险',
    'QDII-纯债': 'R2-中低风险',
    'QDII-混合债': 'R2-中低风险',
    'QDII-商品': 'R5-高风险',
    'QDII-REITs': 'R4-中高风险',
    'QDII-FOF': 'R4-中高风险',
};

function cutoffDate(years = 2) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString().slice(0, 10);
}

// 从 NAV 历史与官方披露算阶段收益
function computePerformance(navHistory, acWorthHistory = [], stageReturns = {}) {
    const asc = [...navHistory].sort((a, b) => a.date.localeCompare(b.date));
    if (asc.length < 2) return {};
    const last = asc[asc.length - 1];

    // 优先使用官方披露的阶段收益率（已做除权除息复权）
    const ret1m = stageReturns['1m'] ?? null;
    const ret3m = stageReturns['3m'] ?? null;
    const ret6m = stageReturns['6m'] ?? null;
    const ret1y = stageReturns['1y'] ?? null;

    // 今年以来 (YTD) - 基于累计净值 (accNav)
    const currentYear = new Date().getFullYear();
    const yearStart = asc.find(r => r.date >= `${currentYear}-01-01`) || asc[0];
    const ytdRet = (yearStart && yearStart.accNav > 0 && last.accNav > 0)
        ? (last.accNav / yearStart.accNav - 1) * 100
        : null;

    // 成立以来 (Since Inception) - 基于完整 acWorthHistory 累计净值
    let sinceRet = null;
    let annualCAGR = null;
    if (Array.isArray(acWorthHistory) && acWorthHistory.length >= 2) {
        const firstAc = acWorthHistory[0][1];
        const lastAc = acWorthHistory[acWorthHistory.length - 1][1];
        const firstTs = acWorthHistory[0][0];
        const lastTs = acWorthHistory[acWorthHistory.length - 1][0];
        if (firstAc > 0 && lastAc > 0) {
            sinceRet = (lastAc / firstAc - 1) * 100;
            const years = (lastTs - firstTs) / (365.25 * 86400000);
            if (years > 0.1) {
                annualCAGR = (Math.pow(lastAc / firstAc, 1 / years) - 1) * 100;
            }
        }
    } else if (asc[0].accNav > 0 && last.accNav > 0) {
        sinceRet = (last.accNav / asc[0].accNav - 1) * 100;
    }

    return {
        '1m': { ret: ret1m },
        '3m': { ret: ret3m },
        '6m': { ret: ret6m },
        '1y': { ret: ret1y },
        'ytd': { ret: ytdRet },
        'since': { ret: sinceRet },
        'annual': { ret: annualCAGR },
    };
}

// 入库单只基金（核心：规模/费率/经理/NAV历史/资产配置/持仓/业绩/风险/分类）
export async function ingestFund(code, name, type, { withReport = false } = {}) {
    const db = getDb();
    const result = { code, name, ok: true, steps: {}, error: null };

    try {
        // 1) pingzhongdata 主源
        const pz = await fetchPingzhong(code);
        result.steps.pingzhong = 'ok';
        const navHist = (pz.navHistory || []).filter(r => r.date >= cutoffDate(2));
        const regions = db.prepare('SELECT name, pct FROM region_alloc WHERE code=?').all(code);

        // 1.5) 基本概况 jbgk（管理人、基准等）
        let jbgk = null;
        try { jbgk = await fetchJbgk(code); } catch { /* ignore */ }
        const manager = jbgk?.manager || null;
        const benchmark = jbgk?.benchmark || null;
        const trackingIndex = jbgk?.trackingIndex || null;

        const fundRow = db.prepare('SELECT * FROM funds WHERE code=?').get(code);
        const holdingsDb = db.prepare('SELECT name as n, pct as r FROM holdings WHERE code=?').all(code);
        const industriesDb = db.prepare('SELECT name, pct FROM industry_alloc WHERE code=?').all(code);

        const cls = classify({
            name: name || pz.name,
            type,
            tracking_index: trackingIndex || fundRow?.tracking_index || '',
            benchmark: benchmark || fundRow?.benchmark || '',
            regions,
            holdings: holdingsDb,
            industries: industriesDb
        });
        const risk = computeRisk(navHist);
        const perf = computePerformance(navHist, pz.acWorthHistory, pz.stageReturns);
        const riskLevel = RISK_BY_TYPE[type] || 'R4-中高风险';

        // 2) lsjz 最新状态
        let status = null;
        try { status = await fetchLsjzLatest(code); result.steps.lsjz = 'ok'; }
        catch (e) { result.steps.lsjz = 'fail:' + e.message; }

        const latestNav = status || navHist[navHist.length - 1] || null;
        const purchaseStatus = status ? normalizePurchaseStatus(status.purchaseStatusRaw) : '开放';

        // 单日申购限额（来自基金主页，失败不影响核心入库）
        let limitAmount = null;
        try { limitAmount = await fetchTradeLimit(code); } catch { /* ignore */ }

        // 3) 持仓（含真实季报日）
        let hRes = { rows: [], reportDate: null };
        try { hRes = await fetchHoldings(code); result.steps.holdings = 'ok'; }
        catch (e) { result.steps.holdings = 'fail:' + e.message; }
        const holdings = hRes.rows;
        const hReportDate = hRes.reportDate || null;

        // 3.5) 真实费率（jjfl 运作费用表获取准确的管理费率与托管费率）
        let fees = { subscribe: null, redeem: null, feeRate: null };
        try { fees = await fetchFees(code); } catch { /* ignore */ }
        const actualFeeRate = (fees && fees.feeRate)
            ? fees.feeRate
            : (fees?.manage ? `${fees.manage} / ${fees.custody || '0.20%'}` : (fundRow?.fee_rate || '1.20% / 0.20%'));

        // ---- 持久化 ----
        const reportDate = latestNav?.date || new Date().toISOString().slice(0, 10);
        db.prepare(`INSERT INTO funds (code,name,scale,fee_rate,fee_subscribe,fee_redeem,risk_level,manager,benchmark,target,scope,fm,code_info,report_date,tab,pill,classify_basis,raw_type,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
            ON CONFLICT(code) DO UPDATE SET
              name=excluded.name, scale=excluded.scale, fee_rate=excluded.fee_rate, fee_subscribe=excluded.fee_subscribe,
              fee_redeem=excluded.fee_redeem, risk_level=excluded.risk_level,
              manager=COALESCE(excluded.manager, funds.manager),
              benchmark=COALESCE(excluded.benchmark, funds.benchmark),
              fm=excluded.fm, report_date=excluded.report_date, tab=excluded.tab, pill=excluded.pill,
              classify_basis=excluded.classify_basis, raw_type=excluded.raw_type, updated_at=datetime('now')`)
            .run(code, name || pz.name, pz.scale, actualFeeRate, fees.subscribe, fees.redeem, riskLevel, manager, benchmark, null, null, pz.fm, null, reportDate, cls.tab, cls.pill, cls.basis, type);

        // daily_nav（批量，显式事务；node:sqlite 无 .transaction 方法）
        // 注意：limit_amount 是「当前状态」，只写最新一行，历史行一律置空，避免限额污染整个历史
        const insNav = db.prepare(`INSERT OR REPLACE INTO daily_nav (code,date,nav,acc_nav,daily_return,purchase_status,redeem_status,limit_amount,updated_at)
            VALUES (?,?,?,?,?,?,?,?,datetime('now'))`);
        const latestDate = navHist.length ? navHist[navHist.length - 1].date : null;
        db.exec('BEGIN');
        try {
            for (const r of navHist) {
                insNav.run(code, r.date, r.nav, r.accNav, r.dailyReturn, purchaseStatus, null, r.date === latestDate ? limitAmount : null);
            }
            db.exec('COMMIT');
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }

        // holdings（先删后插；报告期用真实季报日，回退到最新净值日）
        db.prepare('DELETE FROM holdings WHERE code=?').run(code);
        const insH = db.prepare('INSERT INTO holdings (code,rank,name,pct,report_date) VALUES (?,?,?,?,?)');
        for (const h of holdings) insH.run(code, h.rank, h.name, h.pct, hReportDate || reportDate);

        // performance
        db.prepare('DELETE FROM performance WHERE code=?').run(code);
        const insP = db.prepare('INSERT INTO performance (code,period,ret,rank,rank_total) VALUES (?,?,?,?,?)');
        for (const [period, v] of Object.entries(perf)) {
            insP.run(code, period, v.ret, null, null);
        }

        // risk_metrics
        if (risk) {
            db.prepare(`INSERT INTO risk_metrics (code,calc_date,sharpe,max_drawdown,volatility,alpha,beta,updated_at)
                VALUES (?,?,?,?,?,?,?,datetime('now'))
                ON CONFLICT(code) DO UPDATE SET sharpe=excluded.sharpe, max_drawdown=excluded.max_drawdown,
                  volatility=excluded.volatility, calc_date=excluded.calc_date, updated_at=datetime('now')`)
                .run(code, reportDate, risk.sharpe, risk.maxDrawdown, risk.volatility, null, null);
        }

        // asset_alloc（优先来自 zcpz 官方季报精准明细，含股票、存托凭证、现金、债券等；兜底来自 pingzhongdata）
        let zcpzAlloc = [];
        try { zcpzAlloc = await fetchZcpzAssetAlloc(code); } catch {}
        const finalAssetAlloc = (zcpzAlloc && zcpzAlloc.length) ? zcpzAlloc : pz.assetAlloc.map(a => ({ name: a.name, pct: a.pct / 100, date: a.date }));
        db.prepare('DELETE FROM asset_alloc WHERE code=?').run(code);
        const insA = db.prepare('INSERT INTO asset_alloc (code,report_date,name,pct) VALUES (?,?,?,?)');
        for (const a of finalAssetAlloc) insA.run(code, a.date || reportDate, a.name, a.pct);

        result.fields = {
            scale: pz.scale, fm: pz.fm, navRows: navHist.length,
            holdings: holdings.length, tab: cls.tab, pill: cls.pill,
            risk: risk ? 'ok' : 'skip', perf: Object.keys(perf).length,
        };

        // 4) 季报（行业/区域），可选（较重）
        if (withReport) {
            try {
                await ingestReport(code);
                result.steps.report = 'ok';
            } catch (e) { result.steps.report = 'fail:' + e.message; }
        }
    } catch (e) {
        result.ok = false;
        result.error = e.message;
    }
    return result;
}

// 季报入库（行业/区域）+ 单日申购限额回填（限额来自同一主页请求，无额外开销）
export async function ingestReport(code) {
    const db = getDb();
    let ann = db.prepare('SELECT * FROM quarterly_ann WHERE code=?').get(code);
    let limit = null;
    if (!ann || !ann.art_code) {
        const found = await findQuarterlyArtCode(code);
        limit = found?.limit ?? null;
        if (found && found.artCode) {
            db.prepare(`INSERT INTO quarterly_ann (code,art_code,notice_date,notice_title,updated_at)
                VALUES (?,?,?,?,datetime('now')) ON CONFLICT(code) DO UPDATE SET
                art_code=excluded.art_code, notice_date=excluded.notice_date, notice_title=excluded.notice_title, updated_at=datetime('now')`)
                .run(code, found.artCode, found.date, found.title);
            ann = { art_code: found.artCode };
        }
    } else {
        // 已缓存 art_code：单独补抓限额（仅 19 只历史缓存基金会走这里）
        limit = await fetchTradeLimit(code);
    }
    if (limit != null) {
        db.prepare('UPDATE daily_nav SET limit_amount=? WHERE code=?').run(limit, code);
    }
    if (!ann || !ann.art_code) return { code, report: false, reason: 'no art_code', limit };

    const content = ann.content || (await fetchAnnContent(ann.art_code)).content;
    const parsed = parseReportContent(content || '');
    const reportDate = ann.notice_date || new Date().toISOString().slice(0, 10);

    // 区域配置不再由此写入：region_alloc 统一由 report_morningstar.mjs（晨星洲/地区级口径）维护，
    // 行业配置由 report_industry.mjs（HYPZ）维护。这里若写东财国家/地区级口径会污染已统一的口径，
    // 且会触发被封的 np-cnotice 接口。故 ingestReport 仅负责 quarterly_ann 索引缓存 + 单日限额回填。
    return { code, report: true, industry: parsed.industry.length, region: 0, limit };
}

// 全量入库（节流 + 单基金隔离）
export async function ingestAll(list, { withReport = false, onProgress } = {}) {
    const total = list.length;
    let done = 0, ok = 0, fail = 0;
    for (const f of list) {
        const r = await ingestFund(f.code, f.name, f.type, { withReport });
        done++; if (r.ok) ok++; else fail++;
        if (onProgress) onProgress({ done, total, ok, fail, last: r });
        if (done % 25 === 0) console.log(`[ingest] ${done}/${total} ok=${ok} fail=${fail}`);
        await throttle(300, 250);
    }
    console.log(`[ingest] DONE total=${total} ok=${ok} fail=${fail}`);
    return { total, ok, fail };
}

// ---- API 聚合 ----
export function gatherFund(code, familyShares = null) {
    const db = getDb();
    const fund = db.prepare('SELECT * FROM funds WHERE code=?').get(code);
    if (!fund) return null;
    const nav = db.prepare('SELECT * FROM daily_nav WHERE code=? ORDER BY date DESC LIMIT 1').get(code);
    const holdings = db.prepare('SELECT * FROM holdings WHERE code=?').all(code);
    const perfRows = db.prepare('SELECT * FROM performance WHERE code=?').all(code);
    const performance = {};
    for (const r of perfRows) performance[r.period] = { ret: r.ret, rank: r.rank };
    const riskRow = db.prepare('SELECT * FROM risk_metrics WHERE code=?').get(code);
    const risk = riskRow ? {
        sharpe: riskRow.sharpe, maxDrawdown: riskRow.max_drawdown, volatility: riskRow.volatility,
    } : null;
    const industry = db.prepare('SELECT * FROM industry_alloc WHERE code=?').all(code);
    const region = db.prepare('SELECT * FROM region_alloc WHERE code=?').all(code);
    const asset = db.prepare('SELECT * FROM asset_alloc WHERE code=?').all(code);

    let mergedName = fund.name;
    if (familyShares) {
        mergedName = formatMergedFundName(fund.name, familyShares);
    } else {
        const k = stem(fund.name);
        const shares = db.prepare('SELECT name FROM funds WHERE (currency_excluded=0 OR currency_excluded IS NULL) AND (exchange_excluded=0 OR exchange_excluded IS NULL) AND (excluded=0 OR excluded IS NULL)').all();
        const matched = shares.filter(x => stem(x.name) === k);
        mergedName = formatMergedFundName(fund.name, matched);
    }

    return mapFund({ fund: { ...fund, name: mergedName }, nav, holdings, performance, risk, industry, region, asset });
}

export function gatherAll({ includeExcluded = false } = {}) {
    const db = getDb();
    // 默认视图：排除 资产类别(excluded) + 非主流/冗余份额(mainstream) + 港股为主(region_excluded) + 场内基金(exchange_excluded) + 美元/外币份额(currency_excluded)
    const where = includeExcluded
        ? ''
        : ' WHERE (excluded=0 OR excluded IS NULL) AND mainstream=1 AND (region_excluded=0 OR region_excluded IS NULL) AND (exchange_excluded=0 OR exchange_excluded IS NULL) AND (currency_excluded=0 OR currency_excluded IS NULL)';
    const codes = db.prepare(`SELECT code FROM funds${where}`).all().map(r => r.code);
    if (!codes.length) return [];

    const allRmb = db.prepare('SELECT code, name FROM funds WHERE (currency_excluded=0 OR currency_excluded IS NULL) AND (exchange_excluded=0 OR exchange_excluded IS NULL) AND (excluded=0 OR excluded IS NULL)').all();
    const familyMap = {};
    for (const f of allRmb) {
        const k = stem(f.name);
        if (!familyMap[k]) familyMap[k] = [];
        familyMap[k].push(f);
    }

    return codes.map(c => {
        const f = db.prepare('SELECT name FROM funds WHERE code=?').get(c);
        const shares = f ? (familyMap[stem(f.name)] || []) : [];
        return gatherFund(c, shares);
    }).filter(Boolean);
}
