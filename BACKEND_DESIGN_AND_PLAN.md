# QDII 基金看板 · 后端设计与实施文档（v5 · 线上正式流程版）

> 文档性质：**可执行的后端规范书**，是我（AI）编码的唯一依据，也是你随时查阅的说明。
> 前端现状：`index.html` + `script.js` + `style.css` 已完整，已通过 API 抽象层接 `GET /api/funds`（后端不可达时回退内置 15 只 `mockFunds`，仅离线兜底）。后端已落地：真实数据替换 mock，范围扩至 **739 只全量 QDII 基金**（非原 15 只），并按频率自动更新（见 §六 / §十）。**本文档 v5 部分描述与 2026-08-18 实际落地有差异，以 §十 为准。**
> **数据来源（v5 定稿，2026-08-13 修正 art_code 发现环节）**：**东方财富 / 天天基金免费 HTTP 端点 + 本地计算 + 东方财富季报全文接口**。**不使用 Wind**（Wind 是 agent 侧工具 + 桌面端付费 license，服务器上不可用，已从流程移除）；**不引入付费接口**。**评级字段已从产品模型彻底删除**（用户决策 2026-08-12，前端不再展示）。**季报（行业/区域/资产配置）由东方财富 `np-cnotice-fund` 内容接口获取 PDF 直链 + 全文文本**；**`art_code`（公告 ID）经解析基金主页 `fund.eastmoney.com/{code}.html` 服务端渲染的 HTML 发现（cheerio），再经内容接口还原完整标题识别季报**——**整套流程零浏览器依赖，无需证监会 eid / Playwright**。详见 §2.3。

---

## 〇、数据结构总览（先看这个）

所有数据归并为 **两类更新频率**，对应两张（组）表：

| 频率 | 包含字段 | 来源 | 更新节奏 | 当前可用性 |
|---|---|---|---|---|
| **A 类 · 每日** | NAV、累计净值、日涨跌、申购/赎回状态、限购状态/金额、数据日期 | 东财 `lsjz`（JSON） | 每个交易日盘后（建议 18:30） | ✅ 可用 |
| **B 类 · 每季度** | 规模、费率、风险等级、档案（经理/公司/基准/目标/范围/全称）、分类、前十大持仓、历史业绩+排名 | 东财 `jbgk`(HTML) / `jjcc`(JSON) / `jdzf`(HTML) | 季报披露后（建议每季度首月 10 号） | ✅ 可用 |
| **B 类 · 季报 PDF** | **行业分布、区域/国家分布、资产配置** | 东财 `np-cnotice-fund.eastmoney.com/api/content/ann`（HTTP）→ PDF 直链 `pdf.dfcfw.com` + `notice_content` 全文文本（优先文本抽取，PDF 解析仅兜底）；`art_code` 经**解析基金主页 HTML** 发现 | 季报披露后（随季度全量任务） | ✅ 可用（纯 HTTP 取 PDF+全文 + 主页 HTML 解析发现 art_code；无需 eid / Playwright） |
| **B 类 · 本地计算** | 风险指标（年化波动/最大回撤/夏普） | 从 `lsjz` NAV 历史本地算 | 随 NAV 更新 | ✅ 可用 |

> 说明：限购金额/状态属于"每日"是因为随时可能调整（如暂停大额申购），需每日核对。规模/费率/档案变化慢，按季报节奏即可。行业/区域/资产配置来自东财季报全文接口（PDF 直链 + `notice_content` 文本），每季刷新一次。

---

## 一、数据获取策略（核心原则 · 单源 + 本地计算 + 官方 PDF）

放弃"三级兜底（Wind→天天→PDF）"旧设计。新策略：

1. **主源 A：东方财富 / 天天基金免费 HTTP 端点**（出站 GET，无需 token、无需登录）。
2. **主源 B：东方财富季报全文接口**（`np-cnotice-fund.eastmoney.com/api/content/ann`，HTTP、免费、无 token）。传入公告 `art_code`（如 `AN202607201827132608`）即返回 PDF 直链（`pdf.dfcfw.com/...pdf`）+ 季报全文 `notice_content` 文本；三张配置表在文本中结构化存在，正则即可抽取，**无需 pdf-parse 解析 PDF**（PDF 仅作兜底）。`art_code` 通过**解析基金主页 HTML（`fund.eastmoney.com/{code}.html`，服务端渲染最新公告列表）** 发现（纯 HTTP + cheerio，无需 eid / Playwright），详见 §2.3。
3. **本地计算补足**：风险指标（波动/回撤/夏普）从已抓的 NAV 历史直接算，不依赖任何接口。
4. **缺失即兜底**：某字段端点临时失败 → 沿用上次成功值或置空；前端对空数组显示「不适用」。**不做伪兜底、不填假数据**。

> 实测关键认知（2026-08-11 / 08-12 真机探活）：
> - 东财 `FundArchivesDatas.aspx` 的大分子类型**已被废弃**，只剩 `jjcc`(持仓) 还在；`zcpz`(资产配置)/`hytz`(行业)/`qscc`(区域)/`jjpj`(评级) 全部返回空壳；公告 ID 接口 `ggmx`（含 `ut` 令牌）返回 `{"ErrCode":4,"ErrMsg":"404"}`。**但** 季报本身可由东财 `np-cnotice-fund` 内容接口（传 `art_code`）干净获取：`attach_url`→`pdf.dfcfw.com` 的 PDF、`notice_content`→季报全文文本（含行业/区域/资产三张表，可直接文本抽取）。
> - 因此**行业/区域/资产配置改由东财季报全文接口抽取**，不再用 Playwright 抓取证监会 eid 的 PDF；"发现每只基金最新季报的 `art_code`"也无需 eid/Playwright——**直接解析基金主页 `fund.eastmoney.com/{code}.html`**（服务端渲染的最新公告列表，含 `gonggao/{code},AN{id}.html` 链接），再经内容接口还原完整标题识别季报（ggmx / np-cnotice list / datacenter 多 reportName 实测均 404，但主页 HTML 可用），详见 §2.3。

