// 定时任务（node-cron）
// 显式设置时区，避免 18:30 / 03:00 跑偏
process.env.TZ = 'Asia/Shanghai';

import cron from 'node-cron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FUNDS } from '../config/funds.js';
import { ingestAll, ingestFund } from '../orchestrator.js';
import { getDb } from '../db/sqlite.js';
import { checkHealth } from './monitor.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(__dirname, '..'); // backend/jobs → backend/

getDb();

// 续跑报表脚本（industry / region），直到脚本输出"全部完成"或达最大片数。
// 脚本自身支持断点续跑（*_progress.json），每片 ~250 只 / 7 分钟预算。
// best-effort：失败不影响主流程；仅在季度任务末尾调用。
function runReportScript(script, maxSlices = 6) {
    return new Promise((resolve) => {
        let slice = 0;
        const runOne = () => {
            if (slice >= maxSlices) {
                console.log(`[cron] ${script} 已达最大续跑片数(${maxSlices})，交下次任务继续`);
                return resolve();
            }
            slice++;
            const p = spawn('node', [script], {
                cwd: BACKEND, env: process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let buf = '';
            const onData = (d) => { buf += d.toString(); };
            p.stdout.on('data', onData);
            p.stderr.on('data', onData);
            p.on('close', (code) => {
                console.log(`[cron] ${script} 片${slice} 退出码=${code}`);
                if (buf.includes('全部完成')) {
                    console.log(`[cron] ${script} 全部完成 ✅`);
                    return resolve();
                }
                // 仍有剩余或失败 → 1s 后续跑下一片
                setTimeout(runOne, 1000);
            });
            p.on('error', (e) => {
                console.error(`[cron] ${script} 启动失败:`, e.message);
                resolve();
            });
        };
        runOne();
    });
}

// 每日净值 + 状态 + 规模/持仓/业绩/风险刷新（QDII T+1/T+2，盘后 18:30）
// 注意：withReport 保持 false——行业(region/industry)由 report_morningstar / report_industry 单独维护，
// 且东财公告正文接口(np-cnotice)已被封禁，withReport:true 会触发封禁且污染已统一的晨星口径。
cron.schedule('30 18 * * 1-5', async () => {
    console.log('[cron] 每日净值任务启动', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    try {
        await ingestAll(FUNDS, { withReport: false });
        const h = await checkHealth();
        console.log(`[cron] 监控: 净值最新 ${h.lastNav} 距 ${h.daysGap} 交易日` + (h.alerts.length ? ' ⚠️ ' + h.alerts.join('; ') : ' ✅'));
    }
    catch (e) { console.error('[cron] 每日任务失败', e.message); }
}, { timezone: 'Asia/Shanghai' });

// 季度全量刷新（不含季报正文行业/区域，避免封禁与口径污染）
cron.schedule('0 3 10 1,4,7,10 *', async () => {
    console.log('[cron] 季度全量任务启动', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
    try {
        await ingestAll(FUNDS, { withReport: false });
        // 季度末自动补录行业/区域（best-effort，续跑至完成；脚本支持断点续跑）
        console.log('[cron] 季度任务：开始补录行业/区域（晨星+东财HYPZ）');
        await runReportScript('report_industry.mjs');
        await runReportScript('report_morningstar.mjs');
        const h = await checkHealth();
        console.log(`[cron] 季度监控: 净值最新 ${h.lastNav}` + (h.alerts.length ? ' ⚠️ ' + h.alerts.join('; ') : ' ✅'));
    }
    catch (e) { console.error('[cron] 季度任务失败', e.message); }
}, { timezone: 'Asia/Shanghai' });

console.log('[scheduler] 已注册定时任务（TZ=Asia/Shanghai）');
console.log('  每日净值: 交易日 18:30');
console.log('  季度全量: 1/4/7/10 月 10 号 03:00');

// 保持进程常驻
setInterval(() => {}, 60 * 1000);
