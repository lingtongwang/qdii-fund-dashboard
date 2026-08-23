# 项目长期记忆：QDII 基金仪表盘后端

## 数据源地图（东财）
- **核心数据（739 只，已完成）**：规模/费率/净值序列/持仓/风险/资产配置/分类/收益 — 端点 `fundf10.eastmoney.com` / `fund.eastmoney.com`（pingzhongdata/jjcc/lsjz 等），沙箱可达。
- **行业配置 `industry_alloc`**：`api.fund.eastmoney.com/f10/HYPZ/`（`?fundCode=&year=2026&callback=?`，强制 JSONP，不带 year/callback 会 ErrCode:4）。已全量补齐 463 基金。**HYPZ 是唯一干净行业源，权威，勿用季报解析覆盖。**
- **区域配置 `region_alloc` + 单日申购限额 `daily_nav.limit_amount`**：只能从季报正文 API `np-cnotice-fund.eastmoney.com/api/content/ann?...art_code=AN...`（返回 `notice_content` 全文，纯文本或 HTML 表格）。无替代结构化接口（`api.fund.eastmoney.com/f10` 的 DYTZ/DQTX 等全 ErrCode:4；gonggao 详情页是 JS 壳）。

## 关键环境事实（重要）
- **沙箱（proxy 198.18.0.62）对 `np-cnotice-fund.eastmoney.com` 会被东财 IP 限流**（UND_ERR_SOCKET）。批量请求易触发，冷却后才恢复。
- 因此 **region + limit 全量补录（`report_resume.mjs`）必须在用户本机（直连公网）运行**，沙箱内预检会直接退出，符合预期。
- `report_resume.mjs` 已带：预检连通性、连续失败≥5 熔断、7min 自退、断点续跑（`data/report_progress.json`）。反复运行直到 739 全 done/none。

## 解析要点
- `parseReportContent` 已支持 HTML 表格（`htmlToText` 兜底）；纯文本/HTML 都按「每行≥2 数字、末位为占比」抽取；联接/feeder 基金正文"未持有股票及存托凭证"→ 0 行（正确）。
- `ingestReport` 只写 `region_alloc`（且仅当解析出结果时），不碰 `industry_alloc`。

## 运行
- 后端：`node --experimental-sqlite api/server.js`（Express，端口见 server.js）。`/api/fund/:code` 返回 industry/market(region)；`/api/health` 给覆盖计数。
- 行业补录：`node report_industry.mjs`（HYPZ，已跑完）。
- 区域+限额补录：`node report_resume.mjs`（用户本机跑）。
