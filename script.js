// ============================================================
// QDII Fund Dashboard — 应用逻辑层 (v20 极速流畅版)
// 遵循 PRD §4 & §5；数据访问统一走 FundRepository (PRD Phase 1)。
// ============================================================

// ---------- 常量 ----------
const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', sans-serif";
const CHART_COLORS = ['#2563EB', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#0EA5E9', '#E2E8F0'];
const STORAGE_KEYS = {
    fav: 'fav_funds',
    weightMode: 'weight_mode',
    customAmounts: 'custom_amounts',
    history: 'qdii_search_history',
    footprints: 'qdii_fund_footprints'
};

const safeRAF = (fn) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(fn) : setTimeout(fn, 16));

// ---------- 分类体系 (PRD §4.1) ----------
const TAB_ORDER = ['us', 'apac', 'europe', 'other'];
const TAB_NAMES = { us: '美国', apac: '亚太', europe: '欧洲', other: '其他' };
const PILL_PRIORITY = [
    '全部',
    '纳斯达克', '标普', '道琼斯',
    '科技/半导体', '生物医药', '消费/新能源', '消费/高端制造', '全行业配置',
    '日本', '印度', '越南', '东南亚', '中国香港/大中华',
    '大宗商品/能源', 'QDII REITs', '多元资产FOF', 'QDII债券'
];

function buildCategories(funds) {
    const pillsByTab = {};
    funds.forEach(f => {
        const tab = f.tab || 'other';
        if (!pillsByTab[tab]) pillsByTab[tab] = new Set();
        if (f.pill && f.pill !== '全部') pillsByTab[tab].add(f.pill);
    });
    return TAB_ORDER
        .filter(t => pillsByTab[t])
        .map(t => {
            if (t === 'europe') {
                return {
                    id: t,
                    name: TAB_NAMES[t] || t,
                    pills: ['全部']
                };
            }
            const rawPills = Array.from(pillsByTab[t]);
            rawPills.sort((a, b) => {
                const idxA = PILL_PRIORITY.indexOf(a);
                const idxB = PILL_PRIORITY.indexOf(b);
                if (idxA >= 0 && idxB >= 0) return idxA - idxB;
                if (idxA >= 0) return -1;
                if (idxB >= 0) return 1;
                return a.localeCompare(b, 'zh-CN');
            });
            return {
                id: t,
                name: TAB_NAMES[t] || t,
                pills: ['全部', ...rawPills]
            };
        });
}

let categories = [];

