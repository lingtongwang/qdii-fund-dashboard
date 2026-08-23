// mapper：把 DB 聚合数据映射为前端 PRD Fund 模型（字段名/单位必须与 script.js 严格一致）
// 比例单位约定：asset/industry/region 表在 DB 存小数(0.x)，此处 ×100 转百分比数值。

function fmtScale(scale) {
    if (scale == null || isNaN(scale) || scale === '') return '—';
    const num = Number(scale);
    if (isNaN(num)) return '—';
    if (num >= 1) return num.toFixed(2) + ' 亿';
    return (num * 10000).toFixed(2) + ' 万';
}

function toPctObj(rows) {
    // rows: [{name, pct(小数)}] → {labels, data(百分比数值)}
    const labels = [], data = [];
    for (const r of rows || []) {
        if (!r || !r.name) continue;
        labels.push(r.name);
        const val = (r.pct != null && !isNaN(r.pct)) ? Number((Number(r.pct) * 100).toFixed(2)) : 0;
        data.push(val);
    }
    return { labels, data };
}

const PERF_PERIODS = [
    ['近1月', '1m'],
    ['近3月', '3m'],
    ['近6月', '6m'],
    ['近1年', '1y'],
    ['今年以来', 'ytd'],
    ['成立以来', 'since'],
    ['年化收益率', 'annual'],
];

export function mapFund(d) {
    const fund = d.fund || {};
    const nav = d.nav || null;
    const risk = d.risk || null;
    const perfMap = d.performance || {};

    const perf = PERF_PERIODS.map(([p, key]) => {
        const item = perfMap[key];
        return { p, r: item && item.ret != null && !isNaN(item.ret) ? Number(item.ret) : null, rank: '—' };
    });

    const riskMetrics = {
        sharpe: (risk && risk.sharpe != null && !isNaN(risk.sharpe)) ? Number(risk.sharpe).toFixed(2) : '—',
        drawdown: (risk && risk.maxDrawdown != null && !isNaN(risk.maxDrawdown)) ? (Number(risk.maxDrawdown) * 100).toFixed(2) + '%' : '—',
        vol: (risk && risk.volatility != null && !isNaN(risk.volatility)) ? (Number(risk.volatility) * 100).toFixed(2) + '%' : '—',
        alpha: '—',
        beta: '—',
    };

    return {
        name: fund.name || '',
        code: fund.code,
        rawType: fund.raw_type || null,        // 东财原始分类（QDII-* / 指数型-海外股票），用于核对 QDII 口径
        purchaseStatus: (() => {
            const raw = nav?.purchase_status || '开放';
            if (raw.includes('暂停') && raw.includes('大额')) return '暂停大额申购';
            if (raw.includes('限大额') || raw.includes('限制')) return '暂停大额申购';
            if (raw.includes('暂停')) return '暂停申购';
            if (raw.includes('开放')) return '开放申购';
            return raw.replace(/[()（）\s]/g, '').trim() || '开放';
        })(),
        dataAsOf: nav?.date || null,
        limit: nav?.limit_amount != null ? Number(nav.limit_amount) : null,
        risk: fund.risk_level || '—',
        scale: fmtScale(fund.scale),
        fee: fund.fee_rate || '—',                 // 管理费 / 托管费
        feeSubscribe: fund.fee_subscribe || null,  // 申购费率（投资者实际支付）
        feeRedeem: fund.fee_redeem || null,        // 赎回费率（标准档）
        tab: fund.tab || 'other',
        pill: fund.pill || '其他',
        returnDaily: nav?.daily_return != null ? Number(nav.daily_return) : null,
        returnYTD: perfMap.ytd?.ret != null ? Number(perfMap.ytd.ret) : null,
        return1y: perfMap['1y']?.ret != null ? Number(perfMap['1y'].ret) : null,
        holdings: (d.holdings || []).map(h => ({ n: h.name, r: Number(h.pct) })),
        market: toPctObj(d.region),
        industry: toPctObj(d.industry),
        assets: toPctObj(d.asset),
        nav: nav?.nav != null ? Number(nav.nav) : null,
        accNav: nav?.acc_nav != null ? Number(nav.acc_nav) : null,
        trackingIndex: fund.tracking_index || null,
        indexCode: fund.index_code || null,
        perf,
        riskMetrics,
        profile: {
            codeInfo: `${fund.code}.OF / ${fund.code}`,
            manager: fund.manager || '—',
            benchmark: fund.benchmark || '—',
            target: fund.target || '—',
            scope: fund.scope || '—',
            fm: fund.fm || '—',
            trackingIndex: fund.tracking_index || null,
            indexCode: fund.index_code || null,
        },
    };
}