---

## 二、实测结论（2026-08-11/12 真机探活）

### 2.1 当前可用 ✅（东财免费端点）
| 端点 | 实测 | 提供字段 |
|---|---|---|
| `api.fund.eastmoney.com/f10/lsjz` | ✅ 1190B JSON（数据至 2026-08-07） | NAV、累计净值、日涨跌%、申购状态、赎回状态、**数据日期**（QDII T+1/T+2） |
| `FundArchivesDatas.aspx?type=jjcc` | ✅ 11711B（HTML 嵌在 `content` 字段） | 前十大持仓（被动基金穿透到母基金持仓） |
| `jbgk_{code}.html` | ✅ 44633B HTML（GBK） | 规模、费率（管理费/托管费）、基金经理、管理公司、成立日、业绩基准、投资目标/范围、风险等级、申购状态 |
| `jdzf_{code}.html` | ✅ 49161B HTML | 阶段涨幅（近1月~成立来）+ 同类排名 |
| `fundgz.1234567.com.cn/js/{code}.js` | ⚠️ 本次返回 HTML 页（疑似反爬/重定向），需进一步处理 | 盘中实时估值（**可选**，官方 NAV 已由 lsjz 覆盖，估值缺失不致命） |

### 2.2 当前停用 ❌（原文档误判为可用，本版修正）
| 端点 | 实测 | 原用途 | 影响 |
|---|---|---|---|
| `FundArchivesDatas.aspx?type=zcpz` | 12B 空壳 | 资产配置 | **改由东财季报全文接口 `notice_content` 文本抽取（§2.3）** |
| `FundArchivesDatas.aspx?type=hytz` | 12B 空壳 | 行业分布 | 同上 |
| `FundArchivesDatas.aspx?type=qscc` | 12B 空壳 | 区域/国家分布 | 同上 |
| `FundArchivesDatas.aspx?type=jjpj` | 12B 空壳 | 评级 | **评级字段已从产品删除，不再需要** |
| `api.fund.eastmoney.com/f10/ggmx`（含 `ut` 令牌） | `{"ErrCode":4,"ErrMsg":"404"}` | 东财季报公告 ID 列表 | 列表端点废弃 → **art_code 改由解析基金主页 HTML 发现（§2.3），季报内容经 `np-cnotice-fund` 内容接口（传 art_code）获取；无需 Playwright / eid** |
| `np-cnotice-fund` 内容接口 `api/content/ann?art_code=AN...` | ✅ 实测得 PDF 直链 + 全文文本 | 季报 PDF + 行业/区域/资产配置文本 | **✅ 季报主源（2026-08-12 修正）** |
| `jjgg_{code}.html` 静态页 | 仅模板 `H2_{{value.ID}}_1.pdf`，无实际 ID | 公告/PDF 链接 | 由内容接口取代 |

> 调用约定：所有 fundf10 请求带 `Referer: https://fundf10.eastmoney.com/` + `User-Agent`（实测稳定）；`lsjz` 走 `api.fund.eastmoney.com` 同样需 Referer。`fundgz` 如仍不稳，直接用 `lsjz` 最新 NAV，不做估值。

### 2.3 行业/区域/资产配置的免费可靠源：东方财富季报全文接口 ✅（2026-08-12 修正）
- **主源（取 PDF + 全文）**：`np-cnotice-fund.eastmoney.com/api/content/ann?client_source=web_fund&show_all=1&art_code=AN{时间戳}{序号}`（HTTP、免费、无 token，响应头 `access-control-allow-origin: *`）。
  - 返回 JSON：`data.attach_url` / `data.attach_url_web` → `https://pdf.dfcfw.com/pdf/H2_AN{...}_1.pdf`（**实测有效 PDF v1.5、18 页、560KB，可直链下载**）；`data.notice_content` → **季报全文纯文本**。
  - **实测（2026-08-12，基金 270042）**：`notice_content` 含 `报告期末基金资产组合情况`（序号/项目/金额(人民币元)/占基金总资产比例）、`报告期末按行业分类的股票投资组合`、`国家（地区）证券市场的股票及存托凭证投资分布` 等小节——三张配置表在文本中**结构化存在**，正则即可抽取，**无需 pdf-parse 解析 PDF**。
  - **被动/联接基金**（如 ETF 联接）季报常写"本基金本报告期末未持有股票及存托凭证"——抽取逻辑需识别"未持有/不适用"并留空（前端「不适用」），属正常数据特征。
- **art_code（公告 ID）的发现（纯 HTML 解析，无需 Playwright / eid）**：东财未暴露干净的列表 JSON 接口（实测 `ggmx`、`np-cnotice-fund/api/notice/list`、`datacenter` 多个 `reportName` 均 404；`fund.eastmoney.com/gonggao/CODE.html` 为 404 空壳页）。但**基金主页 `fund.eastmoney.com/{code}.html` 服务端渲染了最新公告列表**（实测 121KB 静态 HTML，含 `gonggao/{code},AN{id}.html` 链接 + 截断标题 `newsTit` + 日期 `newsData`）。发现流程：
  - ① `cheerio` 解析主页 → 提取所有 `gonggao/{code},AN{id}.html` 链接，得到最新 ~5 条 `art_code`；
  - ② 对每条调 `np-cnotice-fund/.../content/ann?art_code=AN...` → 取**完整标题** `notice_title` + `notice_date`（实测：主页截断的"广发纳斯达克100交易型开放式指数"经内容接口还原为完整"…联接基金(QDII)2026年第2季度报告"）；
  - ③ 过滤 `notice_title` 含"季度报告"/"季报" → 取 `notice_date` 最新者即为目标季报；其 `art_code` 写入 `quarterly_ann` 表（**永久有效**，季报 PDF 不会失效）。
  - **健壮性**：主页仅暴露最新 ~5 条（季报若被更新的公告挤出列表则主页发现不到）。缓解：① `art_code` 一旦发现即缓存进 DB，跨周期沿用（季报 PDF 永久可用）；② 季度全量任务每周复扫主页，发现更新则刷新；③ 初始可一次性人工播种 15 只基金的 `art_code`（用户已给样例 `270042 → AN202607201827132608`），作为兜底，确保上线即有正确源。