// ---------- 工具函数 ----------
const memoryStore = {};
function storageGet(key) {
    try { const v = localStorage.getItem(key); if (v !== null) return v; } catch (e) {}
    try { const v = sessionStorage.getItem(key); if (v !== null) return v; } catch (e) {}
    return memoryStore[key] !== undefined ? memoryStore[key] : null;
}
function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
    try { sessionStorage.setItem(key, value); } catch (e) {}
    memoryStore[key] = value;
}
function loadJSON(key, fallback) {
    const raw = storageGet(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
}
function saveJSON(key, val) { storageSet(key, JSON.stringify(val)); }

function bind(el, event, handler) {
    if (el) el.addEventListener(event, handler);
}

function lockScroll() {
    document.body.style.overflow = 'hidden';
}
function unlockScroll() {
    const hasOpenModal = document.querySelector('.bottom-sheet.show, .full-page.active');
    if (!hasOpenModal) {
        document.body.style.overflow = '';
    }
}

function updateNavVisibility() {
    const nav = document.getElementById('global-bottom-nav');
    if (!nav) return;
    const hasFullPage = document.querySelector('.full-page.active');
    if (hasFullPage) {
        nav.classList.add('nav-hidden');
    } else {
        nav.classList.remove('nav-hidden');
    }
}

function formatLimit(limit, { withUnit = true, status = '' } = {}) {
    status = status || '';
    if (status.includes('场内')) return '场内交易';
    if (status.includes('暂停申购') || status === '暂停' || status.includes('封闭')) return '暂停申购';
    if (status.includes('限大额')) {
        if (limit != null && limit <= 10000000) {
            if (limit >= 10000) return (limit / 10000) + (withUnit ? '万' : '');
            return limit + (withUnit ? '元' : '');
        }
        return '限大额';
    }
    if (limit == null || limit > 10000000) return '无限额';
    if (limit >= 10000) return (limit / 10000) + (withUnit ? '万' : '');
    return limit + (withUnit ? '元' : '');
}

function fmtPct(v) {
    if (v === null || v === undefined || isNaN(Number(v))) return '—';
    const n = Number(v);
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
}

function pctClass(v) {
    if (v === null || v === undefined || isNaN(Number(v))) return '';
    const n = Number(v);
    return n > 0 ? 'positive' : (n < 0 ? 'negative' : '');
}

function fmtNav(v) {
    if (v === null || v === undefined || isNaN(Number(v))) return '—';
    return Number(v).toFixed(4);
}

// ---------- 内置 Mock 数据兜底 ----------
const mockFundsFallback = [
    { 
        id: 1, name: '建信新兴市场混合(QDII) A/C', code: '018147', limit: 5000, 
        returnDaily: -1.12, returnYTD: 59.31, return1y: 89.10, 
        tab: 'us', pill: '全行业配置', scale: '19.76 亿', fee: '1.50% / 0.25%', risk: 'R4-中高风险', 
        holdings: [
            {n:'腾讯控股', r:9.1}, {n:'台积电', r:8.5}, {n:'三星电子', r:7.8}, {n:'美团', r:5.4}, {n:'京东', r:4.9},
            {n:'阿里巴巴', r:3.8}, {n:'拼多多', r:3.5}, {n:'网易', r:3.2}, {n:'百度', r:2.8}, {n:'小米集团', r:2.1}
        ],
        market: { labels: ['中国香港', '台湾', '韩国', '美国', '其他'], data: [45, 20, 15, 10, 10] },
        assets: { labels: ['股票', '银行存款', '其他'], data: [81.60, 19.76, 3.94] },
        perf: [
            {p: '近1月', r: -7.74, rank: '125'}, {p: '近3月', r: -5.41, rank: '81'},
            {p: '近6月', r: 38.64, rank: '8'}, {p: '近1年', r: 87.71, rank: '9'}, 
            {p: '今年以来', r: 59.31, rank: '5'}, {p: '成立以来', r: 127.50, rank: '—'},
            {p: '年化收益率', r: 198.36, rank: '—'}
        ],
        riskMetrics: { sharpe: '0.27', drawdown: '-33.19%', vol: '34.82%', alpha: '1.17%', beta: '1.27' },
        profile: { 
            codeInfo: '539002.OF / 539002', manager: '建信基金管理有限责任公司', 
            benchmark: 'MSCI Emerging Markets Index', target: '投资新兴市场国家股票',
            scope: '股票≥60%', fm: '李博涵、程星烨、房乐' 
        }
    }
];

// ---------- 数据仓储 (FundRepository) ----------
const FundRepository = {
    data: mockFundsFallback.slice(),
    _loaded: false,
    async load() {
        // 1. 优先尝试加载静态生成的 JSON（适用于 Cloudflare Pages / Vercel / GitHub Pages 等纯静态 CDN 托管）
        try {
            const cacheBuster = Math.floor(Date.now() / 300000); // 5分钟粒度缓存控制
            const res = await fetch(`data/funds.json?v=${cacheBuster}`, { headers: { 'Accept': 'application/json' } });
            if (res.ok) {
                const arr = await res.json();
                if (Array.isArray(arr) && arr.length) {
                    this.data = arr;
                    this._loaded = true;
                    console.log(`[FundRepository] 成功加载静态数据: ${arr.length} 只基金`);
                    return this.data;
                }
            }
        } catch (e) {
            console.log('[FundRepository] 静态数据不存在或加载失败，尝试请求动态 API:', e.message);
        }

        // 2. 回退尝试动态后端接口（适用于本地 Express 或常驻云服务器模式）
        try {
            const res = await fetch('/api/funds', { headers: { 'Accept': 'application/json' } });
            if (res.ok) {
                const arr = await res.json();
                if (Array.isArray(arr) && arr.length) {
                    this.data = arr;
                    this._loaded = true;
                    console.log(`[FundRepository] 成功从 API 加载数据: ${arr.length} 只基金`);
                    return this.data;
                }
            }
        } catch (e) {
            console.warn('[FundRepository] 动态 API 不可用，回退至内置演示数据:', e.message);
        }

        return this.data;
    },
    get loaded() { return this._loaded; },
    all() { return this.data; },
    byId(code) { return this.data.find(f => String(f.code) === String(code) || String(f.id) === String(code)) || null; },
    byFavorites(favCodes) {
        if (!favCodes || !favCodes.length) return [];
        return favCodes.map(code => this.byId(code)).filter(Boolean);
    },
    search(query) {
        if (!query || !query.trim()) return this.data;
        const q = query.trim().toLowerCase();
        return this.data.filter(f =>
            (f.name && f.name.toLowerCase().includes(q)) ||
            (f.code && f.code.toLowerCase().includes(q)) ||
            (f.trackingIndex && f.trackingIndex.toLowerCase().includes(q)) ||
            (f.holdings && f.holdings.some(h => h.n && h.n.toLowerCase().includes(q)))
        );
    }
};

// ---------- 全局状态 ----------
let activePage = 'home';
let activeTab = 'us';
let activePill = '全部';
let searchQuery = '';
let currentMetricIdx = 0;
const metrics = [
    { key: 'return1y', label: '近1年' },
    { key: 'returnDaily', label: '日涨跌' },
    { key: 'returnYTD', label: '今年以来' }
];

let sortCol = metrics[0].key;
let sortDesc = true;
let currentFund = null;
let charts = {};

let favoriteFundIds = loadJSON(STORAGE_KEYS.fav, []).map(String);
let searchHistory = loadJSON(STORAGE_KEYS.history, []);
let fundFootprints = loadJSON(STORAGE_KEYS.footprints, []);
let weightMode = loadJSON(STORAGE_KEYS.weightMode, 'equal');
let customAmounts = loadJSON(STORAGE_KEYS.customAmounts, {});
let compareMode = false;
let compareIds = [];

// ---------- DOM 元素 ----------
let elTabContainer, elPillContainer, elPillWrap, elFundList, elFavFundList, elSpinner;
let elSearchInput, elSearchClear, elSortLimit, elSortReturn, elMetricLabel;
let elBtnPenetrate, elBtnCompare, elBtnBuy, elBtnBuyFull;

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function saveSearchHistory(keyword) {
    keyword = (keyword || '').trim();
    if (!keyword) return;
    searchHistory = searchHistory.filter(k => k.toLowerCase() !== keyword.toLowerCase());
    searchHistory.unshift(keyword);
    if (searchHistory.length > 20) searchHistory.pop();
    saveJSON(STORAGE_KEYS.history, searchHistory);
}

function clearSearchHistory() {
    searchHistory = [];
    saveJSON(STORAGE_KEYS.history, searchHistory);
    renderSearchHistory();
}

function saveFootprint(fund) {
    if (!fund || !fund.code) return;
    const now = new Date();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const dateStr = `${now.getFullYear()}-${month}-${day} ${weekdays[now.getDay()]}`;

    fundFootprints = fundFootprints.filter(f => String(f.code) !== String(fund.code));
    fundFootprints.unshift({
        code: String(fund.code),
        name: fund.name,
        category: fund.category || fund.rawType || 'QDII',
        dateStr: dateStr,
        return1y: fund.return1y,
        returnDaily: fund.returnDaily
    });
    if (fundFootprints.length > 15) fundFootprints.pop();
    saveJSON(STORAGE_KEYS.footprints, fundFootprints);
}

function renderSearchHistory() {
    const block = document.getElementById('search-history-block');
    const chipsWrap = document.getElementById('search-history-chips');
    if (!block || !chipsWrap) return;
    if (searchHistory.length === 0) {
        block.style.display = 'none';
        return;
    }
    block.style.display = 'block';
    chipsWrap.innerHTML = searchHistory.map(kw =>
        `<span class="search-chip history-chip" data-kw="${escapeHTML(kw)}">${escapeHTML(kw)}</span>`
    ).join('');
}

function renderFootprints() {
    const block = document.getElementById('search-footprint-block');
    const listEl = document.getElementById('search-footprint-list');
    if (!block || !listEl) return;
    if (fundFootprints.length === 0) {
        block.style.display = 'none';
        return;
    }
    block.style.display = 'block';
    listEl.innerHTML = fundFootprints.map(f => {
        const ret = f.return1y != null ? f.return1y : f.returnDaily;
        const retStr = typeof ret === 'number' ? fmtPct(ret) : '—';
        const retClass = typeof ret === 'number' ? pctClass(ret) : '';
        return `
            <div class="footprint-card" data-code="${f.code}">
                <div class="footprint-left">
                    <div class="footprint-title">${escapeHTML(f.name)}</div>
                    <div class="footprint-meta">
                        <span>${f.code}</span>
                        <span>${escapeHTML(f.category)}</span>
                        <span>${f.dateStr || ''}</span>
                    </div>
                </div>
                <div class="footprint-right">
                    <div class="footprint-return ${retClass}">${retStr}</div>
                    <div class="footprint-label">近1年涨跌幅</div>
                </div>
            </div>
        `;
    }).join('');
}

function renderFundItemHTML(f, metricIdx = 0, isCompare = false) {
    const metricKey = metrics[metricIdx].key;
    const returnVal = f[metricKey];
    const limitStr = formatLimit(f.limit, { status: f.purchaseStatus });
    const returnStr = fmtPct(returnVal);
    const returnBgClass = returnVal > 0 ? 'positive-bg' : (returnVal < 0 ? 'negative-bg' : '');
    const isFav = favoriteFundIds.includes(String(f.code));
    const isChecked = isCompare && compareIds.includes(String(f.code));
    const favSvg = `<svg width="18" height="18" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
    
    return `
    <div class="fund-item" data-code="${f.code}">
        <div class="fund-name-wrap">
            ${isCompare ? `<input type="checkbox" class="fund-checkbox" ${isChecked ? 'checked' : ''} style="margin-right:8px; pointer-events:none;">` : `<button class="fav-btn ${isFav ? 'active' : ''}" data-code="${f.code}" aria-label="收藏">${favSvg}</button>`}
            <div class="open-detail-trigger" data-code="${f.code}">
                <span class="f-name">${escapeHTML(f.name)}</span>
                <span class="f-code">${f.code}</span>
            </div>
        </div>
        <div class="f-limit open-detail-trigger" data-code="${f.code}">${limitStr}</div>
        <div class="open-detail-trigger" data-code="${f.code}" style="text-align:right;"><span class="f-return ${returnBgClass}">${returnStr}</span></div>
    </div>
    `;
}

function openSearchPage() {
    const page = document.getElementById('search-page');
    if (!page) return;
    lockScroll();
    page.classList.remove('closing');
    page.classList.add('active');
    
    // 每次打开搜索页面均重置为全新的空白搜索态
    const input = document.getElementById('global-search-input');
    if (input) {
        input.value = '';
    }
    if (elSearchInput) {
        elSearchInput.value = '';
    }
    executeGlobalSearch(''); // 重置为默认推荐/历史/足迹视图

    updateNavVisibility();

    if (input) {
        setTimeout(() => {
            input.focus();
        }, 80);
    }
}

function closeSearchPage() {
    const page = document.getElementById('search-page');
    if (!page) return;
    page.classList.add('closing');
    page.classList.remove('active');

    // 退出时清空搜索框
    const input = document.getElementById('global-search-input');
    if (input) {
        input.value = '';
        input.blur();
    }
    if (elSearchInput) {
        elSearchInput.value = '';
        elSearchInput.blur();
    }
    executeGlobalSearch('');

    setTimeout(() => {
        page.classList.remove('closing');
        unlockScroll();
        updateNavVisibility();
    }, 260);
}

function executeGlobalSearch(query) {
    const defaultView = document.getElementById('search-default-view');
    const resultsView = document.getElementById('search-results-view');
    const summaryEl = document.getElementById('search-count-banner');
    const listEl = document.getElementById('global-search-results-list');
    const clearBtn = document.getElementById('global-search-clear');
    const confirmBtn = document.getElementById('search-confirm-btn');

    const q = (query || '').trim();
    if (!q) {
        if (defaultView) defaultView.style.display = 'block';
        if (resultsView) resultsView.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        if (confirmBtn) confirmBtn.textContent = '取消';
        renderSearchHistory();
        renderFootprints();
        return;
    }

    if (defaultView) defaultView.style.display = 'none';
    if (resultsView) resultsView.style.display = 'block';
    if (clearBtn) clearBtn.style.display = 'flex';
    if (confirmBtn) confirmBtn.textContent = '搜索';

    // 全局搜索：遍历全部基金，不限制 activeTab / activePill！
    const allFunds = FundRepository.all();
    const lowerQ = q.toLowerCase();

    const matched = allFunds.filter(f => {
        if (f.name && f.name.toLowerCase().includes(lowerQ)) return true;
        if (f.code && f.code.toLowerCase().includes(lowerQ)) return true;
        if (f.trackingIndex && f.trackingIndex.toLowerCase().includes(lowerQ)) return true;
        if (f.manager && f.manager.toLowerCase().includes(lowerQ)) return true;
        if (f.fm && f.fm.toLowerCase().includes(lowerQ)) return true;
        if (f.rawType && f.rawType.toLowerCase().includes(lowerQ)) return true;
        if (f.category && f.category.toLowerCase().includes(lowerQ)) return true;
        if (f.holdings && f.holdings.some(h => h.n && h.n.toLowerCase().includes(lowerQ))) return true;
        if (f.industry && f.industry.labels && f.industry.labels.some(l => l.toLowerCase().includes(lowerQ))) return true;
        return false;
    });

    if (summaryEl) summaryEl.textContent = `共找到 ${matched.length} 只相关基金`;

    if (listEl) {
        if (matched.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon" style="font-size:24px; margin-bottom:8px;">🔍</div>
                    <p style="font-weight:600; color:var(--text-primary);">未找到与 “${escapeHTML(q)}” 相关的基金</p>
                    <p style="font-size:12px; color:var(--text-tertiary); margin-top:6px;">建议尝试搜索基金代码、指数名称（如标普500、纳指）、重仓股或基金经理</p>
                </div>
            `;
        } else {
            listEl.innerHTML = matched.map(f => renderFundItemHTML(f, currentMetricIdx)).join('');
        }
    }
}

