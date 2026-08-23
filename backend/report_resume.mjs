// 季报补录（自驱动 / 无人值守模式）
// ---------------------------------------------------------------------------
// ⚠️ 已弃用（deprecated）：地区配置(region_alloc) 现由 report_morningstar.mjs 统一维护（晨星洲/地区级口径，沙箱可代跑），
//    行业配置(industry_alloc) 由 report_industry.mjs 维护（东财 HYPZ）。本脚本经 orchestrator.ingestReport 仅回填
//    quarterly_ann 索引 + 单日限额，且会触发已被封禁的东财公告正文接口(np-cnotice)。如无特殊需求，请勿再运行本脚本。
// ---------------------------------------------------------------------------
// 设计目标：启动一次即可跑完全部 739 只，期间自动躲东财风控（限流），无需人工重跑。
//
// 用法：
//   node report_resume.mjs                # 自驱动：跑到全部完成才退出（推荐）
//   node report_resume.mjs --once         # 只跑一个时间片就退出（旧行为，便于调试）
//   node report_resume.mjs --resume-only  # 仅打印进度，不抓取
//
// 躲风控策略：
//   - 每只基金之间 base 延迟（默认 1200ms）+ 随机抖动，避免固定高频
//   - 每处理 N 只（默认 30）做一次较长喘息（默认 15s），打散请求节奏
//   - 每个"会话"活跃上限（默认 6min）后主动暂停 90s 再继续，避免短时海量请求
//   - 预检失败（接口不可达 = 被限流/封禁）：指数退避冷却（1→2→4→8…封顶 15min）后重试，绝不退出
//   - 连续失败 >=5：判定为系统级限流，冷却 90s 后继续（consecutiveFail 归零）
//
// 进度存 data/report_progress.json：{ code: 'done' | 'none' | 'fail' }
//   done = 已抓到季报并入库；none = 确认无股票季报（债券/商品/联接等）；fail = 出错待重试
// 任何时候被杀/中断都安全：进度实时落盘，重跑即续。
// ---------------------------------------------------------------------------
import { FUNDS } from './config/funds.js';
import { ingestReport } from './orchestrator.js';
import { fetchAnnContent } from './adapters/report.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROGRESS = join(__dirname, 'data', 'report_progress.json');

function loadProgress() {
    try { return JSON.parse(readFileSync(PROGRESS, 'utf8')); } catch { return {}; }
}
function saveProgress(p) {
    mkdirSync(dirname(PROGRESS), { recursive: true });
    writeFileSync(PROGRESS, JSON.stringify(p, null, 0));
}

const args = process.argv.slice(2);
const getFlag = (name, def) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? (args[i + 1] ?? true) : def;
};
const ONCE = args.includes('--once');
const RESUME_ONLY = args.includes('--resume-only');
const BASE_DELAY = parseInt(getFlag('delay', '1200'), 10);   // 每只之间基础延迟 ms
const BREATHER_EVERY = parseInt(getFlag('breather-every', '30'), 10); // 每 N 只喘息
const BREATHER_MS = parseInt(getFlag('breather', '15000'), 10);        // 喘息时长 ms
const SESSION_BUDGET_MS = parseInt(getFlag('budget', '360000'), 10);   // 单会话活跃上限 6min
const SESSION_PAUSE_MS = 90 * 1000;                                       // 会话间暂停
const THROTTLE_CAP_MS = 15 * 60 * 1000;                                   // 退避上限 15min
const THROTTLE_GIVEUP = 60;                                               // 连续退避这么多次后放弃退出

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (base) => base + Math.floor(Math.random() * 500); // ±500ms 抖动

const progress = loadProgress();
// 预置：DB 中已有 quarterly_ann 的基金视为 done，避免重复抓取
if (Object.keys(progress).length === 0) {
    try {
        const { getDb } = await import('./db/sqlite.js');
        const rows = getDb().prepare("SELECT code FROM quarterly_ann WHERE art_code IS NOT NULL").all();
        for (const r of rows) progress[r.code] = 'done';
        if (rows.length) console.log(`[resume] 从 DB 预置 done=${rows.length}`);
    } catch { /* ignore */ }
}

function stats() {
    const v = Object.values(progress);
    return {
        done: v.filter(x => x === 'done').length,
        none: v.filter(x => x === 'none').length,
        fail: v.filter(x => x === 'fail').length,
    };
}
function logProgress(tag) {
    const s = stats();
    console.log(`[${tag}] done=${s.done} none=${s.none} fail=${s.fail} 剩余=${FUNDS.length - s.done - s.none}`);
}
logProgress('resume');

if (RESUME_ONLY) process.exit(0);

// 优雅退出：Ctrl+C 时保存进度并退出
let shuttingDown = false;
process.on('SIGINT', () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log('\n[signal] 收到中断，保存进度后退出（重跑即续）…');
    saveProgress(progress);
    setTimeout(() => process.exit(0), 300);
});