- **解析（文本优先）**：优先用 `notice_content` 按小节标题锚点 + 表格行正则 + 数值/百分比提取；若文本缺失关键表，再用 `pdf-parse`/`pdftotext` 解析 `attach_url` 的 PDF 兜底。任一基金解析失败则留空 + 日志 + 支持人工补录。

---

## 三、字段级可获取性审计（前端 PRD §4.2 全字段 · 据 2026-08-12 决策）

更新频率：**【每日】**=A 类，**【季更】**=B 类（东财），**【季更·PDF】**=B 类（季报 PDF）。

> **`tab` / `pill` 分类不是抓取字段**：由后端分类器（§4.5）根据 `benchmark`/`target`/`scope` 文本自动计算，结果写入 `funds` 表、API 透传，前端动态聚合。**不进抓取链路**。

| # | PRD 字段 | 频率 | 来源 | 当前状态 |
|---|---|---|---|---|
| 1 | `name/code` | 季更 | `jbgk` / 配置 | ✅ |
| — | `tab/pill` 分类 | 自动计算（见 §4.5） | `classify.js` 依 `benchmark`/`target`/`scope` | ✅ |
| 3 | `limit` 限购金额 / `purchaseStatus` 申购状态 | **每日** | `lsjz.SGZT` + `jbgk` | ✅（状态为主，金额缺失显示「无限额/—」） |
| 4 | `risk` 风险等级 | 季更 | `jbgk` | ✅ |
| 5 | `scale` 规模 | 季更 | `jbgk` | ✅ |
| 6 | `fee` 费率 | 季更 | `jbgk`（管理费/托管费） | ✅ |
| 7 | `returnDaily` 日涨跌 | **每日** | `lsjz.JZZZL` | ✅ |
| 8 | `returnYTD` 今年以来 | 季更 | `jdzf` | ✅ |
| 9 | `return1y` 近1年 | 季更 | `jdzf` | ✅ |
| 10 | `holdings` 前十大持仓 | 季更 | `jjcc` | ✅ |
| 11 | `industry` 行业分布 | **季更·PDF** | 东财季报全文接口 `notice_content` 文本（§2.3） | ✅（HTTP 取全文；PDF 仅兜底） |
| 12 | `market` 区域/国家分布 | **季更·PDF** | 东财季报全文接口 `notice_content` 文本（§2.3） | ✅ |
| 13 | `assets` 资产配置 | **季更·PDF** | 东财季报全文接口 `notice_content` 文本（§2.3） | ✅ |
| 14 | `perf` 历史业绩+排名 | 季更 | `jdzf` | ✅ |
| 15 | `riskMetrics` 波动/回撤/夏普 | 季更 | **本地算**（NAV 历史） | ✅（α/β 需基准，暂缺） |
| 16 | `profile.codeInfo` 全称 | 季更 | `jbgk` | ✅ |
| 17 | `profile.manager` 管理公司 | 季更 | `jbgk` | ✅ |
| 18 | `profile.benchmark` 基准 | 季更 | `jbgk` | ✅ |
| 19 | `profile.target` 投资目标 | 季更 | `jbgk` | ✅ |
| 20 | `profile.scope` 投资范围 | 季更 | `jbgk` | ✅ |
| 21 | `profile.fm` 基金经理 | 季更 | `jbgk` | ✅ |
| 22 | `nav` / `accNav` / `dataAsOf` | **每日** | `lsjz` | ✅ |

> **`ratings` 评级字段已从产品模型删除**（用户决策 2026-08-12）：前端不再展示、后端不再输出、PRD §4.2 已移除该字段。原依赖的 `jjpj` 端点停用，但因字段本身取消，无关紧要。

### 审计结论
- **22 个字段全部有来源**：19 个通过东财免费端点 + 本地计算稳定可获取；**3 个（行业/区域/资产）通过东财季报全文接口** 获取（传 art_code 取 `notice_content` 文本抽取，每季刷新；art_code 经解析基金主页 HTML 发现，详见 §2.3，无需 eid/Playwright）。
- 被动/联接类 QDII 的 `industry`/`market`/`assets` 本就常为空，与"文本/PDF 抽取失败"叠加时前端显示「不适用」，属正常。

**一句话：核心数据（净值/持仓/业绩/规模/费率/档案/风险指标）全部可上线；行业/区域/资产配置来自东财季报全文接口（PDF 直链 + 全文文本），已落实获取与解析方案。**

---

## 四、后端数据结构（落地实现）

