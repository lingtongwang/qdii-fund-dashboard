# QDII 基金配置导航面板 — 完整产品设计说明书 (PRD)

> **最后更新**: 2026-08-09
> **维护者**: AI Agent (Codex)
> **当前版本**: v0.3-alpha
> **变更日志**: 每次迭代由 Agent 自动追加变更记录

---

## 目录

1. [产品背景与定位](#1-产品背景与定位)
2. [系统架构与技术栈](#2-系统架构与技术栈)
3. [视觉设计系统 (Design Tokens)](#3-视觉设计系统-design-tokens)
4. [数据模型规格 (Data Schema)](#4-数据模型规格-data-schema)
5. [功能模块详细说明](#5-功能模块详细说明)
   - [模块一：全局导航与双层筛选](#模块一全局导航与双层筛选)
   - [模块二：高密度行情看板](#模块二高密度行情看板)
   - [模块三：两级渐进式产品详情](#模块三两级渐进式产品详情)
   - [模块四：自选组合与全局穿透系统](#模块四自选组合与全局穿透系统)
   - [模块五：交易路由与闭环](#模块五交易路由与闭环)
6. [全局状态管理](#6-全局状态管理)
7. [动画与转场系统](#7-动画与转场系统)
8. [本地持久化策略](#8-本地持久化策略)
9. [开发状态看板](#9-开发状态看板)
10. [已知问题与技术债](#10-已知问题与技术债)
11. [后续演进路线图](#11-后续演进路线图)
12. [变更记录](#12-变更记录)

---

## 1. 产品背景与定位

### 1.1 市场痛点

- 国内投资者对海外资产配置需求激增，QDII 基金受到广泛关注
- QDII 基金普遍面临 **限购/限额/额度紧张** 问题，投资者难以高效比对
- 多只 QDII 基金组合时，无法直观看透 **底层资产重叠** 与 **区域/行业风险暴露**

### 1.2 产品愿景

打造一个 **极致流畅、数据高度可视化、支持底层资产穿透** 的 QDII 基金移动端聚合导航终端：

1. 快速筛选：按地区/主线/限额/收益高效筛选 QDII 基金
2. 深度研报：每只基金的完整分析（持仓、业绩、风险、档案）
3. 穿透聚合：多基金组合的底层资产加权合并，揭示真实风险暴露
4. 交易闭环：一键唤起券商 App 完成购买

### 1.3 目标用户

- 有海外资产配置需求的个人投资者
- 关注 QDII 基金限购额度和收益排名的活跃交易者
- 需要快速决策的理财顾问

---

## 2. 系统架构与技术栈

### 2.1 当前技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 结构层 | HTML5 单页应用 | 376 行，所有视图内联于同一 HTML |
| 样式层 | CSS3 (原生) | 537 行，CSS Variables + Flexbox/Grid 布局 |
| 逻辑层 | Vanilla JavaScript (ES6+) | 1286 行，无框架依赖 |
| 图表库 | Chart.js 4.x (本地 vendored) | 支持 doughnut / bar（含多数据集分组柱状图） |
| 字体 | Google Fonts — Inter (400/500/600/700) | 中文回退 PingFang SC / 系统字体，金融数据等宽对齐 (`tabular-nums`) |
| 持久化 | localStorage | 收藏列表、权重模式、自定义金额 |
| 运行依赖 | jsdom (node_modules) | 可能用于未来 SSR/测试场景 |

### 2.2 文件结构

```
fund_dashboard/
├── index.html                              # 主页面（含所有视图模板）
├── style.css                               # 全局样式表
├── script.js                               # 应用逻辑（数据 + 渲染 + 事件）
├── QDII_Fund_Dashboard_Comprehensive_PRD.md # 本文档
├── chart.umd.min.js                        # Chart.js 本地副本（离线可用，替代 CDN）
├── package.json                            # npm 依赖声明
└── node_modules/                           # npm 依赖包（jsdom 等）
```

### 2.3 页面视图层级 (View Stack)

```
┌─────────────────────────────────────────────┐
│  Bottom Navigation (全局常驻)                │
│  ┌──────────┐  ┌──────────┐                 │
│  │   主页    │  │   收藏    │                 │
│  └──────────┘  └──────────┘                 │
├─────────────────────────────────────────────┤
│  主页视图 (#main-page)                       │
│  ├── Header (sticky, glassmorphism)         │
│  │   ├── 品牌标题区                         │
│  │   ├── 搜索框 (名称/代码模糊搜索)          │
│  │   ├── 一级 Tab (宏观大区)                │
│  │   └── 二级 Pill (微观主线)               │
│  ├── 列表表头 (sortable)                    │
│  └── 基金列表 (fund-list)                   │
├─────────────────────────────────────────────┤
│  收藏视图 (#favorites-page)                  │
│  ├── Header                                 │
│  ├── 收藏基金列表                           │
│  ├── 底部操作栏                             │
│  │   ├── 设置按钮 (⚙️) → Settings Sheet     │
│  │   └── 生成穿透报告按钮                   │
│  └── Settings Sheet (权重模式选择)          │
├─────────────────────────────────────────────┤
│  Level 1: Bottom Sheet (#bottom-sheet)       │
│  从底部滑出，展示基金摘要信息               │
├─────────────────────────────────────────────┤
│  Level 2: Full Detail (#full-detail-page)    │
│  从右侧滑入全屏，展示深度研报               │
├─────────────────────────────────────────────┤
│  Level 3: Look-through Report                │
│  (#lookthrough-report-page)                  │
│  从右侧滑入全屏，展示穿透聚合报告           │
├─────────────────────────────────────────────┤
│  Level 4: Compare Report (#compare-page)     │
│  从右侧滑入全屏，展示多基金横向对比         │
└─────────────────────────────────────────────┘
```

---

## 3. 视觉设计系统 (Design Tokens)

### 3.1 色彩体系

```css
/* 背景色阶 */
--bg-app: #F8FAFC;          /* 应用底色 (slate-50) */
--bg-surface: #FFFFFF;       /* 卡片表面 */

/* 文字色阶 */
--text-primary: #0F172A;     /* 主文字 (slate-900) */
--text-secondary: #64748B;   /* 次文字 (slate-500) */
--text-tertiary: #94A3B8;    /* 弱文字 (slate-400) */

/* 主题色 */
--accent-blue: #2563EB;      /* 品牌蓝 (blue-600) */
--accent-blue-hover: #1D4ED8; /* 蓝色 hover (blue-700) */
--accent-blue-light: #EFF6FF; /* 浅蓝底 (blue-50) */

/* 语义色 */
--success: #059669;          /* 涨/正 (emerald-600) */
--success-bg: #D1FAE5;       /* 涨色底 (emerald-100) */
--danger: #DC2626;           /* 跌/负 (red-600) */
--danger-bg: #FEE2E2;        /* 跌色底 (red-100) */

/* 边框色阶 */
--border-light: #E2E8F0;     /* 标准边框 (slate-200) */
--border-lighter: #F1F5F9;   /* 轻量边框 (slate-100) */
```

### 3.2 阴影系统

```css
--shadow-sm: 0 1px 2px 0 rgba(0,0,0,0.05);                    /* 微阴影 */
--shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06); /* 中阴影 */
--shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05); /* 大阴影 */
--shadow-float: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); /* 浮层 */
```

### 3.3 排版规范

- **主字体**: `'Inter', -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
- **金融数字**: `font-variant-numeric: tabular-nums` (全局应用于数据列)
- **品牌标题**: 24px / 700 weight / letter-spacing: -0.5px
- **品牌副标题**: 13px / 500 weight / text-secondary

### 3.4 圆角体系

- 药丸按钮 (Pill): `border-radius: 100px`
- 卡片: `border-radius: 16px-20px`
- 输入框/表格: `border-radius: 12px`
- 统计框: `border-radius: 12px`

### 3.5 动画曲线

```css
--transition-fast: 0.2s cubic-bezier(0.4, 0, 0.2, 1);      /* 快速过渡 */
--transition-bounce: 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); /* 弹性 */
--transition-smooth: 0.4s cubic-bezier(0.16, 1, 0.3, 1);   /* iOS 风格 */
```

---

## 4. 数据模型规格 (Data Schema)

### 4.1 地区大类与基金类型双层分类体系 (Dual-Layer Architecture)

> **设计准则**：
> 1. **一级大类（Tab：地理大区）**：按核心投资区域划分为 **美国 (`us`)**、**亚太 (`apac`)**、**欧洲 (`europe`)**、**其他 (`other`)**；
>    - 主动管理与跨区基金（如建信新兴市场混合）：直接穿透底层真实持仓地区暴露 (`region_alloc`)，以第一大权重地区判定归属大区；
> 2. **二级小类（Pill：基金细分类型 / 主题 / 跟踪指数）**：在各地区大区下，按基金的具体投资类型和主题细分呈现，前端根据数据动态聚合；
>    - **指数/宽基类**：`纳斯达克`、`标普`、`道琼斯`、`美股宽基`、`日本`、`印度`、`越南`、`英国` 等；
>    - **产业/主题类**：`科技/半导体`、`行业精选`（医疗/消费/新能源等）；
>    - **主动管理类**：`主动精选`（成长/优质/蓝筹等）、`海外精选`（全球精选/跨区配置）；
>    - **大类资产**：`QDII商品`、`QDII债券`、`QDII-FOF`；
> 3. **入池标准（纯场外 · 人民币份额）**：
>    - **全面剔除场内 ETF**（标记 `exchange_excluded=1` 软隐藏），仅收录可在天天基金等场外直接申购/定投的开放式基金与联接基金；
>    - **全面剔除美元/外币份额**（标记 `currency_excluded=1` 软隐藏），仅收录人民币份额；
>    - 数据库历史数据 100% 完整保留。

```javascript
{
    id: string,          // 一级 Tab 标识: 'us' | 'apac' | 'europe' | 'other'
    name: string,        // 显示名称: '美国' | '亚太' | '欧洲' | '其他'
    pills: string[]      // 二级标签数组，首项固定为 '全部'，其余由数据动态聚合
}
```

**纯场外人民币份额 QDII 基金池分类结构全景表（共 125 只）：**

| 一级地区大类 (Tab) | 二级投资方向/主题 (Pill) | 数量 | 分类界定依据与典型标的 |
| :--- | :--- | :---: | :--- |
| **美国 (`us`)**<br/>(共 67 只) | **纳斯达克** | 18 只 | **仅限纯纳斯达克100宽基指数**（`270042` 广发纳指A、`000834` 大成纳指A 等） |
| | **标普** | 7 只 | **仅限纯标普500/标普100宽基指数**（`050025` 博时标普500、`161125` 易方达标普500、`096001` 大成标普500等权 等） |
| | **科技/半导体** | 14 只 | **科技/芯片/AI/互联网方向**（`017091` 景顺长城纳指科技、`161128` 标普信息科技、`024239` 华夏科技先锋、`017654` 创金合信芯片 等） |
| | **生物医药** | 5 只 | **生物科技/医疗健康方向**（`001092` 广发生物科技、`017894` 汇添富纳指生物科技、`161126` 标普医疗保健、`004877` 汇添富全球医疗 等） |
| | **消费/新能源** | 7 只 | **消费品/新能源汽车方向**（`162415` 标普美国消费、`006308` 汇添富全球消费、`018036` 长城全球新能源车 等） |
| | **全行业配置** | 16 只 | **跨行业/综合成长主动配置**（`018147` **建信新兴市场**、`000041` 华夏全球股票、`270023` 广发全球精选、`018230` 易方达全球优质 等） |
| **亚太 (`apac`)**<br/>(共 47 只) | **日本** | 2 只 | **日本宽基指数**（`007280` 富国日经225联接、`020712` 华安三菱日联日经225 等） |
| | **印度** | 2 只 | **印度市场标的**（`006105` 宏利印度股票、`164824` 工银印度基金） |
| | **越南** | 1 只 | **越南市场标的**（`008763` 天弘越南市场发起A） |
| | **东南亚** | 1 只 | **东南亚科技标的**（`020515` 华泰柏瑞东南亚科技联接A） |
| | **科技/半导体** | 5 只 | **移动互联/半导体主题**（`000988` 嘉实全球互联网、`019454` 中韩半导体、`022184` 富国全球科技 等） |
| | **生物医药** | 5 只 | **医疗创新/生物科技主题**（`001984` 摩根中国生物医药、`025070` 东方红医疗创新、`025654` 富国医药精选 等） |
| | **消费/高端制造** | 5 只 | **消费/高端制造升级主题**（`012060` 富国全球消费、`016665` 天弘高端制造、`016199` 汇添富全球汽车升级 等） |
| | **全行业配置** | 26 只 | **大中华/亚太全行业配置**（`110011` 易方达优质精选、`100061` 富国中国中小盘、`012584` 南方中国新兴经济 等） |
| **欧洲 (`europe`)**<br/>(共 4 只) | **德国** | 1 只 | **德国核心宽基**（`000614` **华安德国(DAX)联接A**） |
| | **法国** | 1 只 | **法国核心宽基**（`021539` **华安法国CAC40ETF联接A**） |
| | **英国** | 1 只 | **英国核心宽基**（`539003` **建信富时100指数A**） |
| | **全行业配置** | 1 只 | **欧洲全行业成长**（`006282` **摩根欧洲动力策略**） |
| **其他 (`other`)**<br/>(共 7 只) | **QDII REITs** | 1 只 | **不动产信托**（`160140` **南方道琼斯美国精选A**，跟踪道琼斯美国精选REIT指数） |
| | **QDII商品** | 3 只 | **大宗商品/原油**（`162719` 广发道琼斯石油、`160416` 华安标普全球石油 等） |
| | **QDII-FOF** | 3 只 | **多元资产配置**（`017970` 摩根海外稳健配置、`163813` 中银全球策略 等） |

### 4.2 基金数据模型 (Fund)

```javascript
{
    // === 基础信息 ===
    code: string,                    // 基金代码 (6位数字) —— 代表份额代码（为主流展示所用）
    name: string,                    // 基金聚合展示全称 (多份额自动归一化合成，如 '建信新兴市场混合(QDII) A/C'、'广发纳斯达克100ETF联接(QDII) A/C/F')
    trackingIndex: string|null,      // 指数基金跟踪标的指数名称 (如 '道琼斯美国精选REIT指数'、'纳斯达克100指数'，主动基金为 null)
    indexCode: string|null,          // 跟踪标的指数代码 (如 'DWRTF'、'NDX100'、'SPX')
    limit: number|null,              // 单日申购限额 (单位: 元；null 表示无限额；>10000000 历史哨兵仍兼容)
    purchaseStatus: string,          // 申购状态: '开放' | '暂停大额申购' | '暂停'（与 limit 分开，来源于 daily_nav.purchase_status）
    dataAsOf: string,                // 数据日期 (YYYY-MM-DD)，QDII 净值 T+1/T+2 延迟，UI 须标注
    risk: string,                    // 风险等级 (如 'R4-中高风险')
    scale: string,                   // 基金规模 (如 '19.76 亿')
    fee: string,                     // 管理费/托管费 (如 '1.50% / 0.25%')

    // === 分类归属 ===
    tab: string,                     // 所属一级 Tab ID
    pill: string,                    // 所属二级 Pill 名称

    // === 收益率指标 ===
    returnDaily: number,             // 日涨跌幅 (%)
    returnYTD: number,               // 今年以来收益 (%)
    return1y: number,                // 近1年收益 (%)

    // === 持仓数据 ===
    holdings: [{n: string, r: number}],  // 前十大持仓 [{名称, 占比%}]

    // === 市场分布 ===
    market: {
        labels: string[],            // 区域名称数组
        data: number[]               // 对应占比 (%)
    },

    // === 行业分布 ===
    industry: {
        labels: string[],            // 行业名称数组
        data: number[]               // 对应占比 (%)
    },

    // === 资产配置 ===
    assets: {
        labels: string[],            // 资产类别 (如 ['股票','银行存款','其他'])
        data: number[]               // 对应占比 (%)
    },

    // === 历史业绩 ===
    perf: [{
        p: string,                   // 区间名 (如 '近1月', '今年以来', '年化收益率')
        r: number,                   // 回报率 (%)
        rank: string                 // 同类排名 (如 '125', '—')
    }],

    // === 风险指标 ===
    riskMetrics: {
        sharpe: string,              // 夏普比率
        drawdown: string,            // 最大回撤 (带 %)
        vol: string,                 // 波动率 (带 %)
        alpha: string,               // Alpha (带 %)
        beta: string                 // Beta
    },

    // === 产品档案 ===
    profile: {
        codeInfo: string,            // 代码信息 (如 '539002.OF / 539002')
        manager: string,             // 管理公司
        benchmark: string,           // 业绩基准
        target: string,              // 投资目标
        scope: string,               // 投资范围
        fm: string                   // 基金经理
    }
}
```

> **字段语义约定（防止后端映射错位）**：`manager` = 管理公司（基金管理人），`fm` = 基金经理（现任）。后端 §4.2 审计表 21/22 行曾将二者颠倒，以本 PRD 为准，mapper 输出须对齐此语义。持仓契约字段为 `n`(名称)/`r`(占比%)，与后端 `holdings` 表列 `symbol/name/pct` 不同，mapper 须映射为此结构。**行业/区域/资产配置（`industry`/`market`/`assets`）来自东财季报全文接口 `np-cnotice-fund`（后端 §2.3，取 `notice_content` 全文文本抽取，PDF 仅兜底），解析失败/被动基金则空数组，前端显示「不适用」。****评级字段已从产品模型删除**（用户决策 2026-08-12），后端不再输出、前端不再展示。

### 4.3 当前 Mock 数据

目前 `mockFunds` 数组包含 15 只演示基金，已覆盖全部 5 个一级 Tab 与所有二级 Pill
（部分新增基金代码为演示占位，正式接入数据源时替换即可）:

| 序号 | 基金名称 | 代码 | 限额 | Tab | Pill |
|----|---------|------|------|-----|------|
| 1 | 建信新兴市场混合(QDII)C | 018147 | 5,000 元 | other | 其他 |
| 2 | 易方达全球优质企业混合(QDII)C | 018230 | 10,000 元 | other | 其他 |
| 3 | 广发纳指100ETF联接(QDII)C | 006479 | 5 万 | us | 纳斯达克 |
| 4 | 国泰纳斯达克100(QDII) | 160213 | 无限额 | us | 纳斯达克 |
| 5 | 博时标普500ETF联接(QDII) | 050025 | 2 万 | us | 标普 |
| 6 | 嘉实全球互联网股票(QDII) | 000988 | 3 万 | us | 其它 |
| 7 | 景顺长城大中华混合(QDII) | 262001 | 8,000 元 | apac | 中国香港 |
| 8 | 广发亚太中高收益债券(QDII) | 000274 | 3 万 | apac | 其他 |
| 9 | 上投摩根欧洲动力策略(QDII) | 000970 | 6 万 | europe | 英国 |
| 10 | 华安德国30(DAX)ETF联接(QDII) | 000614 | 10 万 | europe | 德国 |
| 11 | 南方法国CAC40指数(QDII) | 001063 | 4 万 | europe | 法国 |
| 12 | 鹏华全球高收益债(QDII) | 000290 | 无限额 | other | QDII债券 |
| 13 | 华安标普全球石油(QDII-LOF) | 160416 | 5 万 | other | QDII商品 |
| 14 | 南方道琼斯美国精选REIT(QDII-LOF) | 160140 | 1 万 | other | QDII REITs |
| 15 | 汇添富全球消费行业混合(QDII) | 006309 | 2 万 | europe | 其他 |

> 数据统一由 `FundRepository` 仓储访问（`all` / `byId` / `byFavorites` / `search`），
> 未来对接真实 API 时仅需替换该模块内部实现。

---

## 5. 功能模块详细说明

### 模块一：全局导航与双层筛选

**开发状态**: ✅ 已完成

#### 5.1.1 底部导航 (Bottom Navigation)

- **位置**: 全局底部固定 (`position: fixed; bottom: 0`)
- **样式**: 毛玻璃效果 (`backdrop-filter: blur(12px)`)
- **Tab 项**:
  - 🏠 主页 (`#nav-home`) — 切换到主列表页
  - ⭐ 收藏 (`#nav-favorites`) — 切换到收藏夹
- **交互**: 点击切换 `activePage` 状态，触发对应页面渲染
- **实现**: `switchPage(page)` 函数，通过 toggle `active` class 控制页面显隐

#### 5.1.2 一级 Tab (宏观大区)

- **容器**: `#tab-container`，水平滚动 (`overflow-x: auto`)
- **渲染**: `renderTabs()` 函数，基于 `categories` 数组动态生成 `<button class="tab-btn">`
- **选中态**: `.tab-btn.active` 文字变为蓝色，底部出现 3px 蓝色指示条（带 `slideUpFade` 动画）
- **交互逻辑**: 点击 Tab 时重置二级 Pill 为 '全部'，重新渲染列表

#### 5.1.3 二级 Pill (微观主线)

- **容器**: `#pill-container`，水平滚动
- **渲染**: `renderPills()` 函数，基于当前 Tab 的 `pills` 数组生成 `<button class="pill-btn">`
- **选中态**: 蓝色填充背景 + 白色文字
- **交互逻辑**: 点击 Pill 触发列表过滤重载

#### 5.1.4 筛选逻辑

```
过滤规则:
1. 只显示 tab === activeTab 的基金（分类由后端动态计算，见 §4.1）
2. 二级 Pill = '全部' → 不做 pill 过滤
3. 二级 Pill ≠ '全部' → 只显示 pill === activePill 的基金
```

**实现位置**: `renderListWithAnimation()` 函数内 `filtered` 变量

#### 5.1.5 搜索 (v0.3 新增)

- **位置**: 主页面 Header 内搜索框（`#search-input`）
- **匹配规则**: 基金名称 / 代码 / 二级 Pill 名称模糊匹配（不区分大小写）
- **交互**: 200ms 防抖输入，实时刷新列表；输入为空时点击 ✕ 清空并恢复
- **联动**: 搜索与 Tab/Pill 过滤叠加生效；无结果时显示空状态提示
- **实现**: `FundRepository.search(query)` + `renderListWithAnimation()`

---

### 模块二：高密度行情看板

**开发状态**: ✅ 已完成

#### 5.2.1 列表布局

- **网格**: CSS Grid `grid-template-columns: 2fr 1fr 1fr`
- **三列**: 左侧(基金名称+代码) | 中间(限额) | 右侧(收益率)
- **列表头**: sticky 固定（`position: sticky`，偏移量由 `syncStickyOffsets()` 依据 Header 实际高度动态计算），毛玻璃背景
- **每行结构**:
  - 左侧: 收藏星标按钮 + 基金名称 + 基金代码（竖排）
  - 中间: 限额值 (≥10000 显示为"X万"，>10000000 显示"无限额")
  - 右侧: 收益率标签 (正数绿底 `.positive-bg`，负数红底 `.negative-bg`)

#### 5.2.2 排序系统

- **排序列**: 限额列 (`#sort-limit`) + 收益列 (`#sort-return`)
- **排序状态**: `sortCol` (排序字段 key) + `sortDesc` (是否降序)
- **交互**:
  - 点击当前排序列 → 切换升/降序
  - 点击非排序列 → 切换到该列，默认降序
- **图标**: 三种 SVG 图标状态（默认双箭头 / 升序上箭头 / 降序下箭头）
- **实现**: `updateSortUI()` 更新排序图标 DOM

#### 5.2.3 收益指标切换

- **指标列表**:
  ```javascript
  metrics = [
      { key: 'return1y', label: '近1年' },
      { key: 'returnDaily', label: '日涨跌' },
      { key: 'returnYTD', label: '今年以来' }
  ]
  ```
- **交互**: 点击表头 `#metric-label` 文字，在三个指标间循环切换 (`currentMetricIdx`)
- **联动**: 切换指标后自动将 `sortCol` 设为新指标键，列表重排序

#### 5.2.4 列表动画

- **进场动画**: 每行 `fadeInUp` 动画，级联延迟 `idx * 0.08s`
- **加载指示**: 切换筛选时短暂显示 spinner (`#loading-spinner`)，150ms 延迟模拟加载感
- **实现**: `renderListWithAnimation()` 函数

#### 5.2.5 收藏星标

- **位置**: 每行基金名称左侧
- **样式**: SVG 星形图标，激活时填充黄色 (`fill: #F59E0B`)，未激活时仅描边
- **交互**: 点击调用 `toggleFavorite(code)`，切换收藏状态并同步 localStorage
- **事件委托**: `elFundList.addEventListener('click', ...)` 通过 `e.target.closest('.fav-btn')` 匹配

---

### 模块三：两级渐进式产品详情

**开发状态**: ✅ 已完成（持仓点击穿透为模拟实现）

#### 5.3.1 Level 1 — Bottom Sheet (底部抽屉)

- **触发**: 点击基金行中的名称/代码区域 (`open-detail-trigger`)
- **动画**: 从底部滑出 (`translateY(100%) → translateY(0)`)，使用 `transition-smooth` 曲线
- **遮罩**: `.sheet-overlay` 半透明黑色遮罩，点击可关闭
- **关闭方式**: 关闭按钮 (×) / 点击遮罩

**展示内容:**

| 区域 | 内容 | 实现 |
|------|------|------|
| 头部 | 基金名称 + 代码标签 + 风险等级标签 | `#sheet-fund-name/code/risk` |
| 操作栏 | "查看深度研报" 按钮 → 触发 Level 2 | `#btn-detailed-info` |
| 申购状态 | 限购额度 (格式化显示) | `#sheet-limit-status` |
| 费率信息 | 管理费 / 托管费 | `#sheet-fee-status` |
| 市场分布 | Doughnut 图 (Chart.js) | `#marketChartSheet` |
| 前十大持仓 | 列表 (名称+占比+穿透箭头) | `#sheet-holdings` |

- **函数**: `openSheet(fundId)` / `closeSheet()` / `renderHoldingsList()`
- **持仓穿透**: `drillDownStock(stockName)` — 当前通过 `alert` 模拟，展示个股穿透提示

#### 5.3.2 Level 2 — Full Detail Page (全屏深度研报)

- **触发**: Bottom Sheet 内点击 "查看深度研报" 按钮
- **转场**: 先关闭 Sheet (300ms)，再从右侧滑入全屏页面 (`slideInRight`)
- **关闭**: 左上角返回按钮 (`#back-from-detail`)，触发 `slideOutRight` 动画 (400ms)

**展示内容 (从上到下):**

| 区块 | 内容 | 实现 |
|------|------|------|
| 基金头 | 名称 + 代码 + 风险等级 (居中) | `#full-fund-name/code/risk` |
| 申购与费率 | 双格统计框 (限额 + 费率) | `#full-limit-status/fee-status` |
| 前十大持仓 | 交互列表 (可点击穿透) | `#full-holdings` + `interactive-list` |
| 市场分布 | Doughnut 图 | `#marketChartFull` |
| 资产配置 | 最新规模 + 文字药丸 + Doughnut 图 | `#full-scale` + `#full-assets-text` + `#assetChartFull` |
| 历史业绩 | 7行表格 (区间/回报率/排名) | `#full-performance` |
| 风险指标 | 3×2 网格 (夏普/回撤/波动/Alpha/Beta) | `#rm-*` |
| 产品档案 | 6行信息表 (代码/管理人/基准/目标/范围/经理) | `#full-profile` |
| 底部 CTA | "立即唤起券商 App 交易" | `#btn-buy-full` |

- **函数**: `openFullDetail()` / `closeFullDetail()`
- **数据源**: 全局变量 `currentFund` 对象

#### 5.3.3 图表渲染

- **函数**: `renderChart(canvasId, labels, data, colors, type='doughnut', isBar=false)`
- **Chart.js 配置**:
  - Doughnut: `cutout: 75%`，右侧图例，深色 tooltip
  - Bar: `beginAtZero`，无图例，4px 圆角柱体
- **内存管理**: 每次渲染前检查并 `destroy()` 已有 chart 实例 (`charts[canvasId]`)

---

### 模块四：自选组合与全局穿透系统

**开发状态**: ✅ 已完成

#### 5.4.1 收藏管理

- **存储**: `localStorage` key = `'fav_funds'`，值为基金 `code`（6 位字符串）数组的 JSON 字符串
- **初始化**: 应用启动时从 localStorage 解析 `favoriteFundIds` 数组（仅保留与现有基金匹配的 code 字符串，旧的数字 id 会被静默过滤）
- **操作函数**: `toggleFavorite(code)` — 添加/移除 `code`，同步 localStorage，重渲染当前页面
- **容错**: `try/catch` 包裹 JSON.parse，解析失败时重置为空数组

#### 5.4.2 收藏页面 (Favorites Page)

- **视图 ID**: `#favorites-page`
- **列表头**: 两列布局 — 产品名称 | 设置投资额
- **列表渲染**: `renderFavoritesList()` 函数
- **空状态**: 无收藏时显示 "暂无收藏的基金" 提示

#### 5.4.3 三维权重模式

| 模式 | 变量值 | 权重计算 | 右侧显示 |
|------|--------|---------|---------|
| 等比例 | `'equal'` | 所有基金权重 = 1 | 显示 "1份" |
| 按限额 | `'limit'` | 权重 = 基金单日限额 | 显示限额值 (蓝色) |
| 自定义金额 | `'custom'` | 权重 = 用户输入金额 | 显示 `<input>` 输入框 |

- **设置入口**: 收藏页底部齿轮按钮 → 弹出 Settings Sheet
- **Settings Sheet**: 三个 radio 选项，点击 "应用配置" 保存并重新渲染收藏列表
- **自定义金额同步**: `input` 事件监听，实时写入 `customAmounts` 对象

#### 5.4.4 穿透报告 (Look-through Report)

- **视图 ID**: `#lookthrough-report-page`
- **触发**: 收藏页底部 "生成穿透报告" 按钮 → `generateLookthroughReport()`
- **关闭**: 左上角返回按钮 → `slideOutRight` 动画

**计算逻辑:**

```
1. 获取所有已收藏基金 (favFunds)
2. 计算每只基金权重:
   - equal: w = 1
   - limit: w = fund.limit
   - custom: w = customAmounts[fund.code] || 10000
3. 归一化: fundNormW = weights[fund.code] / totalWeight
4. 四维聚合 (加权合并):
   a. 大类资产 (aggAsset): 按标签累加 fund.assets.data[i] * fundNormW
   b. 区域分布 (aggRegion): 按标签累加 fund.market.data[i] * fundNormW
   c. 行业分布 (aggIndustry): 按标签累加 fund.industry.data[i] * fundNormW
   d. 持仓合并 (aggHoldings): 按股票名累加 holding.r * fundNormW
      - 同时记录每只来源基金及其贡献权重 (sources 数组)
5. 排序输出:
   - 资产/区域/行业: 降序排列
   - 持仓: 取 Top 10
```

**约束 (业务规则):**

- **按限额穿透拦截**: 若权重模式为 `limit` 且任一已收藏基金 `limit === null`（无限额），直接 `alert('无限额基金无法穿透')` 并中止生成报告；不允许把无限额基金混入按限额加权（确保 `w = fund.limit` 必为数值，无 NaN）。
- **饼图切片上限**: 所有 Doughnut（饼图）图表渲染时切片数控制在 **15 块以内**；若分类数 > 15，将占比最小的部分合并为一瓣「其他」（`capSlices()` 已实现）。该规则作用于 `renderChart` 的 `doughnut` 分支，对资产配置等饼图统一生效；Bar（区域/行业）不在此限。

**报告展示内容:**

| 区块 | 图表类型 | 数据来源 |
|------|---------|---------|
| 组合概览 | 文本 (合并基金数) | `favFunds.length` |
| 资产配置结构 | Doughnut | `aggAsset` (降序) |
| 区域风险暴露 | Bar (水平) | `aggRegion` (降序) |
| 行业主线分布 | Bar (水平) | `aggIndustry` (降序) |
| 隐形十大重仓 | 表格（标的名称/穿透权重） | `aggHoldings` (Top 10) |

> v0.3.7 起按产品要求移除「权重贡献图谱」列，报告精简为两列：标的名称 + 穿透权重。

#### 5.4.5 多基金横向对比 (v0.3 新增)

- **入口**: 收藏页底部操作栏「对比」按钮（`#btn-compare-toggle`）
- **选择模式**: 点击后进入对比模式，收藏列表每行出现圆形勾选器，点击行切换选中（2-4 只）
- **主操作联动**: 对比模式下「一键穿透」按钮变为「生成对比 (N/4)」；退出对比模式恢复原功能
- **对比页 (`#compare-page`)**:
  - 关键指标表: 日涨跌 / 近1年 / 今年以来 / 单日限额 / 费率 / 规模 / 风险 / 夏普 / 回撤 / 波动率，共 11 行；近1年最优值高亮
  - 区域分布对比: 多数据集分组柱状图（`compareRegionChart`）
  - 行业分布对比: 多数据集分组柱状图（`compareIndustryChart`）
- **实现**: `generateCompare()` + `renderChart(..., extraDatasets)` 多数据集扩展

---

### 模块五：交易路由与闭环

**开发状态**: ✅ 已完成（模拟状态）

- **入口位置**: Bottom Sheet 底部 + Full Detail 底部，均常驻 CTA 按钮
- **交互**:
  1. 点击按钮 → 按钮文字变为 "🚀 正在唤起券商 App..." + 透明度降低
  2. 800ms 延迟后 → `alert` 弹窗展示 Deep Link URL
  3. 恢复按钮原始状态
- **Deep Link 格式**: `xingye://fund?code={基金代码}` (兴业证券方案)
- **默认代码**: 当 `currentFund` 为 null 时使用 `'000001'`
- **函数**: `jumpToBroker()`
- **后续对接**: 将 `alert` 替换为 `window.location.href = brokerScheme` 即可真实唤起

---

## 6. 全局状态管理

### 6.1 状态变量清单

```javascript
// === 导航状态 ===
let activePage = 'home';        // 当前页面: 'home' | 'favorites'
let activeTab = 'us';           // 当前一级 Tab ID（默认首个地理 Tab；分类由后端动态计算，见 §4.1）
let activePill = '全部';        // 当前二级 Pill 名称

// === 排序状态 ===
let currentMetricIdx = 0;       // 当前收益指标索引 (0/1/2)
let sortCol = 'return1y';       // 当前排序列 key
let sortDesc = true;            // 是否降序

// === 数据状态 ===
let currentFund = null;         // 当前查看详情的基金对象
let charts = {};                // Chart.js 实例缓存 (key=canvasId)
let renderToken = 0;            // 列表渲染令牌，防止快速切换时旧定时器覆盖

// === 收藏 & 穿透 ===
let favoriteFundIds = [];       // 已收藏基金 code 数组（字符串）
let weightMode = 'equal';       // 权重模式: 'equal' | 'limit' | 'custom'
let customAmounts = {};         // 自定义金额映射 {code: amount}

// === 搜索 & 对比 (v0.3) ===
let searchQuery = '';           // 搜索关键词
let compareMode = false;        // 是否处于对比选择模式
let compareIds = [];            // 对比选中的基金 code（2-4 只）
```

### 6.2 状态流转图

```
用户操作 → 状态变更 → 重渲染

Tab 点击 → activeTab + activePill 变更 → renderTabs() + renderPills() + renderListWithAnimation()
Pill 点击 → activePill 变更 → renderPills() + renderListWithAnimation()
排序点击 → sortCol/sortDesc 变更 → updateSortUI() + renderListWithAnimation()
指标切换 → currentMetricIdx + sortCol 变更 → metric-label 更新 + updateSortUI() + renderListWithAnimation()
收藏点击 → favoriteFundIds + localStorage 变更 → renderListWithAnimation() + renderFavoritesList()
页面切换 → activePage 变更 → page active class toggle + 对应 render
Sheet 打开 → currentFund 赋值 → DOM 填充 + renderChart
```

---

## 7. 动画与转场系统

### 7.1 列表进场

- **动画**: `@keyframes fadeInUp` — `opacity:0; translateY(15px)` → `opacity:1; translateY(0)`
- **级联**: 每行 `animation-delay: idx * 0.08s`
- **曲线**: `cubic-bezier(0.16, 1, 0.3, 1)` (iOS 弹性)

### 7.2 Bottom Sheet 弹出

- **入场**: `translateY(100%)` → `translateY(0)` via `transition-smooth`
- **退场**: CSS transition 反向
- **遮罩**: `opacity 0→1` 渐显

### 7.3 Full Detail 页转场

- **入场**: `@keyframes slideInRight` — `translateX(100%)` → `translateX(0)`
- **退场**: `@keyframes slideOutRight` — `translateX(0)` → `translateX(100%)`
- **时长**: 入场 `transition-smooth` (0.4s)，退场 400ms

### 7.4 Tab 指示条

- **动画**: `@keyframes slideUpFade` — 从下方渐入
- **曲线**: `cubic-bezier(0.16, 1, 0.3, 1)`

### 7.5 微交互

- 按钮按压: `:active { transform: scale(0.96) }`
- Pill 按压: `:active { transform: scale(0.95) }`
- 列表项按压: `:active { transform: scale(0.98) }`

---

## 8. 本地持久化策略

| Key | 类型 | 用途 | 写入时机 |
|-----|------|------|---------|
| `fav_funds` | JSON Array of Strings (code) | 已收藏基金 code 列表 | `toggleFavorite()` 每次操作后 |
| `weight_mode` | JSON String | 穿透权重模式偏好 | 应用配置时 (`btn-apply-settings`) |
| `custom_amounts` | JSON Object | 自定义投资金额映射 {code: amount} | 收藏页金额输入时 |

**初始化逻辑:**
```javascript
// loadJSON(key, fallback) 统一封装 try/catch 与类型兜底
favoriteFundIds = loadJSON('fav_funds', [])
    .filter(c => typeof c === 'string' && mockFunds.some(f => f.code === c));
weightMode = ['equal', 'limit', 'custom'].includes(loadJSON('weight_mode', 'equal'))
    ? loadJSON('weight_mode', 'equal') : 'equal';
customAmounts = loadJSON('custom_amounts', {});
```

**未来需要持久化的数据 (待实现):**
- `activeTab` / `activePill` — 上次浏览位置
- `sortCol` / `sortDesc` — 排序偏好

---

## 9. 开发状态看板

| 模块 | 功能点 | 状态 | 备注 |
|------|--------|------|------|
| 导航 | 底部 Tab 切换 | ✅ 完成 | 主页/收藏 |
| 筛选 | 一级 Tab (4个大区) | ✅ 完成 | |
| 筛选 | 二级 Pill (子分类) | ✅ 完成 | |
| 列表 | 三列高密度排版 | ✅ 完成 | |
| 列表 | 限额排序 (升/降) | ✅ 完成 | |
| 列表 | 收益指标切换 (3种) | ✅ 完成 | 近1年/日涨跌/今年以来 |
| 列表 | 收益排序 (升/降) | ✅ 完成 | |
| 列表 | 级联进场动画 | ✅ 完成 | |
| 搜索 | 名称/代码模糊搜索 | ✅ 完成 | v0.3 新增 |
| 列表 | 收藏星标按钮 | ✅ 完成 | |
| 详情 L1 | Bottom Sheet 弹出 | ✅ 完成 | |
| 详情 L1 | 申购状态/费率展示 | ✅ 完成 | |
| 详情 L1 | 市场分布 Doughnut 图 | ✅ 完成 | |
| 详情 L1 | 前十大持仓列表 | ✅ 完成 | |
| 详情 L1 | 持仓点击穿透 | ⚠️ 模拟 | `alert` 模拟，待接入真实数据 |
| 详情 L2 | 全屏深度研报页 | ✅ 完成 | |
| 详情 L2 | 资产配置图表 | ✅ 完成 | |
| 详情 L2 | 历史业绩排名表 | ✅ 完成 | |
| 详情 L2 | 风险指标 (5项) | ✅ 完成 | |
| 详情 L2 | 评级字段已移除（产品决策，前端不展示） | ✅ 完成（已移除） | |
| 详情 L2 | 产品档案表 | ✅ 完成 | |
| 收藏 | 添加/移除收藏 | ✅ 完成 | localStorage 持久化 |
| 收藏 | 收藏页列表渲染 | ✅ 完成 | |
| 收藏 | 空状态提示 | ✅ 完成 | |
| 穿透 | 权重设置面板 | ✅ 完成 | 3种模式，打开时回显当前选中项 |
| 穿透 | 权重模式/自定义金额持久化 | ✅ 完成 | v0.3 修复 |
| 穿透 | 等比例权重计算 | ✅ 完成 | |
| 穿透 | 按限额权重计算 | ✅ 完成 | |
| 穿透 | 自定义金额权重 | ✅ 完成 | |
| 穿透 | 四维聚合 (资产/区域/行业/持仓) | ✅ 完成 | |
| 穿透 | 穿透报告页 | ✅ 完成 | |
| 穿透 | 权重贡献图谱 | ✅ 完成 | |
| 交易 | 券商 App 唤起 | ✅ 完成 | `alert` 模拟 Deep Link |
| 数据 | 真实 API 接入 | ❌ 未开始 | 当前纯 Mock |
| 搜索 | 基金名称/代码搜索 | ❌ 未开始 | |
| 对比 | 多基金横向对比 | ✅ 完成 | v0.3 新增，2-4 只基金 |
| 数据 | API 抽象层 (FundRepository) | ✅ 完成 | v0.3 新增，便于替换真实数据源 |

---

## 10. 已知问题与技术债

### 10.1 数据层

1. **Mock 数据硬编码**: `mockFunds` 已扩展至 15 只并覆盖全部分类，但数据仍为演示占位（部分代码非真实）
2. **数据访问已抽象**: 统一走 `FundRepository`，真实 API 替换成本已收敛到单一模块
3. **无限额判断**: 约定 `null` 表示无限额（`formatLimit` 已优先判 `null`）；`>10000000` 历史哨兵仍兼容（见 §4.2 `limit` 字段）
4. **标识与分类已重构**: 数字 `id` 废弃，统一用 `code` 作主键；分类改为后端季更动态计算、前端 `buildCategories` 动态聚合；原 `hot` Tab 移除（主题维度无后端来源）。`ratings`/`market`/`industry` 缺失时前端已加守卫（显示「—」/「不适用」）

### 10.2 交互层

1. **持仓穿透为 alert 模拟**: `drillDownStock()` 仅弹出提示，无实际穿透数据
2. **券商唤起为 alert 模拟**: `jumpToBroker()` 仅展示 Deep Link URL
3. ~~收藏页自定义金额持久化~~: 已修复，`custom_amounts` 实时写入 localStorage
4. ~~Settings Sheet radio 回显~~: 已修复，打开面板时回显 `weightMode`

### 10.3 架构层

1. **单文件结构**: HTML/CSS/JS 各一个文件，不利于长期维护
2. **全局变量**: 大量 `let` 全局变量，无模块化封装
3. **DOM 操作**: 直接 `document.getElementById` 散布各处，无统一的状态绑定
4. **事件委托已统一**: 列表/持仓等动态内容均改为容器级事件委托，重渲染后无需重复绑定
5. **绑定/存储防御式设计**: 所有事件绑定经 `bind()` 空值兜底（缺元素时跳过而不中断后续绑定），localStorage 不可用时降级 sessionStorage/内存，避免缓存混用或隐私模式下核心功能失效

### 10.4 样式层

1. **CSS 版本缓存**: `style.css?v=15` 和 `script.js?v=15` 使用查询参数绕过缓存，版本号需手动维护
2. **HTML/JS 版本自愈**: `<html data-app-version>` + JS 版本一致性检查，检测到旧 HTML 缓存时自动带参刷新一次，避免"旧 HTML + 新 JS"混用
2. **响应式局限**: `max-width: 500px` 硬编码容器宽度，大屏设备留白过多（移动端优先设计）
3. **Chart.js 已本地化**: 由 CDN 改为 `chart.umd.min.js` 本地引用，离线可用

---

## 11. 后续演进路线图

### Phase 1 — 数据层升级 (短期)

- [ ] 设计统一的 API 抽象层 (`api.js`)
- [ ] 对接真实基金数据源（东方财富免费端点 + 本地计算；Wind 已移除，见后端 §二/§八）
- [ ] 实现数据缓存策略 (localStorage + TTL)
- [ ] 增加基金搜索功能 (名称/代码模糊匹配)

### Phase 2 — 体验增强 (中期)

- [ ] 持仓穿透对接真实个股数据 (行情/研报/K线)
- [ ] 券商 Deep Link 真实对接 (兴业/天天/蛋卷等)
- [ ] 基金对比功能 (2-4只基金横向比较)
- [ ] 持久化 `weightMode` 和 `customAmounts`
- [ ] Settings Sheet 回显当前选中状态
- [ ] 增加下拉刷新和加载状态

### Phase 3 — 框架迁移 (长期)

- [ ] 迁移至 Vue3 + Pinia 或 React + Zustand
- [ ] 组件化拆分 (FundCard, BottomSheet, ChartWidget 等)
- [ ] 引入 TypeScript 类型安全
- [ ] 路由系统 (vue-router / react-router)
- [ ] 构建工具 (Vite)
- [ ] 单元测试 + E2E 测试

### Phase 4 — 多端扩展 (远期)

- [ ] 微信小程序端 (ucharts/echarts-for-weixin 替换 Chart.js)
- [ ] PWA 支持 (离线缓存 + 安装到主屏)
- [ ] 暗色模式 (Dark Mode)

---

## 12. 变更记录

| 日期 | 版本 | 变更内容 | 操作者 |
|------|------|---------|--------|
| 2026-08-09 | v0.3.7 | 按产品要求移除穿透报告「隐形十大重仓」表中的「权重贡献图谱」列，精简为标的名称/穿透权重两列；同步清理冗余聚合代码与样式；版本号提升至 v14 | Codex Agent |
| 2026-08-09 | v0.3.6 | UI 小元素美化：排序箭头改用 Feather/Lucide 风格矢量图标并加激活态药丸底、指标切换改为可点击胶囊、收益徽标等宽圆角化、同类排名改为徽标样式（前 10 名高亮）、星级加大；生成基金补齐模拟排名数据；版本号提升至 v13 | Codex Agent |
| 2026-08-09 | v0.3.5 | 增加页面版本徽标（标题旁 v11）与 CSS 版本自愈（`--app-version` 一致性检测）；彻底覆盖旧 HTML/旧 CSS 缓存场景，任一版本不一致自动带参刷新；版本号提升至 v11 | Codex Agent |
| 2026-08-09 | v0.3.4 | 修复全屏页面布局：深度研报页 transform 居中被滑入动画覆盖导致向右偏移半屏；穿透报告/对比页缺少 fixed 定位、以文档流形式出现在页面底部；统一改为 fixed + margin auto 居中并补充 100dvh；版本号提升至 v10 | Codex Agent |
| 2026-08-09 | v0.3.3 | 修复收藏页基金不可见：`.fund-item` 默认 opacity:0 且收藏页未加入场动画导致行完全透明；收藏行补入场动画 + CSS 可见性兜底；收藏页 sticky 表头切页后重算；版本号提升至 v9 | Codex Agent |
| 2026-08-09 | v0.3.2 | 增加 HTML/JS 版本自愈（旧 HTML 自动刷新）、版本号提升至 v8；修复内置浏览器缓存旧版页面导致的收藏/穿透/深度研报失效 | Codex Agent |
| 2026-08-09 | v0.3.1 | 修复缓存混用/隐私模式下收藏与穿透失效：事件绑定改为空值兜底、存储降级链（localStorage→sessionStorage→内存）、Chart 缺失时静默降级、版本号提升至 v7 | Codex Agent |
| 2026-08-09 | v0.3-alpha | 数据层扩展至 15 只基金覆盖全部分类；新增 FundRepository 仓储、名称/代码搜索、多基金横向对比、权重模式与自定义金额持久化、Settings 回显；修复按限额排序后收益率列显示异常、全屏页券商唤起反馈错位、渲染竞态、sticky 表头失效等逻辑问题；Chart.js 本地化；PRD 状态看板同步 | Codex Agent |
| 2026-08-09 | v0.2-alpha | PRD 全面重构: 补充数据模型、实现细节、开发状态看板、技术债清单 | Codex Agent |
| — | v0.1 | 初始 PRD 编写 | 产品方 |