// 预检：内容接口（np-cnotice-fund）是否可达。不可达即被限流，调用方应退避重试而非退出。
async function preflight() {
    try {
        await fetchAnnContent('202607211827195290'); // 000043 已知 art_code，仅做连通性探测
        return true;
    } catch {
        return false;
    }
}

let throttleStreak = 0; // 连续退避次数
let sessionRound = 0;

while (true) {
    if (shuttingDown) break;

    // —— 预检 + 限流退避 ——
    const ok = await preflight();
    if (!ok) {
        throttleStreak++;
        let backoff;
        if (throttleStreak <= 5) {
            backoff = 60 * 1000 * Math.pow(2, throttleStreak - 1); // 1,2,4,8,15(min 封顶)
        } else {
            // 长期封禁：深度休眠。间隔随封禁时长拉长并加随机抖动，
            // 避免规律性探测维持封禁；同时保留“IP 恢复即自动续跑”能力，永不主动退出。
            const ramp = Math.min(60, 15 + (throttleStreak - 5) * 5); // 15→20→25…封顶 60min
            backoff = ramp * 60000 + Math.floor(Math.random() * 10 * 60000); // ±10min 抖动
        }
        const mins = Math.round(backoff / 60000);
        console.log(`[throttle] 内容接口不可达（疑似被限流/封禁），第 ${throttleStreak} 次冷却，睡 ${mins}min 后重试…`);
        if (throttleStreak === 30) {
            console.log('[throttle] 已连续封禁冷却 30 次（累计数小时），疑似东财长期封禁。最快解法：更换网络出口 IP（切手机热点 / VPN / 重启路由器），本脚本下次预检通过即自动续跑，无需手动干预。');
        }
        await sleep(backoff);
        continue; // 重新预检
    }
    if (throttleStreak > 0) {
        console.log(`[throttle] 接口恢复，继续补录`);
        throttleStreak = 0;
    }

    // —— 跑一个会话 ——
    sessionRound++;
    const sessionStart = Date.now();
    let okThis = 0, noneThis = 0, failThis = 0, consecutiveFail = 0, sessionProcessed = 0;

    for (const f of FUNDS) {
        if (shuttingDown) break;
        const st = progress[f.code];
        if (st === 'done' || st === 'none') continue;

        try {
            const r = await ingestReport(f.code);
            if (r && r.report) { progress[f.code] = 'done'; okThis++; }
            else { progress[f.code] = 'none'; noneThis++; }
            consecutiveFail = 0;
            console.log(`[${r && r.report ? 'OK ' : 'NONE'}] ${f.code} ${f.name} ${r && r.report ? `(ind=${r.industry} reg=${r.region})` : ''}`);
        } catch (e) {
            progress[f.code] = 'fail'; failThis++; consecutiveFail++;
            console.log(`[FAIL] ${f.code} ${f.name}: ${String(e.message || e).slice(0, 80)}`);
            if (consecutiveFail >= 5) {
                console.log(`[breaker] 连续失败 ${consecutiveFail} 次，疑似被限流，冷却 90s 后继续`);
                await sleep(90000);
                consecutiveFail = 0;
                break; // 结束本会话，回到顶部重新预检
            }
            if (consecutiveFail >= 3) {
                console.log(`[cooldown] 连续失败 ${consecutiveFail} 次，冷却 30s`);
                await sleep(30000);
                consecutiveFail = 0;
            }
        }

        saveProgress(progress);
        sessionProcessed++;

        // 节奏控制：基础延迟 + 抖动
        await sleep(jitter(BASE_DELAY));
        // 周期喘息，打散请求
        if (sessionProcessed % BREATHER_EVERY === 0) {
            console.log(`[breather] 已处理 ${sessionProcessed} 只本会话，喘息 ${BREATHER_MS / 1000}s`);
            await sleep(BREATHER_MS);
        }
        // 单会话活跃上限 → 暂停后继续（不退出）
        if (Date.now() - sessionStart > SESSION_BUDGET_MS) {
            console.log(`[session] 本会话活跃达 ${SESSION_BUDGET_MS / 60000}min，暂停 ${SESSION_PAUSE_MS / 1000}s 继续`);
            await sleep(SESSION_PAUSE_MS);
            break;
        }
    }

    const s = stats();
    console.log(`[session ${sessionRound}] ok=${okThis} none=${noneThis} fail=${failThis}`);
    logProgress('resume');

    if (FUNDS.length - s.done - s.none === 0) {
        console.log('[resume] 全部完成 ✅');
        saveProgress(progress);
        process.exit(0);
    }

    if (ONCE) {
        console.log('[resume] --once 模式：本片结束，主动退出（重跑续跑）');
        saveProgress(progress);
        process.exit(0);
    }
    // 否则继续循环：重新预检 → 下一会话。被限流会自动退避，无需人工。
}

saveProgress(progress);
process.exit(0);
