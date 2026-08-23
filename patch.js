const fs = require('fs');
let code = fs.readFileSync('script.js', 'utf8');

const oldLogic = `        if (f.holdings) {
            f.holdings.forEach(h => {
                const hw = h.r * fundNormW;
                aggHoldings[h.n] = (aggHoldings[h.n] || 0) + hw;
            });
        }`;
const newLogic = `        if (f.holdings) {
            f.holdings.forEach(h => {
                const hw = h.r * fundNormW;
                if (!aggHoldings[h.n]) aggHoldings[h.n] = { r: 0, sources: [] };
                aggHoldings[h.n].r += hw;
                aggHoldings[h.n].sources.push({ fn: f.name, w: hw });
            });
        }`;
code = code.replace(oldLogic, newLogic);

const oldMap = `    const sortedHoldings = Object.entries(aggHoldings)
        .map(([n, r]) => ({ n, r }))
        .sort((a, b) => b.r - a.r)
        .slice(0, 10);

    document.getElementById('report-holdings').innerHTML = sortedHoldings.map(h => {
        return \`<tr>
            <td style="font-weight:600;">\${h.n}</td>
            <td><strong style="color:var(--accent-blue);">\${h.r.toFixed(2)}%</strong></td>
        </tr>\`;
    }).join('');`;
const newMap = `    const sortedHoldings = Object.entries(aggHoldings)
        .map(([n, v]) => ({ n, ...v }))
        .sort((a, b) => b.r - a.r)
        .slice(0, 10);

    document.getElementById('report-holdings').innerHTML = sortedHoldings.map(h => {
        const sourceHtml = h.sources.map(s => \`<span class="asset-pill" style="font-size:11px; padding:2px 6px;">\${s.fn.slice(0,4)}: <strong>\${s.w.toFixed(2)}%</strong></span>\`).join(' ');
        return \`<tr>
            <td style="font-weight:600;">\${h.n}</td>
            <td><strong style="color:var(--accent-blue);">\${h.r.toFixed(2)}%</strong></td>
            <td style="text-align:left; display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end;">\${sourceHtml}</td>
        </tr>\`;
    }).join('');`;
code = code.replace(oldMap, newMap);

fs.writeFileSync('script.js', code);