### 4.1 项目结构
```
fund_dashboard/
  backend/
    config/funds.js          # 基金清单（你维护，只列 code+name；tab/pill 自动分类）
    config/classifyOverride.js  # 个别基金人工分类/PDF解析失败补录（默认空，最后手段）
    adapters/
      tiantian.js            # 东财 JSON 端点：lsjz / jjcc / jdzf
      jbgk.js                # jbgk HTML 解析（GBK，季更重解析 + 失败沿用上次）
      report.js              # 季报：解析基金主页 HTML 发现 art_code + 调东财 np-cnotice-fund 内容接口取 PDF 直链 + notice_content 全文，优先文本抽取三大表（PDF 解析仅兜底）
      risk.js                # 本地风险指标计算（NAV 历史 → 波动/回撤/夏普）
    orchestrator.js          # 编排 + 字段来源记录 + 单基金隔离/重试
    normalize/mapper.js      # 合并为 PRD 模型（holdings.symbol/name/pct → n/r）
    classify.js              # §4.5 自动分类（benchmark/target/scope 文本 → tab/pill）
    db/sqlite.js             # 建表 + upsert（node:sqlite，零原生编译）
    jobs/scheduler.js        # 定时任务（node-cron，显式 TZ=Asia/Shanghai）
    api/server.js            # Express API（同进程静态托管前端）
    cli.js                   # 手动触发抓取/校验/重跑单基金
  data/                      # SQLite 文件
  package.json
```

> `adapters/wind.js` **已彻底移除**（Wind 服务器不可用）。`adapters/report.js` 来源改为**东财 `np-cnotice-fund` 季报全文接口**（非证监会 eid 抓 PDF；art_code 经解析基金主页 HTML 发现，无需 eid/Playwright）。

### 4.2 静态配置 `backend/config/funds.js`（只列 code + name）
```js
export const FUNDS = [
  { code: '006479', name: '广发纳斯达克100ETF联接C' },
  { code: '018147', name: '建信新兴市场优选C' },
  // …其余 13 只（只需 code + name）
];
```

### 4.3 SQLite 表设计
```sql
-- ============ A 类 · 每日更新 ============
daily_nav(code, date, nav, acc_nav, daily_return,
          purchase_status, redeem_status, limit_amount, updated_at, PRIMARY KEY(code, date));

-- ============ B 类 · 每季度更新（东财） ============
funds(code PK, name, scale, fee_rate, risk_level,
      manager, benchmark, target, scope, fm, code_info, report_date,
      tab, pill, classify_basis, updated_at);
holdings(code, rank, symbol, name, pct, shares, market_value, report_date);
performance(code, period, ret, rank, rank_total);
risk_metrics(code, calc_date, sharpe, max_drawdown, volatility, alpha, beta);

-- ============ B 类 · 每季度更新（季报 PDF） ============
industry_alloc(code, report_date, name, pct, PRIMARY KEY(code, report_date, name));
region_alloc(code, report_date, name, pct, PRIMARY KEY(code, report_date, name));
asset_alloc(code, report_date, name, pct, PRIMARY KEY(code, report_date, name));
-- pct 统一存「占净值/总资产比例」数值（如 0.4521 = 45.21%）；
-- 解析失败则该基金这三张表无行 → 前端显示「不适用」。
```

> 设计要点：
> - `daily_nav` 用 `(code, date)` 复合主键，只追加每日新净值；`latest(date)` 即 PRD 的 `dataAsOf`（QDII T+1/T+2，前端须标注数据日期）；`purchase_status` 对应 PRD `purchaseStatus`，与 `limit_amount`（对应 `limit`）分开。
> - `daily_nav` 保留全历史，供本地风险计算（需 ≥1 年 NAV，见 §六节流/深度）。
> - B 类表每次季报更新"先删旧报告期、再插新报告期"（按 `report_date`）。
> - 所有表保留 `updated_at` / `report_date` 监控新鲜度。
> - `holdings` 的 `symbol/name/pct` 由 mapper 映射为 PRD 契约 `n`(名称)/`r`(占比%)。

### 4.4 API 输出（对齐 PRD `Fund` 模型，前端零改造）
`GET /api/funds` → 完整 `Fund[]`；`tab`/`pill` 由分类器计算读取；`industry`/`market`/`assets` 由 PDF 适配器填充（空则前端「不适用」）；**`ratings` 字段不存在于响应**（已删除）。
`GET /api/fund/:code` → 单只详情（含 `daily_nav` 历史序列）。
`GET /api/health` → 各数据源连通性（东财 HTTP / 季报内容接口）+ 最近更新时间 + 字段覆盖率。
Express **同进程静态托管前端**：现有前端文件（`index.html`/`script.js`/`style.css`/`chart.umd.min.js`）位于仓库根目录，server 用 `express.static(path.join(__dirname, '..'))` 托管根目录即可（不要把前端搬进 `backend/`），生产也可由 Nginx 反代。

**`daily_nav` 合并约定（关键）**：`limit`/`purchaseStatus`/`nav`/`accNav`/`dataAsOf`/`returnDaily` **均不在 `funds` 表中**，而是来自 `daily_nav` 的最新一行（按 `date` 取最大）。API 在拼装每只 `Fund` 时，按 `code` JOIN 该基金最新 `daily_nav` 行，合并上述字段后再由 mapper 转为 PRD 模型。`funds` 表只存季更的静态/半静态字段。

### 4.5 智能双层自动分类规则（tab/pill 由后端计算，非人工配置）

> **与前端一致**：分类含 `us/apac/europe/other` 四个大类。前端 `categories` 由 `/api/funds` 返回**动态聚合**生成（pills 不写死）。
> **核心原则**：严禁仅凭基金名称字面猜测，对于主动/跨区/主题基金，必须穿透到底层实际持仓地区 (`region_alloc`) 进行科学定区！

**输入**：
1. `funds` 表的 `name`（基金名称） + `raw_type`（东财原始类型）；
2. `region_alloc` 表存储的真实区域暴露数据（美洲、大亚洲、大欧洲占比）。