// ---------- 应用初始化 ----------
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

async function init() {
    elTabContainer = document.getElementById('tab-container');
    elPillContainer = document.getElementById('pill-container');
    elPillWrap = document.getElementById('pill-scroll-wrap');
    elFundList = document.getElementById('fund-list');
    elFavFundList = document.getElementById('fav-fund-list');
    elSpinner = document.getElementById('loading-spinner');
    elSearchInput = document.getElementById('search-input');
    elSearchClear = document.getElementById('search-clear');
    elSortLimit = document.getElementById('sort-limit');
    elSortReturn = document.getElementById('sort-return');
    elMetricLabel = document.getElementById('metric-label');
    elBtnPenetrate = document.getElementById('btn-penetrate');
    elBtnCompare = document.getElementById('btn-compare');
    elBtnBuy = document.getElementById('btn-buy');
    elBtnBuyFull = document.getElementById('btn-buy-full');

    if (elSpinner) elSpinner.style.display = 'block';
    await FundRepository.load();

    favoriteFundIds = favoriteFundIds.filter(c => FundRepository.data.some(f => String(f.code) === c || String(f.id) === c));

    categories = buildCategories(FundRepository.all());
    if (categories.length > 0 && !categories.some(c => c.id === activeTab)) {
        activeTab = categories[0].id;
    }

    renderTabs();
    renderPills();
    renderFundList();
    renderFavoritesList();
    bindEvents();
    initBottomSheetDrag('bottom-sheet', 'bottom-sheet-container', 'sheet-overlay', closeSheet);
    initBottomSheetDrag('penetrate-sheet', 'penetrate-sheet-container', 'penetrate-overlay', closePenetrateSheet);
    updateSortUI();
    updateFavActionBar();
}

// ---------- 渲染: 一级 Tab / 二级 Pill ----------
function renderTabs() {
    if (!elTabContainer) return;
    elTabContainer.innerHTML = categories.map(cat =>
        `<button class="tab-btn ${cat.id === activeTab ? 'active' : ''}" data-tab="${cat.id}">${cat.name}</button>`
    ).join('');
}

function renderPills() {
    const cat = categories.find(c => c.id === activeTab);
    const wrap = elPillWrap || document.getElementById('pill-scroll-wrap');
    if (!cat || cat.pills.length <= 1) {
        if (elPillContainer) elPillContainer.innerHTML = '';
        if (wrap) wrap.style.display = 'none';
        return;
    }
    if (wrap) wrap.style.display = 'block';
    if (elPillContainer) {
        elPillContainer.innerHTML = cat.pills.map(p =>
            `<button class="pill-btn ${p === activePill ? 'active' : ''}" data-pill="${p}">${p}</button>`
        ).join('');
    }
}

// ---------- 渲染: 主列表 (极速响应，零动画阻塞) ----------
function renderFundList() {
    if (!elFundList) return;
    if (elSpinner) elSpinner.style.display = 'none';

    let filtered = FundRepository.all().filter(f => f.tab === activeTab);
    if (activePill !== '全部') {
        filtered = filtered.filter(f => f.pill === activePill);
    }

    function getEffectiveLimit(f) {
        const status = f.purchaseStatus || '';
        if (status.includes('暂停申购') || status === '暂停' || status.includes('封闭')) return -2;
        if (status.includes('场内')) return -1;
        if (f.limit === null || f.limit === undefined || f.limit > 10000000) return Infinity;
        return Number(f.limit);
    }

    filtered.sort((a, b) => {
        if (sortCol === 'limit') {
            const valA = getEffectiveLimit(a);
            const valB = getEffectiveLimit(b);
            if (valA < 0 && valB >= 0) return 1;
            if (valB < 0 && valA >= 0) return -1;
            return sortDesc ? (valB - valA) : (valA - valB);
        }
        const metricKey = metrics[currentMetricIdx].key;
        const valA = a[metricKey] != null ? Number(a[metricKey]) : -999999;
        const valB = b[metricKey] != null ? Number(b[metricKey]) : -999999;
        return sortDesc ? (valB - valA) : (valA - valB);
    });

    if (filtered.length === 0) {
        elFundList.innerHTML = `
            <div class="empty-state">
                <p>未找到符合条件的基金</p>
            </div>
        `;
        return;
    }

    elFundList.innerHTML = filtered.map(f => renderFundItemHTML(f, currentMetricIdx)).join('');
}

function updateSortUI() {
    if (elSortLimit) {
        const icon = elSortLimit.querySelector('.sort-icon-container') || elSortLimit.querySelector('.sort-icon');
        if (icon) {
            icon.textContent = sortCol === 'limit' ? (sortDesc ? '↓' : '↑') : '↕';
            icon.className = `sort-icon-container ${sortCol === 'limit' ? 'active' : ''}`;
        }
    }
    if (elSortReturn) {
        const icon = elSortReturn.querySelector('.sort-icon-container') || elSortReturn.querySelector('.sort-icon');
        if (icon) {
            icon.textContent = sortCol !== 'limit' ? (sortDesc ? '↓' : '↑') : '↕';
            icon.className = `sort-icon-container ${sortCol !== 'limit' ? 'active' : ''}`;
        }
    }
}

