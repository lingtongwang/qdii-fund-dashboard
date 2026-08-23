// 手动抓取 / 校验入口
// 用法：
//   node cli.js fetch --all [--report]      全量入库（--report 含季报行业/区域）
//   node cli.js fetch --code 270042         单只入库
//   node cli.js report --all                仅跑季报（行业/区域）
//   node cli.js report --code 270042
//   node cli.js health                      覆盖率
import { FUNDS } from './config/funds.js';
import { ingestAll, ingestFund, ingestReport, gatherAll } from './orchestrator.js';
import { getDb } from './db/sqlite.js';

function parseArgs(argv) {
    const out = { _: [], flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) out.flags[a.slice(2)] = argv[++i] || true;
        else out._.push(a);
    }
    return out;
}

async function main() {
    const { _, flags } = parseArgs(process.argv.slice(2));
    const cmd = _[0];
    getDb();

    if (cmd === 'fetch') {
        if (flags.code) {
            const f = FUNDS.find(x => x.code === flags.code);
            if (!f) { console.error('清单中无此 code:', flags.code); process.exit(1); }
            const r = await ingestFund(f.code, f.name, f.type, { withReport: !!flags.report });
            console.log('单只结果:', JSON.stringify(r, null, 2));
        } else {
            await ingestAll(FUNDS, { withReport: !!flags.report });
        }
    } else if (cmd === 'report') {
        if (flags.code) {
            const r = await ingestReport(flags.code);
            console.log('季报结果:', JSON.stringify(r));
        } else {
            let ok = 0, fail = 0;
            for (const f of FUNDS) {
                try { const r = await ingestReport(f.code); if (r.report) ok++; else fail++; }
                catch (e) { fail++; }
                if ((ok + fail) % 25 === 0) console.log(`[report] ${ok + fail}/${FUNDS.length} ok=${ok} fail=${fail}`);
                await new Promise(r => setTimeout(r, 300));
            }
            console.log(`[report] DONE ok=${ok} fail=${fail}`);
        }
    } else if (cmd === 'health') {
        const funds = gatherAll();
        console.log(`DB 中基金数: ${funds.length} / 配置 ${FUNDS.length}`);
    } else {
        console.log('用法: node cli.js fetch --all [--report] | fetch --code X | report --all | report --code X | health');
    }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