#### 分类算法（双层决策树）
```
1) 阶段一 · 资产大类强规则（非纯股票类）：
   - 债券：type/name 含"纯债/混合债/债券"           → tab=other, pill=QDII债券
   - 商品：type/name 含"黄金/原油/商品/贵金属/油气/石油" → tab=other, pill=QDII商品
   - REITs：type/name 含"REIT/房地产/不动产"        → tab=other, pill=QDII REITs
   - FOF：type 含"QDII-FOF"                       → tab=other, pill=QDII-FOF

2) 阶段二 · 确定性单市场宽基/行业指数强匹配：
   - 纳斯达克（含"纳指"、"纳斯达克"、"Nasdaq"）       → tab=us,     pill=纳斯达克
   - 标普（含"标普"、"S&P"、"SP500"）              → tab=us,     pill=标普
   - 道琼斯（含"道琼斯"、"Dow"）                    → tab=us,     pill=道琼斯
   - 日本（含"日经"、"东证"、"Nikkei"、"Topix"）    → tab=apac,   pill=日本
   - 印度（含"印度"、"India"）                      → tab=apac,   pill=印度
   - 越南（含"越南"、"Vietnam"）                    → tab=apac,   pill=越南
   - 沙特/中东（含"沙特"、"中东"）                   → tab=apac,   pill=沙特/中东
   - 东南亚（含"东南亚"）                          → tab=apac,   pill=东南亚
   - 香港/恒生（含"恒生"、"香港"、"Hang Seng"）      → tab=apac,   pill=中国香港
   - 欧洲各国（含"德国/DAX"、"英国/FTSE"、"法国/CAC"）→ tab=europe, pill=对应国别

3) 阶段三 · 主动管理 / 全球 / 主题 / 新兴市场基金（穿透实际持仓地区分配 Tab）：
   - 美洲持仓占比 ≥ 50% 或居第一大持仓地区            → 归入 tab=us (美国)
     （例如建信新兴市场混合 018147，美洲持仓占 57.2%，第一大持仓为美股科技，精准归入 us！）
   - 大亚洲持仓占比 ≥ 50% 或居第一大持仓地区          → 归入 tab=apac (亚太)
   - 大欧洲持仓占比 ≥ 50% 或居第一大持仓地区          → 归入 tab=europe (欧洲)

4) 阶段四 · 细分产业主题打标（pill）：
   - 科技/芯片：含"半导体/芯片/科技/智能/移动互联/数字经济" → pill=科技/半导体
   - 行业精选：含"新能源/汽车/医药/医疗/消费/制造"         → pill=行业精选
   - 美股宽基：含"美国50/标普100"                         → pill=美股宽基
   - 主动精选：含"成长/优质/精选/蓝筹/红利/中国"           → pill=主动精选
   - 兜底：pill=海外精选
```

---

### 4.6 输出格式化契约（mapper 必须遵循，否则前端崩）

> 前端直接把 `scale`/`fee`/`risk` 当**字符串**原样渲染（如 `currentFund.scale` 直接显示），后端**不可返回裸数字**。`nav`/`accNav`/`dataAsOf`/`returnDaily`/`limit`/`purchaseStatus` 由 API 合并最新 `daily_nav` 行后注入（见 §4.4）。

| PRD 字段 | 后端来源 | mapper 输出格式 |
|---|---|---|
| `scale` | `funds.scale`（原始金额，元） | `"19.76 亿"`（≥1亿→亿，<1亿→万） |
| `fee` | `funds.fee_rate`（管理费/托管费率） | `"1.50% / 0.25%"`（管理费 / 托管费） |
| `risk` | `funds.risk_level` | `"R4-中高风险"`（jbgk 文本→R 等级映射，见下表） |
| `limit` | 最新 `daily_nav.limit_amount` | `null`=无限额；`number`=元（前端 `formatLimit` 处理） |
| `purchaseStatus` | 最新 `daily_nav.purchase_status` | `'开放' \| '暂停大额申购' \| '暂停'` |
| `nav`/`accNav`/`dataAsOf` | 最新 `daily_nav` | 数值 / 数值 / `"YYYY-MM-DD"` |
| `returnDaily` | 最新 `daily_nav.daily_return` | `number`（无则 `null`） |
| `returnYTD`/`return1y` | `performance`（jdzf） | `number`（无则 `null`） |
| `holdings` | `holdings` 表 | `[{n:name, r:pct}]`（symbol/name/pct → n/r） |
| `perf` | `performance` 表 | `[{p:区间, r:number, rank:string}]`（r 无则 `null`） |
| `riskMetrics` | `risk_metrics` 表（本地算） | `{sharpe:string, drawdown:string, vol:string, alpha:string, beta:string}`；**字段名映射：`max_drawdown`→`drawdown`、`volatility`→`vol`**（前端 §5.3.2 按此键读取）；drawdown/vol 带 `%`（如 `"-18.00%"`、`"22.00%"`），其余按计算值格式化字符串 |
| `market`/`industry`/`assets` | `region_alloc`/`industry_alloc`/`asset_alloc` 表（PDF） | `{labels:[...], data:[...]}`；`data` 为**百分比数值**（如 45.21，非 0.4521）；空则前端「不适用」 |
| `nav`/`accNav`/`dataAsOf` | 最新 `daily_nav` | `nav`(number) / `accNav`(number) / `dataAsOf`(`"YYYY-MM-DD"`)；前端须标注 `dataAsOf`（QDII T+1/T+2） |
| `ratings` | —— | **字段已从模型删除，不输出** |

**风险等级映射**（jbgk 返回中文 → PRD `R` 等级；若 jbgk 已含 R 级则原样保留）：

| jbgk 风险等级 | 输出 |
|---|---|
| 低风险 | R1-低风险 |
| 中低风险 | R2-中低风险 |
| 中风险 | R3-中风险 |
| 中高风险 | R4-中高风险 |
| 高风险 | R5-高风险 |