// ---------- 事件绑定 ----------
function bindEvents() {
    bind(elTabContainer, 'click', e => {
        const btn = e.target.closest('.tab-btn');
        if (btn) {
            activeTab = btn.dataset.tab;
            activePill = '全部';
            renderTabs();
            renderPills();
            renderFundList();
        }
    });

    bind(elPillContainer, 'click', e => {
        const btn = e.target.closest('.pill-btn');
        if (btn) {
            activePill = btn.dataset.pill;
            renderPills();
            renderFundList();
        }
    });

    bind(elSortLimit, 'click', () => {
        if (sortCol === 'limit') sortDesc = !sortDesc;
        else { sortCol = 'limit'; sortDesc = true; }
        updateSortUI();
        renderFundList();
    });

    bind(elSortReturn, 'click', e => {
        if (e.target.id === 'metric-label' || e.target.classList.contains('metric-switch')) {
            currentMetricIdx = (currentMetricIdx + 1) % metrics.length;
            if (elMetricLabel) elMetricLabel.textContent = metrics[currentMetricIdx].label;
            sortCol = metrics[currentMetricIdx].key;
            sortDesc = true;
        } else {
            if (sortCol !== 'limit') sortDesc = !sortDesc;
            else { sortCol = metrics[currentMetricIdx].key; sortDesc = true; }
        }
        updateSortUI();
        renderFundList();
    });

    const handleOpenSearch = (e) => {
        e.preventDefault();
        openSearchPage();
    };
    bind(elSearchInput, 'focus', handleOpenSearch);
    bind(elSearchInput, 'click', handleOpenSearch);
    const searchBarWrap = document.querySelector('.search-bar');
    if (searchBarWrap) bind(searchBarWrap, 'click', handleOpenSearch);

    bind(document.getElementById('search-back-btn'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeSearchPage();
    });

    const globalSearchInput = document.getElementById('global-search-input');
    const globalSearchClear = document.getElementById('global-search-clear');
    const searchConfirmBtn = document.getElementById('search-confirm-btn');

    if (globalSearchInput) {
        bind(globalSearchInput, 'input', e => {
            executeGlobalSearch(e.target.value);
        });
        bind(globalSearchInput, 'keydown', e => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveSearchHistory(globalSearchInput.value);
                executeGlobalSearch(globalSearchInput.value);
            }
        });
    }

    if (globalSearchClear) {
        bind(globalSearchClear, 'click', e => {
            e.preventDefault();
            e.stopPropagation();
            if (globalSearchInput) {
                globalSearchInput.value = '';
                globalSearchInput.focus();
            }
            executeGlobalSearch('');
        });
    }

    if (searchConfirmBtn) {
        bind(searchConfirmBtn, 'click', e => {
            e.preventDefault();
            e.stopPropagation();
            const val = globalSearchInput ? globalSearchInput.value.trim() : '';
            if (val) {
                saveSearchHistory(val);
                executeGlobalSearch(val);
            } else {
                closeSearchPage();
            }
        });
    }

    // 热门搜索推荐点击
    const hotChipsWrap = document.getElementById('hot-search-chips');
    if (hotChipsWrap) {
        bind(hotChipsWrap, 'click', e => {
            const chip = e.target.closest('.search-chip');
            if (!chip) return;
            const kw = chip.getAttribute('data-kw');
            if (kw) {
                if (globalSearchInput) globalSearchInput.value = kw;
                saveSearchHistory(kw);
                executeGlobalSearch(kw);
            }
        });
    }

    // 搜索历史点击
    const historyChipsWrap = document.getElementById('search-history-chips');
    if (historyChipsWrap) {
        bind(historyChipsWrap, 'click', e => {
            const chip = e.target.closest('.search-chip');
            if (!chip) return;
            const kw = chip.getAttribute('data-kw');
            if (kw) {
                if (globalSearchInput) globalSearchInput.value = kw;
                saveSearchHistory(kw);
                executeGlobalSearch(kw);
            }
        });
    }

    // 清空历史按钮
    bind(document.getElementById('btn-clear-history'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        clearSearchHistory();
    });

    // 基金足迹点击
    const footprintList = document.getElementById('search-footprint-list');
    if (footprintList) {
        bind(footprintList, 'click', e => {
            const card = e.target.closest('.footprint-card');
            if (card && card.dataset.code) {
                openSheet(card.dataset.code);
            }
        });
    }

    // 全局搜索结果列表点击 (包含收藏与详情展开)
    const globalResultsList = document.getElementById('global-search-results-list');
    if (globalResultsList) {
        bind(globalResultsList, 'click', e => {
            const favBtn = e.target.closest('.fav-btn');
            if (favBtn) {
                e.preventDefault();
                e.stopPropagation();
                toggleFavorite(favBtn.dataset.code, favBtn);
                return;
            }
            const trigger = e.target.closest('.open-detail-trigger') || e.target.closest('.fund-item');
            if (trigger && trigger.dataset.code) {
                if (globalSearchInput && globalSearchInput.value.trim()) {
                    saveSearchHistory(globalSearchInput.value.trim());
                }
                openSheet(trigger.dataset.code);
            }
        });
    }

    // 基金列表点击：星标精准捕获并阻止穿透到详情
    bind(elFundList, 'click', e => {
        const favBtn = e.target.closest('.fav-btn');
        if (favBtn) {
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(favBtn.dataset.code, favBtn);
            return;
        }
        const trigger = e.target.closest('.open-detail-trigger') || e.target.closest('.fund-item');
        if (trigger && trigger.dataset.code) {
            openSheet(trigger.dataset.code);
        }
    });

    bind(elFavFundList, 'click', e => {
        const favBtn = e.target.closest('.fav-btn');
        if (favBtn) {
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite(favBtn.dataset.code, favBtn);
            return;
        }
        if (compareMode) {
            const item = e.target.closest('.fund-item');
            if (item && item.dataset.code) {
                toggleCompareId(item.dataset.code);
                return;
            }
        }
        const trigger = e.target.closest('.open-detail-trigger') || e.target.closest('.fund-item');
        if (trigger && trigger.dataset.code) {
            openSheet(trigger.dataset.code);
        }
    });

    bind(document.getElementById('nav-home'), 'click', () => switchPage('home'));
    bind(document.getElementById('nav-favorites'), 'click', () => switchPage('favorites'));

    bind(elBtnPenetrate, 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (compareMode) exitCompareMode();
        else openPenetrateSheet();
    });
    bind(document.getElementById('close-penetrate'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        closePenetrateSheet();
    });
    bind(document.getElementById('penetrate-overlay'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        closePenetrateSheet();
    });
    bind(document.getElementById('penetrate-sheet-container'), 'click', e => {
        e.stopPropagation();
    });

    document.querySelectorAll('input[name="weight-mode"]').forEach(radio => {
        bind(radio, 'change', () => {
            const customWrap = document.getElementById('penetrate-custom-wrap');
            if (customWrap) customWrap.style.display = radio.value === 'custom' ? 'block' : 'none';
        });
    });

    bind(document.getElementById('penetrate-custom-list'), 'input', e => {
        if (e.target.classList.contains('penetrate-amount-input')) {
            customAmounts[e.target.dataset.code] = parseFloat(e.target.value) || 0;
            saveJSON(STORAGE_KEYS.customAmounts, customAmounts);
        }
    });
    bind(document.getElementById('btn-run-penetrate'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        runPenetrate();
    });

    bind(elBtnCompare, 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (compareMode) generateCompare();
        else enterCompareMode();
    });
    bind(document.getElementById('back-from-compare'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeComparePage();
    });
    bind(document.getElementById('back-from-report'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        const page = document.getElementById('lookthrough-report-page');
        if (page) {
            page.classList.add('closing');
            page.classList.remove('active');
            setTimeout(() => {
                page.classList.remove('closing');
                unlockScroll();
                updateNavVisibility();
            }, 260);
        }
    });

    bind(document.getElementById('close-sheet'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
    });
    bind(document.getElementById('sheet-overlay'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeSheet();
    });
    bind(document.getElementById('bottom-sheet-container'), 'click', e => {
        e.stopPropagation();
    });

    // 查看深度研报按钮：一键平滑开启 Level 2 深度研报
    bind(document.getElementById('btn-detailed-info'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        openFullDetail();
    });

    // 3-tab 持仓分布切换 (Level 1 Bottom Sheet)
    const sheetDistTabs = document.getElementById('sheet-dist-tabs');
    if (sheetDistTabs) {
        bind(sheetDistTabs, 'click', e => {
            const btn = e.target.closest('.dist-tab-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            sheetDistActiveType = btn.getAttribute('data-type') || 'assets';
            renderDistributionComponent('sheet', currentFund, sheetDistActiveType);
        });
    }

    // 3-tab 持仓分布切换 (Level 2 Full Detail Page)
    const fullDistTabs = document.getElementById('full-dist-tabs');
    if (fullDistTabs) {
        bind(fullDistTabs, 'click', e => {
            const btn = e.target.closest('.dist-tab-btn');
            if (!btn) return;
            e.preventDefault();
            e.stopPropagation();
            fullDistActiveType = btn.getAttribute('data-type') || 'assets';
            renderDistributionComponent('full', currentFund, fullDistActiveType);
        });
    }

    bind(document.getElementById('back-from-detail'), 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeFullDetail();
    });
    bind(elBtnBuy, 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        jumpToBroker(elBtnBuy);
    });
    bind(elBtnBuyFull, 'click', e => {
        e.preventDefault();
        e.stopPropagation();
        jumpToBroker(elBtnBuyFull);
    });
}

// ---------- 收藏管理 ----------
function toggleFavorite(id, btnEl) {
    id = String(id);
    const idx = favoriteFundIds.indexOf(id);
    const isNowFav = idx === -1;
    if (!isNowFav) {
        favoriteFundIds.splice(idx, 1);
        const cIdx = compareIds.indexOf(id);
        if (cIdx > -1) compareIds.splice(cIdx, 1);
    } else {
        favoriteFundIds.push(id);
    }
    saveJSON(STORAGE_KEYS.fav, favoriteFundIds);

    if (btnEl) {
        if (isNowFav) btnEl.classList.add('active');
        else btnEl.classList.remove('active');
    }

    if (activePage === 'favorites') renderFavoritesList();
    updateFavActionBar();
}

