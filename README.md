# QDII 基金看板 · 运行手册

QDII 基金数据看板：前端（`index.html` / `script.js` / `style.css`）+ 后端（`backend/`，Node v22 + 内置 `node:sqlite`）。
后端从东方财富免费端点抓取真实数据，按频率自动更新，并通过 `GET /api/funds` 供前端渲染。

> 设计细节见 `BACKEND_DESIGN_AND_PLAN.md`（v6，以 §十 实际落地为准）。
> 产品需求见 `QDII_Fund_Dashboard_Comprehensive_PRD.md`。

---

## 1. 环境要求
- **Node v22+**（用到内置 `node:sqlite`，需 `--experimental-sqlite` 启动参数）。
- 不需要 `npm install`：`backend/` 依赖 `express` / `node-cron` / `cheerio` / `iconv-lite`，已在 `backend/node_modules` 内置；根目录 `node_modules` 仅前端用，无需构建。

## 2. 目录
```
backend/
  api/server.js          # Express：/api/funds、/api/fund/:code、/api/health + 静态托管前端
  jobs/scheduler.js       # 定时任务（每日 18:30 净值；季度 1/4/7/10 月 10 号 03:00 全量+行业/区域补录）
  orchestrator.js         # 编排抓取 → 落库；API 聚合读取
  adapters/eastmoney.js   # 主源 pingzhongdata（NAV/规模/费率/持仓/资产配置）
  adapters/report.js      # 季报索引(art_code)缓存 + 单日限购回填
  classify.js             # 按 name+type 自动分类 tab/pill
  risk.js / normalize/mapper.js / db/sqlite.js / config/funds.js
  report_industry.mjs     # 行业配置补录（东财 HYPZ 端点），支持断点续跑
  report_morningstar.mjs  # 区域配置补录（晨星中国），支持断点续跑
  jobs/mark_*.mjs         # 打标：主流/排除/港股为主 → 决定前端可见的 119 只
  data/fund.db            # SQLite 数据库（真实数据）
```

## 3. 启动（让看板在线）
### 方式 A：nohup（最简，无需额外安装）
```bash
cd /Users/lingtongwang/Documents/Project/fund_dashboard

# 启动 API（默认端口 3000）
nohup env TZ=Asia/Shanghai node --experimental-sqlite backend/api/server.js > backend/logs/server.log 2>&1 &

# 启动定时任务（每日/季度自动刷新）
nohup env TZ=Asia/Shanghai node --experimental-sqlite backend/jobs/scheduler.js > backend/logs/scheduler.log 2>&1 &
```
打开浏览器访问：http://localhost:3000

### 方式 B：pm2（推荐，崩溃自启）
```bash
npm i -g pm2   # 首次需安装
cd /Users/lingtongwang/Documents/Project/fund_dashboard
pm2 start backend/api/server.js      --name qdii-server   --node-args="--experimental-sqlite" --env TZ=Asia/Shanghai
pm2 start backend/jobs/scheduler.js  --name qdii-scheduler --node-args="--experimental-sqlite" --env TZ=Asia/Shanghai
pm2 save
```
> `pm2 startup` 可注册开机自启（按需）。

## 4. 手动刷新数据
```bash
cd backend
# 全量抓取（NAV/规模/持仓/业绩/风险/资产配置），约几分钟
node --experimental-sqlite cli.js fetch --all

# 单只
node --experimental-sqlite cli.js fetch --code 270042

# 行业/区域补录（断点续跑，多次运行收敛；每片 ~250 只 / 7 分钟）
node --experimental-sqlite report_industry.mjs
node --experimental-sqlite report_morningstar.mjs
```
> 季度任务会自动跑上述两脚本，正常情况下无需手工补。

## 5. 健康检查
```bash
curl http://localhost:3000/api/health
# 返回 funds 总数、主流可见数(119)、各表覆盖率、净值最新日期等
```

## 6. 接口
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/funds` | 全部可见基金（默认 119 只主流）；`?all=1` 含被标记"暂时不用"的基金 |
| GET | `/api/fund/:code` | 单只详情（含 NAV 历史序列） |
| GET | `/api/health` | 连通性 + 各表覆盖率 + 净值新鲜度 |

## 7. 数据现状（2026-08-18）
- `fund.db` ~41MB：739 funds / 323,506 daily_nav / 4,932 holdings / 717 risk_metrics / 2,890 industry / 1,316 region / 2,154 asset。
- 净值最新至 **2026-08-13**（QDII T+1/T+2）；服务常驻后每日 18:30 自动刷新。
- 行业/区域已由 `report_industry.mjs` / `report_morningstar.mjs` 补录入库。

## 8. 常见注意
- **时区**：所有定时任务显式 `TZ=Asia/Shanghai`，部署时务必带上，否则 18:30 / 03:00 跑偏。
- **np-cnotice 已封禁**：季度任务刻意 `withReport:false`，行业/区域改由 HYPZ / 晨星旁路补录，不要改回 np-cnotice。
- **前端兜底**：后端不可达时前端回退内置 15 只 `mockFunds`（仅离线演示，非真实数据）。
