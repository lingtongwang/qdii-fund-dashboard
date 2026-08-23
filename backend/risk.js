// 本地风险指标计算：从 NAV 历史算 年化波动 / 最大回撤 / 夏普
// 输入 navHistory: [{date, nav, accNav, dailyReturn}]（按日期升序）
// 输出 { volatility(小数), maxDrawdown(负数小数), sharpe(数值) } 或 null（数据不足）

function std(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
}

export function computeRisk(navHistory) {
    if (!Array.isArray(navHistory) || navHistory.length < 30) return null;
    
    // 严格按日期升序排列
    const asc = [...navHistory]
        .filter(r => (r.accNav && r.accNav > 0) || (r.nav && r.nav > 0))
        .sort((a, b) => a.date.localeCompare(b.date));
    if (asc.length < 30) return null;

    // 优先使用 accNav (累计净值) 计算真实收益率序列，彻底排除分红/拆分导致的假性暴跌
    const series = asc.map(r => r.accNav || r.nav);

    // 日收益率
    const rets = [];
    for (let i = 1; i < asc.length; i++) {
        if (asc[i].dailyReturn != null && !isNaN(asc[i].dailyReturn)) {
            rets.push(asc[i].dailyReturn / 100);
        } else {
            rets.push(series[i] / series[i - 1] - 1);
        }
    }
    if (!rets.length) return null;

    const volatility = std(rets) * Math.sqrt(252); // 年化波动（小数）

    // 最大回撤 (基于累计净值)
    let peak = series[0], maxDD = 0;
    for (const v of series) {
        if (v > peak) peak = v;
        const dd = v / peak - 1;
        if (dd < maxDD) maxDD = dd;
    }

    // 年化收益（几何）
    const n = series.length;
    const totalReturn = series[n - 1] / series[0] - 1;
    const years = n / 252;
    const annualized = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : 0;

    // 无风险利率按 2% 计算
    const rf = 0.02;
    const sharpe = volatility > 0 ? (annualized - rf) / volatility : 0;

    return {
        volatility,
        maxDrawdown: Math.min(maxDD, 0),
        sharpe,
    };
}