function switchPage(page) {
    activePage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    if (page === 'home') {
        const p = document.getElementById('main-page');
        const n = document.getElementById('nav-home');
        if (p) p.classList.add('active');
        if (n) n.classList.add('active');
        renderFundList();
    } else if (page === 'favorites') {
        const p = document.getElementById('favorites-page');
        const n = document.getElementById('nav-favorites');
        if (p) p.classList.add('active');
        if (n) n.classList.add('active');
        renderFavoritesList();
    }
    updateNavVisibility();
}

function renderFavoritesList() {
    if (!elFavFundList) return;
    const favFunds = FundRepository.byFavorites(favoriteFundIds);
    if (favFunds.length === 0) {
        elFavFundList.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                <p>暂无收藏的基金，去主页点亮星标吧</p>
            </div>
        `;
        return;
    }

    const weights = calcFavWeights(favFunds, weightMode);

    elFavFundList.innerHTML = favFunds.map(f => {
        const isCompareSelected = compareIds.includes(f.code);
        const favSvg = `<svg width="18" height="18" viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
        const compareCheckbox = compareMode ? `
            <div class="compare-checkbox ${isCompareSelected ? 'checked' : ''}">
                ${isCompareSelected ? '✓' : ''}
            </div>
        ` : '';

        const weight = weights[f.code] != null ? weights[f.code] : (1 / favFunds.length);
        const weightPct = (weight * 100).toFixed(1) + '%';

        return `
        <div class="fund-item ${compareMode && isCompareSelected ? 'compare-selected' : ''}" data-code="${f.code}" style="grid-template-columns: 1fr 100px;">
            <div class="fund-name-wrap">
                ${compareMode ? compareCheckbox : `<button class="fav-btn active" data-code="${f.code}" aria-label="取消收藏">${favSvg}</button>`}
                <div class="open-detail-trigger" data-code="${f.code}">
                    <span class="f-name">${f.name}</span>
                    <span class="f-code">${f.code}</span>
                </div>
            </div>
            <div class="open-detail-trigger" data-code="${f.code}" style="text-align:right;">
                <span class="f-weight-badge">${weightPct}</span>
            </div>
        </div>
        `;
    }).join('');
}

function calcFavWeights(favFunds, mode) {
    const weights = {};
    if (!favFunds.length) return weights;

    if (mode === 'equal') {
        const w = 1 / favFunds.length;
        favFunds.forEach(f => { weights[f.code] = w; });
    } else if (mode === 'limit') {
        let totalLim = 0;
        favFunds.forEach(f => {
            const l = (f.limit != null && f.limit > 0 && f.limit <= 10000000) ? f.limit : 5000;
            totalLim += l;
        });
        favFunds.forEach(f => {
            const l = (f.limit != null && f.limit > 0 && f.limit <= 10000000) ? f.limit : 5000;
            weights[f.code] = totalLim > 0 ? l / totalLim : 1 / favFunds.length;
        });
    } else if (mode === 'custom') {
        let totalAmt = 0;
        favFunds.forEach(f => {
            const a = customAmounts[f.code] || 10000;
            totalAmt += a;
        });
        favFunds.forEach(f => {
            const a = customAmounts[f.code] || 10000;
            weights[f.code] = totalAmt > 0 ? a / totalAmt : 1 / favFunds.length;
        });
    }
    return weights;
}

function updateFavActionBar() {
    if (!elBtnPenetrate || !elBtnCompare) return;
    const count = favoriteFundIds.length;
    if (count === 0) {
        elBtnPenetrate.disabled = true;
        elBtnCompare.disabled = true;
        elBtnPenetrate.style.opacity = '0.4';
        elBtnCompare.style.opacity = '0.4';
    } else {
        elBtnPenetrate.disabled = false;
        elBtnCompare.disabled = false;
        elBtnPenetrate.style.opacity = '1';
        elBtnCompare.style.opacity = '1';
    }
}

// ---------- 穿透方式面板 ----------
function openPenetrateSheet() {
    const favFunds = FundRepository.byFavorites(favoriteFundIds);
    if (favFunds.length === 0) {
        alert('请先在主页收藏至少 1 只基金！');
        return;
    }
    const radio = document.querySelector(`input[name="weight-mode"][value="${weightMode}"]`);
    if (radio) radio.checked = true;

    const customWrap = document.getElementById('penetrate-custom-wrap');
    if (customWrap) customWrap.style.display = weightMode === 'custom' ? 'block' : 'none';

    const listEl = document.getElementById('penetrate-custom-list');
    if (listEl) {
        listEl.innerHTML = favFunds.map(f => {
            const val = customAmounts[f.code] || 10000;
            return `
            <div class="custom-amount-item">
                <span class="custom-fund-name">${f.name}</span>
                <div class="amount-input-wrap">
                    <input type="number" class="penetrate-amount-input" data-code="${f.code}" value="${val}" min="100" step="1000">
                    <span class="amount-unit">元</span>
                </div>
            </div>
            `;
        }).join('');
    }

    lockScroll();
    const sheet = document.getElementById('penetrate-sheet');
    if (sheet) sheet.classList.add('show');
}

function closePenetrateSheet() {
    const sheet = document.getElementById('penetrate-sheet');
    const container = document.getElementById('penetrate-sheet-container');
    const overlay = document.getElementById('penetrate-overlay');
    if (!sheet) return;

    if (container) {
        container.style.transition = 'transform 0.26s var(--ease-spring-down)';
        container.style.transform = 'translate3d(0, 100%, 0)';
    }
    if (overlay) {
        overlay.style.transition = 'opacity 0.22s ease-out';
        overlay.style.opacity = '0';
    }

    setTimeout(() => {
        sheet.classList.remove('show');
        if (container) {
            container.style.transform = '';
            container.style.transition = '';
        }
        if (overlay) {
            overlay.style.opacity = '';
            overlay.style.transition = '';
        }
        unlockScroll();
    }, 260);
}

function runPenetrate() {
    const selected = document.querySelector('input[name="weight-mode"]:checked');
    if (!selected) return;
    weightMode = selected.value;
    saveJSON(STORAGE_KEYS.weightMode, weightMode);
    if (weightMode === 'custom') {
        FundRepository.byFavorites(favoriteFundIds).forEach(f => {
            if (!customAmounts[f.code] || customAmounts[f.code] <= 0) customAmounts[f.code] = 10000;
        });
        saveJSON(STORAGE_KEYS.customAmounts, customAmounts);
    }
    closePenetrateSheet();
    renderFavoritesList();
    generateLookthroughReport();
}

// ---------- 对比模式 ----------
function enterCompareMode() {
    compareMode = true;
    compareIds = [...favoriteFundIds];
    if (elBtnPenetrate) elBtnPenetrate.textContent = '取消对比';
    if (elBtnCompare) elBtnCompare.textContent = `开始对比 (${compareIds.length})`;
    renderFavoritesList();
}

function exitCompareMode() {
    compareMode = false;
    compareIds = [];
    if (elBtnPenetrate) elBtnPenetrate.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>穿透`;
    if (elBtnCompare) elBtnCompare.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;"><rect x="3" y="3" width="7" height="18" rx="2"></rect><rect x="14" y="8" width="7" height="13" rx="2"></rect><line x1="6.5" y1="7" x2="6.5" y2="7.01"></line><line x1="17.5" y1="12" x2="17.5" y2="12.01"></line></svg>对比`;
    renderFavoritesList();
}

function toggleCompareId(code) {
    const idx = compareIds.indexOf(code);
    if (idx > -1) compareIds.splice(idx, 1);
    else compareIds.push(code);
    if (elBtnCompare) elBtnCompare.textContent = `开始对比 (${compareIds.length})`;
    renderFavoritesList();
}

