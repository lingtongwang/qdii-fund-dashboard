// node:sqlite 封装：建表 + 单例连接（零原生编译，启动需 --experimental-sqlite）
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data', 'fund.db');

let _db = null;

export function getDb() {
    if (_db) return _db;
    _db = new DatabaseSync(DB_PATH);
    _db.exec('PRAGMA journal_mode = WAL;');
    _db.exec('PRAGMA foreign_keys = ON;');
    initSchema(_db);
    return _db;
}

function initSchema(db) {
    db.exec(`
        -- A 类 · 每日更新
        CREATE TABLE IF NOT EXISTS daily_nav (
            code            TEXT NOT NULL,
            date            TEXT NOT NULL,
            nav             REAL,
            acc_nav         REAL,
            daily_return    REAL,
            purchase_status TEXT,
            redeem_status   TEXT,
            limit_amount    REAL,
            updated_at      TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (code, date)
        );

        -- B 类 · 每季度更新（东财）
        CREATE TABLE IF NOT EXISTS funds (
            code          TEXT PRIMARY KEY,
            name          TEXT,
            scale         REAL,
            fee_rate      TEXT,
            risk_level    TEXT,
            manager       TEXT,
            benchmark     TEXT,
            target        TEXT,
            scope         TEXT,
            fm            TEXT,
            code_info     TEXT,
            report_date   TEXT,
            tab           TEXT,
            pill          TEXT,
            classify_basis TEXT,
            excluded        INTEGER NOT NULL DEFAULT 0,
            mainstream      INTEGER NOT NULL DEFAULT 1,
            region_excluded INTEGER NOT NULL DEFAULT 0,
            updated_at    TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS holdings (
            code         TEXT NOT NULL,
            rank         INTEGER NOT NULL,
            symbol       TEXT,
            name         TEXT,
            pct          REAL,
            shares       REAL,
            market_value REAL,
            report_date  TEXT,
            PRIMARY KEY (code, report_date, rank)
        );

        CREATE TABLE IF NOT EXISTS performance (
            code        TEXT NOT NULL,
            period      TEXT NOT NULL,
            ret         REAL,
            rank        INTEGER,
            rank_total  INTEGER,
            PRIMARY KEY (code, period)
        );

        CREATE TABLE IF NOT EXISTS risk_metrics (
            code          TEXT PRIMARY KEY,
            calc_date     TEXT,
            sharpe        REAL,
            max_drawdown  REAL,
            volatility    REAL,
            alpha         REAL,
            beta          REAL,
            updated_at    TEXT DEFAULT (datetime('now'))
        );

        -- B 类 · 每季度更新（季报 PDF/全文）
        CREATE TABLE IF NOT EXISTS industry_alloc (
            code        TEXT NOT NULL,
            report_date TEXT NOT NULL,
            name        TEXT NOT NULL,
            pct         REAL,
            PRIMARY KEY (code, report_date, name)
        );
        CREATE TABLE IF NOT EXISTS region_alloc (
            code        TEXT NOT NULL,
            report_date TEXT NOT NULL,
            name        TEXT NOT NULL,
            pct         REAL,
            source      TEXT DEFAULT 'morningstar',
            PRIMARY KEY (code, report_date, name)
        );
        CREATE TABLE IF NOT EXISTS asset_alloc (
            code        TEXT NOT NULL,
            report_date TEXT NOT NULL,
            name        TEXT NOT NULL,
            pct         REAL,
            PRIMARY KEY (code, report_date, name)
        );

        -- 季报 art_code 缓存（跨周期沿用，季报 PDF 永久有效）
        CREATE TABLE IF NOT EXISTS quarterly_ann (
            code         TEXT PRIMARY KEY,
            art_code     TEXT,
            notice_date  TEXT,
            notice_title TEXT,
            updated_at   TEXT DEFAULT (datetime('now'))
        );
    `);
    // 向后兼容：补列 raw_type（东财原始分类，用于核对 QDII 口径）
    try { db.exec('ALTER TABLE funds ADD COLUMN raw_type TEXT;'); } catch { /* 已存在则忽略 */ }
    // 向后兼容：补列 excluded（0=保留，1=暂时不用；债券/商品/REITs 由 mark_excluded.mjs 标记）
    try { db.exec('ALTER TABLE funds ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0;'); } catch { /* 已存在则忽略 */ }
    // 向后兼容：补列 mainstream（1=主流保留，0=非主流/冗余份额；由 mark_mainstream.mjs 标记）
    try { db.exec('ALTER TABLE funds ADD COLUMN mainstream INTEGER NOT NULL DEFAULT 1;'); } catch { /* 已存在则忽略 */ }
    // 向后兼容：补列 region_excluded（0=保留，1=港股为主/用户不用；由 mark_hk.mjs 标记）
    try { db.exec('ALTER TABLE funds ADD COLUMN region_excluded INTEGER NOT NULL DEFAULT 0;'); } catch { /* 已存在则忽略 */ }
    // 向后兼容：region_alloc 加 source 列（口径防护：morningstar 洲/地区级 vs eastmoney 国家/地区级）
    try { db.exec('ALTER TABLE region_alloc ADD COLUMN source TEXT;'); } catch { /* 已存在则忽略 */ }
    // 向后兼容：funds 加 申购费率 / 赎回费率（投资者实际支付的费用，jjfl 页解析）
    try { db.exec('ALTER TABLE funds ADD COLUMN fee_subscribe TEXT;'); } catch { /* 已存在则忽略 */ }
    try { db.exec('ALTER TABLE funds ADD COLUMN fee_redeem TEXT;'); } catch { /* 已存在则忽略 */ }
    // 向后兼容：补列 exchange_excluded（0=场外开放式基金，1=场内上市ETF/LOF场内份额，不显示在场外池）
    try { db.exec('ALTER TABLE funds ADD COLUMN exchange_excluded INTEGER NOT NULL DEFAULT 0;'); } catch { /* 已存在则忽略 */ }
    // 向后兼容：补列 currency_excluded（0=人民币份额，1=美元/外币份额，不显示在默认池）
    try { db.exec('ALTER TABLE funds ADD COLUMN currency_excluded INTEGER NOT NULL DEFAULT 0;'); } catch { /* 已存在则忽略 */ }
    // 向后兼容：补列 tracking_index 与 index_code（指数基金跟踪标的指数名称与指数代码）
    try { db.exec('ALTER TABLE funds ADD COLUMN tracking_index TEXT;'); } catch { /* 已存在则忽略 */ }
    try { db.exec('ALTER TABLE funds ADD COLUMN index_code TEXT;'); } catch { /* 已存在则忽略 */ }
}

// 便捷 upsert 辅助
export function run(sql, params = []) {
    const db = getDb();
    return db.prepare(sql).run(...params);
}

export function all(sql, params = []) {
    const db = getDb();
    return db.prepare(sql).all(...params);
}

export function get(sql, params = []) {
    const db = getDb();
    return db.prepare(sql).get(...params);
}
