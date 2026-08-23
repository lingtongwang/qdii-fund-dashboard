// Express API 服务：输出 PRD Fund 模型 + 同进程静态托管前端
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getDb } from '../db/sqlite.js';
import { gatherAll, gatherFund } from '../orchestrator.js';
import { FUNDS } from '../config/funds.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..'); // backend/api → 仓库根目录（前端 index.html 所在）
const PORT = process.env.PORT || 3000;

getDb(); // 初始化表

const app = express();
app.use(express.json());

// 静态托管前端
app.use(express.static(ROOT, { extensions: ['html'] }));

// 全部基金（默认只返回保留中的基金；?all=1 含被标记"暂时不用"的基金）
app.get('/api/funds', (req, res) => {
    try {
        const includeExcluded = req.query.all === '1' || req.query.all === 'true';
        const funds = gatherAll({ includeExcluded });
        res.json(funds);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 单只详情
app.get('/api/fund/:code', (req, res) => {
    try {
        const f = gatherFund(req.params.code);
        if (!f) return res.status(404).json({ error: 'not found' });
        res.json(f);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 健康检查 + 覆盖率
app.get('/api/health', (req, res) => {
    try {
        const db = getDb();
        const q = (sql) => Object.values(db.prepare(sql).get())[0];
        let funds = 0, stock = 0, assetExcluded = 0, hkExcluded = 0, exchangeExcluded = 0, currencyExcluded = 0, mainstream = 0, visible = 0, dailyNav = 0, holdings = 0, risk = 0, industry = 0, region = 0, asset = 0, limitCount = 0;
        try { funds = q("SELECT count(*) FROM funds"); } catch {}
        try { stock = q("SELECT count(*) FROM funds WHERE excluded=0 OR excluded IS NULL"); } catch {}
        try { assetExcluded = q("SELECT count(*) FROM funds WHERE excluded=1"); } catch {}
        try { hkExcluded = q("SELECT count(*) FROM funds WHERE region_excluded=1"); } catch {}
        try { exchangeExcluded = q("SELECT count(*) FROM funds WHERE exchange_excluded=1"); } catch {}
        try { currencyExcluded = q("SELECT count(*) FROM funds WHERE currency_excluded=1"); } catch {}
        try { mainstream = q("SELECT count(*) FROM funds WHERE (excluded=0 OR excluded IS NULL) AND mainstream=1"); } catch {}
        try { visible = q("SELECT count(*) FROM funds WHERE (excluded=0 OR excluded IS NULL) AND mainstream=1 AND (region_excluded=0 OR region_excluded IS NULL) AND (exchange_excluded=0 OR exchange_excluded IS NULL) AND (currency_excluded=0 OR currency_excluded IS NULL)"); } catch {}
        try { dailyNav = q("SELECT count(*) FROM daily_nav"); } catch {}
        try { holdings = q("SELECT count(*) FROM holdings"); } catch {}
        try { risk = q("SELECT count(*) FROM risk_metrics"); } catch {}
        try { industry = q("SELECT count(*) FROM industry_alloc"); } catch {}
        try { region = q("SELECT count(*) FROM region_alloc"); } catch {}
        try { asset = q("SELECT count(*) FROM asset_alloc"); } catch {}
        try { limitCount = q("SELECT count(*) FROM (SELECT DISTINCT code FROM daily_nav WHERE limit_amount IS NOT NULL)"); } catch {}
        res.json({
            status: 'ok',
            configFunds: FUNDS.length,
            funds: { total: funds, stock, assetExcluded, hkExcluded, exchangeExcluded, currencyExcluded, mainstream, visible },
            coverage: { funds, dailyNav, holdings, risk, industry, region, asset, limit: limitCount },
            dbPath: process.env.DB_PATH || '(default)',
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 手动或 Webhook 触发数据刷新接口
let isRefreshing = false;
app.post('/api/refresh', async (req, res) => {
    if (isRefreshing) return res.status(429).json({ status: 'busy', message: '数据刷新任务正在进行中' });
    isRefreshing = true;
    res.json({ status: 'started', message: '数据刷新任务已在后台启动' });
    try {
        const { ingestAll } = await import('../orchestrator.js');
        await ingestAll(FUNDS, { withReport: false });
        console.log('[server] 数据刷新完成');
    } catch (e) {
        console.error('[server] 数据刷新失败:', e.message);
    } finally {
        isRefreshing = false;
    }
});

// 可选：启动内置定时任务（node-cron，默认开启）
if (process.env.ENABLE_SCHEDULER !== '0' && process.env.ENABLE_SCHEDULER !== 'false') {
    import('../jobs/scheduler.js').catch(e => console.warn('[scheduler] 启动跳过:', e.message));
}

app.listen(PORT, () => {
    console.log(`[server] QDII 看板后端已启动: http://localhost:${PORT}`);
    console.log(`[server] 静态托管根目录: ${ROOT}`);
});