function generateCompare() {
    const funds = FundRepository.byFavorites(compareIds);
    if (funds.length < 2) {
        alert('请至少选择 2 只基金进行对比');
        return;
    }

    const thead = document.getElementById('compare-thead');
    const tbody = document.getElementById('compare-tbody');

    if (thead) thead.innerHTML = `<tr><th class="compare-row-lbl">指标</th>${funds.map(f => `<th><div class="compare-fund-header-name" title="${escapeHTML(f.name)}">${escapeHTML(f.name)}</div></th>`).join('')}</tr>`;

    const rows = [
        { label: '基金代码', fn: f => f.code },
        { label: '申购状态', fn: f => f.purchaseStatus || '—' },
        { label: '单日限额', fn: f => formatLimit(f.limit, { withUnit: true, status: f.purchaseStatus }) },
        { label: '单位净值', fn: f => fmtNav(f.nav) },
        { label: '近1年回报', fn: f => `<span class="${pctClass(f.return1y)}">${fmtPct(f.return1y)}</span>` },
        { label: '今年以来', fn: f => `<span class="${pctClass(f.returnYTD)}">${fmtPct(f.returnYTD)}</span>` },
        { label: '日涨跌幅', fn: f => `<span class="${pctClass(f.returnDaily)}">${fmtPct(f.returnDaily)}</span>` },
        { label: '综合管理费率', fn: f => f.fee || '—' },
        { label: '夏普比率', fn: f => f.riskMetrics?.sharpe || '—' },
        { label: '最大回撤', fn: f => `<span class="negative">${f.riskMetrics?.drawdown || '—'}</span>` }
    ];

    if (tbody) {
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td class="compare-row-lbl">${r.label}</td>
                ${funds.map(f => `<td>${r.fn(f)}</td>`).join('')}
            </tr>
        `).join('');
    }

    const page = document.getElementById('compare-page');
    const countEl = document.getElementById('compare-fund-count');
    if (countEl) countEl.textContent = funds.length;
    if (page) {
        lockScroll();
        page.classList.remove('closing');
        page.classList.add('active');
        const content = page.querySelector('.detail-content');
        if (content) content.scrollTop = 0;
        updateNavVisibility();

        // 延迟 150ms 满帧平稳滑入后再渲染多基金对比柱状图
        setTimeout(() => {
            renderCompareCharts(funds);
        }, 150);
    }
}

function renderCompareCharts(funds) {
    if (!funds || funds.length === 0) return;

    // 1. 地区分布对比 (Region Comparison)
    const regionTotals = {};
    funds.forEach(f => {
        const labels = (f.market?.labels || []).map(cleanRegionName);
        const data = f.market?.data || [];
        labels.forEach((lbl, i) => {
            const val = Number(data[i] || 0);
            if (val > 0) {
                regionTotals[lbl] = (regionTotals[lbl] || 0) + val;
            }
        });
    });

    const sortedRegions = Object.keys(regionTotals).sort((a, b) => regionTotals[b] - regionTotals[a]);
    const topRegions = sortedRegions.length > 0 ? sortedRegions.slice(0, 6) : ['暂无地区披露'];

    const regionDatasets = funds.map((f, i) => {
        const fLabels = (f.market?.labels || []).map(cleanRegionName);
        const fData = f.market?.data || [];
        return {
            label: f.name.length > 7 ? f.name.slice(0, 7) + '...' : f.name,
            data: topRegions.map(r => {
                const idx = fLabels.indexOf(r);
                return idx > -1 ? Number(fData[idx] || 0) : 0;
            }),
            backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
            borderRadius: 4,
            maxBarThickness: 28
        };
    });
    renderMultiBarChart('compareRegionChart', topRegions, regionDatasets, false);

    // 2. 行业分布对比 (Industry Comparison)
    const industryTotals = {};
    funds.forEach(f => {
        const labels = f.industry?.labels || [];
        const data = f.industry?.data || [];
        labels.forEach((lbl, i) => {
            const val = Number(data[i] || 0);
            if (val > 0) {
                industryTotals[lbl] = (industryTotals[lbl] || 0) + val;
            }
        });
    });

    const sortedIndustries = Object.keys(industryTotals).sort((a, b) => industryTotals[b] - industryTotals[a]);
    const topIndustries = sortedIndustries.length > 0 ? sortedIndustries.slice(0, 7) : ['暂无行业披露'];

    const industryDatasets = funds.map((f, i) => {
        const fLabels = f.industry?.labels || [];
        const fData = f.industry?.data || [];
        return {
            label: f.name.length > 7 ? f.name.slice(0, 7) + '...' : f.name,
            data: topIndustries.map(ind => {
                const idx = fLabels.indexOf(ind);
                return idx > -1 ? Number(fData[idx] || 0) : 0;
            }),
            backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
            borderRadius: 4,
            maxBarThickness: 18
        };
    });
    renderMultiBarChart('compareIndustryChart', topIndustries, industryDatasets, true);
}

function renderMultiBarChart(canvasId, labels, datasets, isHorizontal = false) {
    if (typeof Chart === 'undefined') return;
    if (charts[canvasId]) {
        try { charts[canvasId].destroy(); } catch (e) {}
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    try {
        const ctx = (canvas.getContext && canvas.getContext('2d')) ? canvas.getContext('2d') : canvas;
        charts[canvasId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: isHorizontal ? 'y' : 'x',
                animation: { duration: 300, easing: 'easeOutQuart' },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            boxWidth: 10,
                            boxHeight: 10,
                            font: { size: 12, family: FONT_FAMILY }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}%`
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: isHorizontal, color: 'rgba(0,0,0,0.04)' },
                        ticks: isHorizontal ? { callback: v => v + '%' } : { font: { size: 11, family: FONT_FAMILY } }
                    },
                    y: {
                        grid: { display: !isHorizontal, color: 'rgba(0,0,0,0.04)' },
                        ticks: !isHorizontal ? { callback: v => v + '%' } : { font: { size: 11, family: FONT_FAMILY } }
                    }
                }
            }
        });
    } catch (e) {
        console.warn('[renderMultiBarChart] 图表初始化跳过:', e.message);
    }
}

function closeComparePage() {
    const page = document.getElementById('compare-page');
    if (page) {
        page.classList.add('closing');
        page.classList.remove('active');
        setTimeout(() => {
            page.classList.remove('closing');
            exitCompareMode();
            unlockScroll();
            updateNavVisibility();
        }, 260);
    }
}

// ---------- 穿透报告 (Look-through) ----------
function generateLookthroughReport() {
    const favFunds = FundRepository.byFavorites(favoriteFundIds);
    if (favFunds.length === 0) {
        alert('请先在主页收藏基金！');
        return;
    }

    const weights = calcFavWeights(favFunds, weightMode);

    const aggAssets = {};
    const aggRegions = {};
    const aggIndustries = {};
    const aggHoldings = {};

    favFunds.forEach(f => {
        const fw = weights[f.code] || (1 / favFunds.length);

        if (f.assets && f.assets.labels) {
            f.assets.labels.forEach((lbl, i) => {
                const val = (f.assets.data[i] || 0) * fw;
                aggAssets[lbl] = (aggAssets[lbl] || 0) + val;
            });
        }
        if (f.market && f.market.labels) {
            f.market.labels.forEach((lbl, i) => {
                const cleanLbl = cleanRegionName(lbl);
                const val = (f.market.data[i] || 0) * fw;
                aggRegions[cleanLbl] = (aggRegions[cleanLbl] || 0) + val;
            });
        }
        if (f.industry && f.industry.labels) {
            f.industry.labels.forEach((lbl, i) => {
                const val = (f.industry.data[i] || 0) * fw;
                aggIndustries[lbl] = (aggIndustries[lbl] || 0) + val;
            });
        }
        if (f.holdings) {
            f.holdings.forEach(h => {
                const hw = (h.r || 0) * fw;
                aggHoldings[h.n] = (aggHoldings[h.n] || 0) + hw;
            });
        }
    });

    const sortedHoldings = Object.entries(aggHoldings)
        .map(([n, r]) => ({ n, r }))
        .sort((a, b) => b.r - a.r)
        .slice(0, 10);

    const holdingsTableEl = document.getElementById('report-holdings');
    if (holdingsTableEl) {
        holdingsTableEl.innerHTML = sortedHoldings.map(h => `
            <tr>
                <td style="font-weight:600;">${h.n}</td>
                <td style="text-align:right;"><strong style="color:var(--accent-blue);">${h.r.toFixed(2)}%</strong></td>
            </tr>
        `).join('');
    }

    const countEl = document.getElementById('report-fund-count');
    if (countEl) countEl.textContent = favFunds.length;

    const page = document.getElementById('lookthrough-report-page');
    if (page) {
        lockScroll();
        page.classList.remove('closing');
        page.classList.add('active');
        const content = page.querySelector('.detail-content');
        if (content) content.scrollTop = 0;
        updateNavVisibility();

        // 动画完全平稳后再绘制 Canvas 图表，杜绝掉帧
        setTimeout(() => {
            renderChart('reportAssetChart', Object.keys(aggAssets), Object.values(aggAssets), CHART_COLORS);
            renderChart('reportRegionChart', Object.keys(aggRegions), Object.values(aggRegions), CHART_COLORS);

            // 行业主线分布统一采用饼状图（环形图），按权重降序排序，取 Top 6 行业并归集其他
            const sortedIndustries = Object.entries(aggIndustries)
                .sort((a, b) => b[1] - a[1]);
            const topIndustries = sortedIndustries.slice(0, 6);
            const otherIndustriesSum = sortedIndustries.slice(6).reduce((acc, curr) => acc + curr[1], 0);
            if (otherIndustriesSum > 0) {
                topIndustries.push(['其他行业', otherIndustriesSum]);
            }
            const indLabels = topIndustries.map(item => item[0]);
            const indData = topIndustries.map(item => Number(item[1].toFixed(2)));

            renderChart('reportIndustryChart', indLabels, indData, CHART_COLORS, 'doughnut', false);
        }, 150);
    }
}