> **比例单位硬约束（避免前端显示 0.45% 而非 45.21%）**：`industry_alloc`/`region_alloc`/`asset_alloc` 表按 §4.3 存**小数**（如 0.4521）；mapper 输出 API 时**必须 ×100 转为百分比数值**（如 45.21），否则前端 `toFixed(2)` 会把 0.4521 显示成 `0.45%`。`holdings.pct` 若源为小数同样 ×100，若源已是百分比则原样输出。两个来源单位不同，mapper 必须统一为**百分比数值**再交给前端。

## 五、后端架构（单源编排 + 官方 PDF）

```
[ scheduler / cli ]
        │
        ▼
[ orchestrator ]  ── 逐基金、逐字段（单基金 try/catch 隔离 + 重试 + 节流）：
        │     tiantian(lsjz/jjcc/jdzf) + jbgk(HTML) + report(东财季报全文接口: HTTP) + risk(本地算)
        │                （记录每字段 source / 是否为空）
        ▼
[ adapters/tiantian.js ] [ adapters/jbgk.js ] [ adapters/report.js ] [ risk.js ]
        └────────────────┴────────────────────┴──────────────────┘
                         ▼
              [ normalize/mapper.js ]  →  PRD Fund 模型
                         ▼
                  [ db/sqlite.js ]  upsert（A 类按日 / B 类按报告期）
                         ▼
                  [ api/server.js ]  →  前端 /api/funds（+ 静态托管）
```

**编排逻辑（orchestrator.js）**：
- 对每只基金、每个字段取值；为空则标记缺失（不报错）。
- **单基金隔离**：每只基金整体包在 `try/catch` 中，单基金失败仅记日志、沿用上次成功值（B 类表保留旧 `report_date` 数据），**不阻塞整体**。
- **`jbgk` 在季度全量任务中重新解析**（规模/费率/风险等级/档案需随季报更新）；日常净值任务不重复抓取（季度内结果缓存于 `funds` 表）。
- **`report.js`（季报）在季度全量任务中运行**：解析基金主页 HTML 发现 art_code（§2.3）+ 调东财 `np-cnotice-fund` 内容接口取 `notice_content` 全文文本抽取三大表（PDF 解析仅兜底）；单基金失败则留空。
- 输出"覆盖率报告"，行业/区域/资产为空属可预期（解析失败或被动基金）。

---

## 六、更新调度（按频率要求 + 健壮性）

| 任务 | 频率 | 抓取层 | 写入表 | 说明 |
|---|---|---|---|---|
| **每日净值+状态** | 交易日盘后 18:30（`TZ=Asia/Shanghai`） | `lsjz` | `daily_nav` | QDII T+1/T+2，无新净值保留上期；核对申购/限购状态 |
| **季度全量刷新** | 季报首月 10 号 03:00（检测报告期变化） | `jbgk`+`jjcc`+`jdzf` + **`report`(东财季报全文接口)** + 本地算风险 | 所有 B 类表 + `risk_metrics` | 末尾跑 `classify.js` 重算 tab/pill |
| **手动触发** | 随时 | 全量 | 全部 | `node backend/cli.js fetch --all`（或 `--code 006479`）；附覆盖率统计；末尾必跑 classify |

**健壮性要点（上线必做，越健壮越好）：**
1. **时区**：node-cron 默认本地时区，服务器必须显式 `TZ=Asia/Shanghai`（在 systemd/pm2/Docker ENV 设置），否则 18:30/03:00 跑偏。
2. **SQL 引擎零原生编译**：优先用 **Node 22 内置 `node:sqlite`**（`import { DatabaseSync } from 'node:sqlite'`，启动加 `--experimental-sqlite`；已在本环境验证可用，免 `node-gyp` 编译，部署最稳）。备选 `better-sqlite3`（官方提供预编译二进制，通常免编译；仅在目标平台无预编译时才需构建工具）。
3. **抓取节流 + 单基金隔离**：orchestrator 在基金间加 **300–600ms 延时**，同源请求带 UA+Referer；单基金 `try/catch` 隔离，失败沿用上次值并继续；瞬时 HTTP 错误用**指数退避重试（最多 3 次，1s/2s/4s）**。
4. **NAV 历史深度**：`lsjz` 分页，适配器须**循环翻页直到覆盖 ≥ 1 年（≥ ~250 交易日）** 或到起始日，否则夏普/回撤算错；单页 `pageSize=5000` 减少请求数。
5. **季报获取并发控制**：`art_code` 经解析基金主页 HTML 发现（纯 HTTP + cheerio，无浏览器）；季报文本/PDF 经 `np-cnotice-fund` 内容接口获取（HTTP，无浏览器）；PDF/文本结果缓存到 `data/`（按 `code_reportDate`），重跑可跳过已下载。
6. **失败沿用 + 告警**：任一数据源临时失败 → 沿用上次成功值（不写假数据）；字段覆盖率跌破阈值（如行业/区域整体 <50%）→ 触发告警（日志 + 可选 webhook）。
7. **进程守护**：用 `pm2` 或 systemd 守护 `api/server.js` 常驻；崩溃自动重启。
8. **静态托管 / 反代**：Express 同进程托管前端；生产前置 Nginx（HTTPS + 静态缓存 + 限制 `/api` 频率）。

---

## 七、实施 Plan（分阶段）

### 阶段 0 · 准备（0.5 天）
- [ ] 确认 15 只基金 code + name（`config/funds.js`）。
- [ ] `package.json`：`"type": "module"`（配置文件用 ESM `export`）。
- [ ] 依赖：`express`、`node-cron`、`cheerio`（HTML 解析 + 解析基金主页发现 art_code）、`iconv-lite`（解码 jbgk/jdzf 的 GBK）、`pdf-parse`（PDF 兜底解析，主要走 `notice_content` 文本）。**DB 用 Node 内置 `node:sqlite`（零依赖）；如需改用 `better-sqlite3` 见 §六.2。整套流程无需 Playwright / eid。**
- [ ] 无浏览器依赖：art_code 经解析基金主页 HTML 发现、季报经内容接口（HTTP）获取，整套流程**零浏览器依赖**，部署镜像更小、更稳。

