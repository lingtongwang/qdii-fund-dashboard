// 统一 HTTP 封装：UA/Referer + 指数退避重试 + 节流
// 所有出站请求走这里，保证东财端点稳定且礼貌。

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
};

export function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// 简单抖动延时，避免固定节奏被识别为脚本
export async function throttle(base = 350, jitter = 250) {
    const ms = base + Math.floor(Math.random() * jitter);
    await sleep(ms);
}

/**
 * GET 请求，带重试。
 * @param {string} url
 * @param {object} opts { headers, referer, retries, timeout, encoding }
 *   encoding: 'utf8'(默认) | 'buffer' | 'gbk'(用 iconv-lite 解码)
 */
export async function getText(url, opts = {}) {
    const {
        referer = 'https://fundf10.eastmoney.com/',
        headers = {},
        retries = 3,
        timeout = 15000,
    } = opts;

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const tid = setTimeout(() => controller.abort(), timeout);
            const res = await fetch(url, {
                headers: { ...DEFAULT_HEADERS, Referer: referer, ...headers },
                signal: controller.signal,
            });
            clearTimeout(tid);
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
            const buf = Buffer.from(await res.arrayBuffer());
            return buf;
        } catch (e) {
            lastErr = e;
            if (attempt < retries) {
                const wait = 1000 * 2 ** attempt; // 1s, 2s, 4s
                await sleep(wait);
            }
        }
    }
    throw lastErr;
}

// 返回文本（可选 gbk 解码）
export async function getString(url, opts = {}) {
    const buf = await getText(url, opts);
    if (opts.encoding === 'gbk') {
        const iconv = await import('iconv-lite');
        return iconv.default.decode(buf, 'gbk');
    }
    return buf.toString('utf8');
}

// 返回 JSON（支持 JSONP 包裹：自动剥离 "var x = (...);"）
export async function getJson(url, opts = {}) {
    let txt = await getString(url, opts);
    // 去 BOM
    txt = txt.replace(/^﻿/, '');
    // 尝试直接 JSON
    try {
        return JSON.parse(txt);
    } catch { /* fallthrough */ }
    // JSONP: var name = {...}; 或 callback({...})
    const m = txt.match(/[=(]\s*(\{[\s\S]*\})\s*[;)]/);
    if (m) {
        try { return JSON.parse(m[1]); } catch { /* ignore */ }
    }
    throw new Error('无法解析 JSON/JSONP: ' + txt.slice(0, 120));
}