const DIST_COLORS = ['#FF6E76', '#5470C6', '#91CC75', '#FAC858', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4', '#EA7CCC'];

let sheetDistActiveType = 'assets';
let fullDistActiveType = 'assets';

function cleanRegionName(name) {
    if (!name) return '其他';
    return String(name).replace(/^大/, '').replace(/地区$/, '');
}

function renderDistributionComponent(prefix, fund, activeType = 'assets') {
    if (!fund) return;

    // 1. 设置 Tab 激活样式
    const tabsContainer = document.getElementById(`${prefix}-dist-tabs`);
    if (tabsContainer) {
        const btns = tabsContainer.querySelectorAll('.dist-tab-btn');
        btns.forEach(btn => {
            if (btn.getAttribute('data-type') === activeType) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // 2. 设置更新日期
    const asofEl = document.getElementById(`${prefix}-dist-asof`);
    if (asofEl) asofEl.textContent = fund.dataAsOf || fund.reportDate || '2026-06-30';

    // 3. 提取对应维度数据
    let rawLabels = [];
    let rawData = [];
    let centerLabel = '资产分布';
    let headerName = '资产名称';

    if (activeType === 'assets') {
        centerLabel = '资产分布';
        headerName = '资产名称';
        rawLabels = fund.assets?.labels || [];
        rawData = fund.assets?.data || [];
    } else if (activeType === 'region') {
        centerLabel = '地区分布';
        headerName = '地区名称';
        rawLabels = (fund.market?.labels || []).map(cleanRegionName);
        rawData = fund.market?.data || [];
    } else if (activeType === 'industry') {
        centerLabel = '行业分布';
        headerName = '行业名称';
        rawLabels = fund.industry?.labels || [];
        rawData = fund.industry?.data || [];
    }

    // 组合并按占比降序排列
    const combined = rawLabels.map((lbl, idx) => ({
        name: cleanRegionName(lbl),
        pct: Number(rawData[idx] != null ? rawData[idx] : 0)
    })).filter(x => x.pct > 0).sort((a, b) => b.pct - a.pct);

    const labels = combined.map(x => x.name);
    const data = combined.map(x => x.pct);
    const colors = labels.map((_, i) => DIST_COLORS[i % DIST_COLORS.length]);

    // 4. 设置甜甜圈中心文字
    const centerEl = document.getElementById(`${prefix}DistCenterText`);
    if (centerEl) centerEl.textContent = centerLabel;

    // 5. 渲染右侧图例 (清晰展示各成分占比，与左侧大甜甜圈互补)
    const legendEl = document.getElementById(`${prefix}DistLegend`);
    if (legendEl) {
        if (combined.length === 0) {
            legendEl.innerHTML = '<div style="font-size:13px; color:var(--text-tertiary);">暂无分布披露</div>';
        } else {
            legendEl.innerHTML = combined.map((item, i) => `
                <div class="dist-legend-item">
                    <div class="dist-legend-left">
                        <span class="dist-legend-dot" style="background:${colors[i]}"></span>
                        <span title="${escapeHTML(item.name)}">${escapeHTML(item.name)}:</span>
                    </div>
                    <strong class="dist-legend-pct">${item.pct.toFixed(2)}%</strong>
                </div>
            `).join('');
        }
    }

    // 6. 渲染大号甜甜圈 Donut Chart (省出下方重复空间，图表更大更清晰)
    const canvasId = `${prefix}DistCanvas`;
    if (charts[canvasId]) {
        try { charts[canvasId].destroy(); } catch (e) {}
    }
    const canvas = document.getElementById(canvasId);
    if (canvas && typeof Chart !== 'undefined') {
        try {
            const ctx = canvas.getContext ? canvas.getContext('2d') : null;
            if (ctx) {
                charts[canvasId] = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: labels.length ? labels : ['暂无'],
                        datasets: [{
                            data: data.length ? data : [100],
                            backgroundColor: colors.length ? colors : ['#E2E8F0'],
                            borderWidth: 2.5,
                            borderColor: '#FFFFFF'
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '66%',
                        animation: { duration: 250, easing: 'easeOutQuart' },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                callbacks: {
                                    label: (ctx) => ` ${ctx.label}: ${ctx.raw}%`
                                }
                            }
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('[renderDonut] 图表初始化跳过:', e.message);
        }
    }
}

// ---------- 详情: Level 1 Bottom Sheet ----------
function openSheet(id) {
    currentFund = FundRepository.byId(id);
    if (!currentFund) return;

    saveFootprint(currentFund);

    const setTxt = (elId, val) => {
        const el = document.getElementById(elId);
        if (el) el.textContent = val || '—';
    };

    setTxt('sheet-fund-name', currentFund.name);
    setTxt('sheet-fund-code', currentFund.code);
    setTxt('sheet-fund-risk', currentFund.risk);
    setTxt('sheet-purchase-status', currentFund.purchaseStatus);
    setTxt('sheet-limit-status', formatLimit(currentFund.limit, { withUnit: true, status: currentFund.purchaseStatus }));
    setTxt('sheet-data-asof', currentFund.dataAsOf);
    setTxt('sheet-fee-status', currentFund.fee);
    setTxt('sheet-nav-status', fmtNav(currentFund.nav));
    setTxt('sheet-accnav-status', fmtNav(currentFund.accNav));

    renderHoldingsList(currentFund.holdings || [], 'sheet-holdings');

    lockScroll();
    const sheet = document.getElementById('bottom-sheet');
    const container = document.getElementById('bottom-sheet-container');
    const overlay = document.getElementById('sheet-overlay');

    if (container) {
        container.style.transform = '';
        container.style.transition = '';
    }
    if (overlay) {
        overlay.style.opacity = '';
        overlay.style.transition = '';
    }
    if (sheet) {
        sheet.classList.add('show');
    }

    sheetDistActiveType = 'assets';
    // 延后绘制 Canvas，保证 CSS 弹性弹窗 100% 满帧滑入
    setTimeout(() => {
        renderDistributionComponent('sheet', currentFund, sheetDistActiveType);
    }, 150);
}

function closeSheet() {
    const sheet = document.getElementById('bottom-sheet');
    const container = document.getElementById('bottom-sheet-container');
    const overlay = document.getElementById('sheet-overlay');
    if (!sheet) return;

    if (container) {
        container.style.transition = 'transform 0.26s var(--ease-spring-down)';
        container.style.transform = 'translate3d(0, 100%, 0)';
    }
    if (overlay) {
        overlay.style.transition = 'opacity 0.22s ease-out';
        overlay.style.opacity = '0';
    }

    setTimeout(() => {
        sheet.classList.remove('show');
        if (container) {
            container.style.transform = '';
            container.style.transition = '';
        }
        if (overlay) {
            overlay.style.opacity = '';
            overlay.style.transition = '';
        }
        unlockScroll();
    }, 260);
}

// ---------- 下滑收起底部弹窗手势引擎 (丝滑原生交互体验) ----------
function initBottomSheetDrag(sheetId, containerId, overlayId, closeFn) {
    const sheet = document.getElementById(sheetId);
    const container = document.getElementById(containerId);
    const overlay = document.getElementById(overlayId);
    if (!sheet || !container) return;

    let startY = 0;
    let currentY = 0;
    let startTime = 0;
    let isDragging = false;
    let canDrag = false;

    const onStart = (clientY, target) => {
        if (!sheet.classList.contains('show')) return;
        const isHandleOrHeader = target.closest('.sheet-handle-bar') || target.closest('.sheet-header');
        const scrollable = target.closest('.sheet-body');

        if (isHandleOrHeader) {
            canDrag = true;
        } else if (scrollable && scrollable.scrollTop <= 0) {
            canDrag = true;
        } else {
            canDrag = false;
            return;
        }

        startY = clientY;
        currentY = clientY;
        startTime = Date.now();
        isDragging = false;
    };

    const onMove = (clientY, e) => {
        if (!canDrag) return;
        const deltaY = clientY - startY;

        if (deltaY > 0) {
            if (!isDragging) {
                isDragging = true;
                container.style.transition = 'none';
                if (overlay) overlay.style.transition = 'none';
            }
            if (e && e.cancelable) e.preventDefault();

            container.style.transform = `translate3d(0, ${deltaY}px, 0)`;
            if (overlay) {
                const opacity = Math.max(0, 1 - (deltaY / 420));
                overlay.style.opacity = String(opacity);
            }
        }
    };

    const onEnd = (clientY) => {
        if (!isDragging) {
            canDrag = false;
            return;
        }
        const deltaY = clientY - startY;
        const duration = Math.max(1, Date.now() - startTime);
        const velocity = deltaY / duration;

        canDrag = false;
        isDragging = false;

        // 下拉位移超过 90px 或 快速向下滑动 (速度 > 0.35px/ms) 时触发收起
        if (deltaY > 90 || (deltaY > 30 && velocity > 0.35)) {
            closeFn();
        } else {
            // 回弹复位
            container.style.transition = 'transform 0.28s var(--ease-spring-up)';
            container.style.transform = 'translate3d(0, 0, 0)';
            if (overlay) {
                overlay.style.transition = 'opacity 0.28s ease-out';
                overlay.style.opacity = '1';
            }
            setTimeout(() => {
                container.style.transition = '';
                container.style.transform = '';
                if (overlay) {
                    overlay.style.transition = '';
                    overlay.style.opacity = '';
                }
            }, 280);
        }
    };

    // 绑定 Touch 事件 (移动端)
    container.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches.length === 1) {
            onStart(e.touches[0].clientY, e.target);
        }
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (canDrag && e.touches && e.touches.length === 1) {
            onMove(e.touches[0].clientY, e);
        }
    }, { passive: false });

    window.addEventListener('touchend', (e) => {
        if (canDrag || isDragging) {
            const endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : currentY;
            onEnd(endY);
        }
    });

    window.addEventListener('touchcancel', () => {
        if (isDragging) onEnd(startY);
    });

    // 绑定鼠标拖动事件 (PC 桌面端拖拽把手体验)
    const handleBar = container.querySelector('.sheet-handle-bar');
    if (handleBar) {
        handleBar.addEventListener('mousedown', (e) => {
            onStart(e.clientY, e.target);
            const onMouseMove = (moveEvent) => {
                currentY = moveEvent.clientY;
                onMove(moveEvent.clientY, moveEvent);
            };
            const onMouseUp = (upEvent) => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                onEnd(upEvent.clientY);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }
}

// ---------- 详情: Level 2 Full Detail ----------
function openFullDetail() {
    if (!currentFund) return;
    const page = document.getElementById('full-detail-page');
    if (!page) return;

    closeSheet();
    lockScroll();

    const setTxt = (elId, val) => {
        const el = document.getElementById(elId);
        if (el) el.textContent = val || '—';
    };

    setTxt('full-fund-name', currentFund.name);
    setTxt('full-fund-code', currentFund.code);
    setTxt('full-fund-risk', currentFund.risk);
    setTxt('full-limit-status', formatLimit(currentFund.limit, { withUnit: true, status: currentFund.purchaseStatus }));
    setTxt('full-purchase-status', currentFund.purchaseStatus);
    setTxt('full-data-asof', currentFund.dataAsOf);
    setTxt('full-fee-status', currentFund.fee);
    setTxt('full-nav-status', fmtNav(currentFund.nav));
    setTxt('full-accnav-status', fmtNav(currentFund.accNav));
    setTxt('full-scale', currentFund.scale);

    renderHoldingsList(currentFund.holdings || [], 'full-holdings');

    const perfEl = document.getElementById('full-performance');
    if (perfEl) {
        perfEl.innerHTML = (currentFund.perf || []).map(p => {
            const isNum = typeof p.r === 'number';
            const returnStr = isNum ? fmtPct(p.r) : (p.r === null || p.r === undefined ? '—' : p.r);
            const returnClass = isNum ? pctClass(p.r) : '';
            const isBold = p.p === '年化收益率';
            const boldStyle = isBold ? 'font-weight:700;' : '';
            return `<tr><td style="${boldStyle}">${p.p}</td><td class="${returnClass}" style="${boldStyle}">${returnStr}</td><td><span class="rank-pill">${p.rank || '—'}</span></td></tr>`;
        }).join('');
    }

    const rm = currentFund.riskMetrics || {};
    setTxt('rm-sharpe', rm.sharpe);
    setTxt('rm-drawdown', rm.drawdown);
    setTxt('rm-vol', rm.vol);
    setTxt('rm-alpha', rm.alpha);
    setTxt('rm-beta', rm.beta);

    const profEl = document.getElementById('full-profile');
    if (profEl && currentFund.profile) {
        const prof = currentFund.profile;
        const rows = [
            { k: '基金代码', v: prof.codeInfo || currentFund.code },
            { k: '基金管理人', v: prof.manager },
            { k: '基金经理', v: prof.fm },
            { k: '投资目标', v: prof.target },
            { k: '投资范围', v: prof.scope },
            { k: '业绩比较基准', v: prof.benchmark }
        ];
        profEl.innerHTML = rows.map(r => `<tr><td class="pt-label">${r.k}</td><td class="pt-val">${r.v || '—'}</td></tr>`).join('');
    }

    page.classList.add('active');
    const content = page.querySelector('.detail-content');
    if (content) content.scrollTop = 0;
    updateNavVisibility();

    fullDistActiveType = 'assets';
    setTimeout(() => {
        renderDistributionComponent('full', currentFund, fullDistActiveType);
    }, 150);
}

function closeFullDetail() {
    const page = document.getElementById('full-detail-page');
    if (page) {
        page.classList.add('closing');
        page.classList.remove('active');
        setTimeout(() => {
            page.classList.remove('closing');
            unlockScroll();
            updateNavVisibility();
        }, 260);
    }
}

// ---------- 图表渲染 ----------
function renderHoldingsList(holdings, targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;
    if (!holdings.length) {
        el.innerHTML = '<li class="empty-note">暂无持仓披露</li>';
        return;
    }
    el.innerHTML = holdings.map(h => `
        <li class="holding-item">
            <span class="stock-name">${h.n}</span>
            <span class="stock-pct">${(h.r != null && !isNaN(h.r) ? Number(h.r) : 0).toFixed(2)}%</span>
        </li>
    `).join('');
}

function safeRenderChart(canvasId, labels, data, colors) {
    renderChart(canvasId, labels || [], data || [], colors || CHART_COLORS);
}

function renderChart(canvasId, labels, data, colors, type = 'doughnut', isBar = false) {
    if (typeof Chart === 'undefined') return;
    if (charts[canvasId]) {
        try { charts[canvasId].destroy(); } catch (e) {}
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    try {
        const ctx = (canvas.getContext && canvas.getContext('2d')) ? canvas.getContext('2d') : canvas;
        if (!ctx) return;

        charts[canvasId] = new Chart(ctx, {
            type: isBar ? 'bar' : type,
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: colors,
                    borderWidth: isBar ? 0 : 2,
                    borderColor: '#FFFFFF'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300, easing: 'easeOutQuart' },
                plugins: {
                    legend: {
                        display: !isBar,
                        position: 'right',
                        labels: { boxWidth: 10, font: { size: 11, family: FONT_FAMILY } }
                    }
                },
                scales: isBar ? {
                    x: { grid: { display: false } },
                    y: { ticks: { callback: v => v + '%' } }
                } : {}
            }
        });
    } catch (e) {
        console.warn('[renderChart] 图表初始化跳过:', e.message);
    }
}

function jumpToBroker(btn) {
    if (!btn) return;
    const origText = btn.textContent;
    btn.textContent = '✓ 正在唤起券商交易中...';
    btn.disabled = true;
    setTimeout(() => {
        btn.textContent = origText;
        btn.disabled = false;
    }, 1500);
}