### 阶段 1 · 数据库 + 东财适配器 + PDF 适配器（1.5 天）
- [ ] `db/sqlite.js` 建表（§4.3，含 industry/region/asset 三张 PDF 表）。
- [ ] `adapters/tiantian.js`：`lsjz`（每日 NAV+状态，**循环翻页取 ≥1 年**）/ `jjcc`（持仓）/ `jdzf`（业绩排名）。
- [ ] `adapters/jbgk.js`：GBK HTML 解析 5+ 字段，季更重解析 + 失败沿用。
- [ ] `adapters/report.js`：**解析基金主页 HTML 发现 art_code（cheerio）→ 调东财 `np-cnotice-fund` 内容接口（传 art_code）→ 取 `notice_content` 全文文本抽取行业/区域/资产三表**（含解析失败留空 + 重试 + 文本优先 / PDF 兜底；art_code 发现缓存进 DB，跨周期沿用）。
- [ ] `cli.js` 跑全量落库，打印覆盖率。

### 阶段 2 · 风险本地算 + 分类 + API + 前端接线（1 天）
- [ ] `risk.js`：NAV 历史 → 年化波动/最大回撤/夏普。
- [ ] `classify.js`：benchmark/target/scope 文本分类（§4.5）。
- [ ] `api/server.js`：输出 PRD 模型 + 静态托管前端；`script.js` 改从 `/api/funds` 取数（保留 mock 离线回退）。

### 阶段 3 · 校验与监控（0.5 天）
- [ ] 字段逐项校验完整度；industry/market/assets 空值容忍（PDF 解析失败）；`/api/health` 覆盖率监控 + 告警。
- [ ] 日志 + 失败告警 + 手动重跑（`cli.js --code`）。

**总估时：约 3.5 个工作日。**

---

## 八、已知风险与处理

1. **评级字段已删除（用户决策 2026-08-12）**：`ratings` 从 PRD 模型、后端、前端全部移除，无评级源问题。**不再作为风险项。**
2. **被动/联接基金行业/区域/资产配置本就常空**：与文本/PDF 抽取失败叠加时前端显示「不适用」，属正常。
3. **QDII 净值延迟**：T+1/T+2，前端标注数据日期；每日任务无新净值保留上期。
4. **反爬（东财）**：请求带 UA+Referer+间隔（实测稳定）；瞬时失败指数退避重试。
5. **限购金额每日核对**：以 `lsjz` 申购状态为主，`limit_amount` 缺失则前端显示「无限额/—」（`formatLimit` 已支持 null）。
6. **`fundgz` 估值不稳**：本次返回 HTML 页，直接用 `lsjz` 最新 NAV，估值作为可选增强后续处理。
7. **【已定方案】行业/区域/资产配置 → 东财季报全文接口（2026-08-12 修正）**：
   - 主源：`np-cnotice-fund.eastmoney.com/api/content/ann?art_code=AN...`（HTTP、免费、无 token）→ `pdf.dfcfw.com` 的 PDF 直链 + `notice_content` 季报全文文本。三张配置表在文本中结构化存在，正则即可抽取，**无需解析 PDF**（PDF 仅兜底）。
   - 解析：`notice_content` 按"行业分类股票投资组合 / 国家（地区）分类权益投资组合 / 基金资产组合情况"三小节锚点 + 表格行正则 + 数值/百分比提取；被动/联接基金识别"未持有/不适用"留空；解析失败则留空 + 日志 + 支持 `classifyOverride` 补录。
   - 发现 art_code：**解析基金主页 `fund.eastmoney.com/{code}.html`**（服务端渲染最新公告列表，含 `gonggao/{code},AN{id}.html` 链接）→ 提取最新 ~5 条 `art_code` → 逐条调内容接口取完整标题 `notice_title` → 过滤"季度报告"取最新者（详见 §2.3）。纯 HTTP + cheerio，**无需 eid / Playwright**，整套流程零浏览器依赖。
   - 频率：随季度全量任务，文本/PDF 与解析结果缓存，重跑可复用。

---

## 九、部署健壮性清单（上线前逐条核对）

| # | 项 | 做法 |
|---|---|---|
| 1 | 时区 | 服务器 `TZ=Asia/Shanghai`（systemd/pm2/Docker ENV） |
| 2 | SQL 引擎 | 用 Node 内置 `node:sqlite`（启动加 `--experimental-sqlite`，零原生编译）；备选 `better-sqlite3` 预编译二进制 |
| 3 | 进程守护 | `pm2` 或 systemd 守护 `api/server.js`，崩溃自启 |
| 4 | 抓取节流 | 基金间 300–600ms 延时；同源 UA+Referer |
| 5 | 单基金隔离 | 每只基金 `try/catch`，失败沿用上次值，不阻塞整体 |
| 6 | 重试 | 瞬时 HTTP 错误指数退避（≤3 次：1s/2s/4s） |
| 7 | NAV 深度 | `lsjz` 循环翻页取 ≥1 年历史，保证风险计算准确 |
| 8 | 季报获取 | 解析基金主页 HTML 发现 art_code（纯 HTTP+cheerio）；内容接口 HTTP 取文本/PDF；结果落盘缓存 |
| 9 | 失败沿用 | 数据源临时失败 → 沿用上次成功值，不写假数据 |
| 10 | 监控告警 | `/api/health` 覆盖率监控；跌破阈值触发日志/webhook 告警 |
| 11 | 静态托管 | Express 同进程托管前端；生产前置 Nginx（HTTPS + 限频） |
| 12 | 日志 | 结构化日志（数据源/字段/耗时/错误），便于排查 |

---

> 本文件是后端工作的唯一规范。后续任何编码、修改都以此为准。如更新策略或字段归属有变，先改此文档再动手。

---

## 十、实际落地与文档差异（v6 · 2026-08-18 修正）

> 本节为准。v5（§1–§九）为设计预期，落地时因外部接口变化与范围扩大，多处实现与之不同。**所有代码以 `backend/` 实际为准。**

### 10.1 范围扩大：15 只 → 739 只全量 QDII
- `backend/config/funds.js` 由东财 `fundcode_search` 自动生成（2026-08-14），含 **739 只**份额级 QDII（A/C/币种分开），`type` 字段用于分类与风控。
- 前端只看"主流"子集：经 `jobs/mark_mainstream.mjs` / `mark_excluded.mjs` / `mark_hk.mjs` 打标后，`mainstream=1 AND region_excluded=0 AND excluded=0` 的**可见基金 = 119 只**（即 `exports/主流基金_119只.xlsx`）。API 默认视图即此 119 只；`?all=1` 含被标记"暂时不用"的基金。

### 10.2 主数据源变更：pingzhongdata 取代 lsjz/jjcc/jdzf/jbgk 拆分
- 实际落地统一走东财**基金速查 `pingzhongdata`**（`adapters/eastmoney.js` 的 `fetchPingzhong`），一次性拿到 NAV 历史 / 规模 / 费率 / 前十大持仓(CCZX) / 资产配置，比 §2.1 拆多个端点更稳、请求更少。
- 净值历史由 `pingzhongdata` 全量获取（已覆盖 ≥2 年），风险指标（波动/回撤/夏普）与阶段业绩（computePerformance）**本地计算**，无需 `jdzf`。
- `fetchLsjzLatest` / `fetchTradeLimit` / `fetchHoldings` 仍有保留作补充（最新状态/单日限购/持仓兜底），但主链路是 `pingzhongdata`。

### 10.3 np-cnotice 被封 → 行业/区域改旁路补录（关键）
- 实测东财 `np-cnotice-fund` 内容接口**已被网关封禁**（触发封禁且会污染已统一的口径），故 §2.3 的"季报全文抽取行业/区域/资产"方案**废弃**。
- **资产配置 `asset_alloc`**：由 `pingzhongdata` 直接给出（已落库，2154 行）。
- **行业配置 `industry_alloc`**：由 `backend/report_industry.mjs` 经东财 **HYPZ 公开端点**（`api.fund.eastmoney.com/f10/HYPZ/`）补录（已落库 2890 行）。
- **区域配置 `region_alloc`**：由 `backend/report_morningstar.mjs` 经**晨星中国 `morningstar.cn`** 批量抓取"股票地区分布"补录（口径：洲/地区级，合计≈100%；已落库 1316 行）。
- 以上两脚本支持断点续跑（`*_progress.json`），每片 ~250 只 / 7 分钟预算，多次运行收敛。

### 10.4 分类依据变更：name + type（非 benchmark/target/scope）
- 原 §4.5 依赖 `jbgk` 的 benchmark/target/scope 文本，但主源改为 `pingzhongdata` 后未落库这三段；基金名称本身已含"纳斯达克/标普/恒生/日经/印度"等强信号，故 `classify.js` 改为按 **`name` + `type` 关键词硬匹配**输出 `tab`/`pill`，规则确定、更稳（见 `classify.js`）。

### 10.5 季度定时任务已接报表脚本（自动刷新）
- `jobs/scheduler.js` 季度全量任务（`0 3 10 1,4,7,10 *`，`TZ=Asia/Shanghai`）跑完 `ingestAll(withReport:false)` 后，**自动续跑** `report_industry.mjs` 与 `report_morningstar.mjs`（best-effort、续跑至完成），无需手工补录行业/区域。
- 主 ingest 保持 `withReport:false`：不调已封的 `np-cnotice`，避免封禁与口径污染。

### 10.6 部署现状（与 §九 一致，落地）
- 运行环境 **Node v22** + 内置 `node:sqlite`（启动加 `--experimental-sqlite`，零原生编译）。
- `api/server.js` 同进程静态托管前端 + 提供 `/api/funds` `/api/fund/:code` `/api/health`。
- 常驻：`pm2` 或 `nohup`（见 `README.md`）守护 server + scheduler；`TZ=Asia/Shanghai`。
- 数据现状（2026-08-18）：`fund.db` ~41MB，739 funds / 323506 daily_nav / 4932 holdings / 717 risk_metrics / 2890 industry / 1316 region / 2154 asset；净值最新至 **2026-08-13**（QDII T+1/T+2，服务常驻后每日 18:30 自动刷新）。

> **版本说明**：v3（含 Wind/Tier3 PDF）→ v4（去 Wind、去 PDF、单源东财 + 本地计算）→ v5（评级字段删除；行业/区域/资产配置改用东财季报全文接口 `np-cnotice-fund`；**2026-08-12/13 修正：art_code 经基金主页 HTML 发现、零浏览器依赖**）→ **v6（2026-08-18 实际落地修正，详见 §十）**：范围扩至 739 只全量 QDII；主源统一为 `pingzhongdata`（替代原 lsjz/jjcc/jdzf/jbgk 拆分）；`np-cnotice` 实测被封，行业改 `report_industry.mjs`（东财 HYPZ）、区域改 `report_morningstar.mjs`（晨星中国）补录，二者已接入季度 cron 自动续跑；分类依据改 `name`+`type`；部署 Node v22 + node:sqlite，server/scheduler 常驻（nohup/pm2），见 README.md。
