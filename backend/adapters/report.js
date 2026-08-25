// 季报适配器：发现 art_code（解析基金主页 HTML，纯原生 HTTP）+ 取内容接口全文文本抽取行业/区域
import { getString, getJson } from '../lib/http.js';

const UA = { 'User-Agent': 'Mozilla/5.0' };

// ① 解析基金主页，发现最新公告里的 art_code（AN...）
export async function discoverArtCode(code) {
    const url = `https://fund.eastmoney.com/${code}.html`;
    const html = await getString(url, { referer: 'https://fund.eastmoney.com/', headers: UA });
    const items = [];
    
    // 原生解析所有 a 标签
    const linkMatches = (html || '').matchAll(/<a\s+[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gis);
    for (const m of linkMatches) {
        const href = m[1] || '';
        const mArt = href.match(/AN(\d{15,})/);
        if (mArt) {
            const title = (m[2] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            if (!items.find(i => i.artCode === mArt[1])) items.push({ artCode: mArt[1], title });
        }
    }
    // 兜底：正则直接扫 HTML（无名）
    if (!items.length) {
        const all = (html || '').match(/AN\d{15,}/g) || [];
        all.forEach(c => {
            const id = c.replace('AN', '');
            if (!items.find(i => i.artCode === id)) items.push({ artCode: id, title: '' });
        });
    }
    const limit = extractLimit(html);
    return { items, limit };
}

// 从基金主页 HTML 抽取「单日累计购买上限」（元）。
// 开放申购 -> null（无上限）；限大额 -> 解析金额（支持「万」单位，如 5元、10元、100元、500元、1万元等真实限购额）。
export function extractLimit(html) {
    if (!html) return null;
    const m = html.match(/单日累计购买上限\s*([\d,.]+)\s*(万)?\s*元/);
    if (m) {
        let v = parseFloat(m[1].replace(/,/g, ''));
        if (m[2] === '万') v *= 10000;
        if (!(v > 0)) return null;
        return v;
    }
    return null; // 开放申购 / 限大额但无明确金额 / 其他
}

// 单独抓取主页并抽取限额（供核心入库 / 回填使用，失败返回 null 不报错）
export async function fetchTradeLimit(code) {
    try {
        const html = await getString(`https://fund.eastmoney.com/${code}.html`, { referer: 'https://fund.eastmoney.com/', headers: UA });
        return extractLimit(html);
    } catch {
        return null;
    }
}

// ② 取单条公告内容（标题/日期/全文/PDF 直链）
export async function fetchAnnContent(artCode) {
    const url = `https://np-cnotice-fund.eastmoney.com/api/content/ann?client_source=web_fund&show_all=1&art_code=AN${artCode}`;
    const json = await getJson(url, { referer: 'https://fund.eastmoney.com/', headers: UA });
    const d = json?.data || json || {};
    return {
        title: d.notice_title || d.title || '',
        date: (d.notice_date || d.ei_date || '').slice(0, 10),
        content: d.notice_content || d.content || '',
        attachUrl: d.attach_url || d.attach_url_web || '',
    };
}

// 发现并返回目标季报的 art_code（过滤"季度报告"正文，排除"旗下部分基金…提示性公告"汇总提示，取最新）
export async function findQuarterlyArtCode(code) {
    const { items, limit } = await discoverArtCode(code);
    // 本地先用标题筛选：必须是季报正文，且排除"提示性公告"这类汇总提示
    const isQuarterly = (t) => /季度报告/.test(t) && !/提示性公告|提示公告|提示性/.test(t);
    let cands = items.filter(i => isQuarterly(i.title));
    // 兜底：若标题都拿不到，则回退到直接抓内容校验（最多 8 条），保证不漏报
    if (!cands.length && items.length) cands = items.slice(0, 8);

    let best = null;
    for (const it of cands) {
        try {
            const c = await fetchAnnContent(it.artCode);
            const title = c.title || it.title;
            if (!isQuarterly(title)) continue;
            const date = (c.date || '').slice(0, 10);
            if (!best || (date && date > best.date)) best = { artCode: it.artCode, title, date, content: c.content, attachUrl: c.attachUrl, limit };
        } catch { /* 单条失败跳过 */ }
    }
    return best; // { artCode, title, date, content, attachUrl, limit } 或 null
}

// 把公告正文（可能是 HTML 表格，也可能是纯文本）规整成「行=记录、单元格=空格分隔」的文本，
// 让后续的按行数字抽取逻辑对两种格式都生效。
// 顺序：先剥离标签（表格行/单元格转成换行/空格），再解码实体，最后规整空白。
function htmlToText(html) {
    if (!html) return '';
    let s = String(html);
    s = s.replace(/<\/tr>/gi, '\n')
         .replace(/<\/td>/gi, ' ')
         .replace(/<\/th>/gi, ' ')
         .replace(/<br\s*\/?>/gi, '\n')
         .replace(/<tr[^>]*>/gi, '')
         .replace(/<td[^>]*>/gi, '')
         .replace(/<th[^>]*>/gi, '')
         .replace(/<[^>]+>/g, ' ');
    s = s.replace(/&nbsp;/gi, ' ')
         .replace(/&amp;/gi, '&')
         .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
         .replace(/&[a-z]+;/gi, ' ');
    s = s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]*\n+/g, '\n');
    return s;
}

// ③ 从 notice_content 文本抽取 行业 / 区域 配置表
// 返回 { industry:[{name,pct}], region:[{name,pct}] }，pct 为小数（如 0.4521）
export function parseReportContent(content) {
    const result = { industry: [], region: [] };
    if (!content) return result;
    content = htmlToText(content);

    // 已知小节标题：用于定位「锚点」与「下界」。
    // 同一标题可能在「目录」出现一次、正文出现一次，故锚点取最后一次出现（目录在前、正文在后）；
    // 下界取锚点之后最近的另一个已知小节标题 —— 这样无论 行业/区域 在文中孰先孰后都能正确截断，
    // 不会把后续小节（前十名股票、债券、附注……）误并进本表。
    const HEADINGS = {
        industry:   /报告期末按行业分类的股票及存托凭证投资组合/,
        industry2:  /报告期末按行业分类的股票投资组合/,
        region:     /国家（地区）证券市场的股票及存托凭证投资分布/,
        top10:      /报告期末按公允价值占基金资产净值比例大小排序的前十名股票及存托凭证/,
        bond:       /报告期末按债券品种分类的债券投资组合/,
        bondcredit: /报告期末按债券信用等级分类的债券投资组合/,
        notes:      /投资组合报告附注/,
    };

    // 取标题最后一次出现的位置（跳过目录，落在正文章节）
    const lastPos = (re) => {
        let idx = -1, m;
        const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        while ((m = g.exec(content)) !== null) idx = m.index;
        return idx;
    };

    // 全部小节位置（用于求「锚点之后最近的下界」）
    const allPos = [];
    for (const re of Object.values(HEADINGS)) {
        let m, g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        while ((m = g.exec(content)) !== null) allPos.push(m.index);
    }
    const stopAfter = (anchorIdx) => {
        let best = content.length;
        for (const p of allPos) if (p > anchorIdx && p < best) best = p;
        return best;
    };

    // 数据行格式：「名称  公允价值(含千分位逗号)  占净值比例」——占比是行末最后一个数字，数据行无 % 号。
    // 表头/合计/注释行通过 SKIP 与「≥2 个数字」双重过滤剔除。
    const SKIP = /比例|公允价值|金额|（%）|项目|序号|合计|小计|其中|附注|注：|币种|分类|标准|采用|全球|说明|以下|上述|如下|投资组合|占基金|报告期末/;

    const extractTable = (anchorRe) => {
        const a = lastPos(anchorRe);
        if (a < 0) return [];
        // 跳过锚点标题所在行，从下一行开始取数
        const nl = content.indexOf('\n', a);
        const pos = nl >= 0 ? nl + 1 : a + anchorRe.source.length;
        const end = stopAfter(a);
        const seg = content.slice(pos, end);
        const rows = [];
        for (const line of seg.split(/\r?\n/)) {
            const nums = line.match(/\d[\d,]*\.?\d*/g);
            if (!nums || nums.length < 2) continue;   // 数据行含「金额 + 占比」两个数字
            const pct = parseFloat(nums[nums.length - 1].replace(/,/g, ''));
            if (isNaN(pct)) continue;
            // 名称：去掉所有数字（含金额与占比）后取残余中文/英文
            let name = line.replace(/\d[\d,]*\.?\d*/g, ' ')
                .replace(/[^\u4e00-\u9fa5A-Za-z（）()\s]/g, '')
                .replace(/\s+/g, ' ').trim();
            if (!name || SKIP.test(name) || name.length > 20) continue;
            if (/[A-Za-z\u4e00-\u9fa5]/.test(name)) rows.push({ name, pct: pct / 100 });
        }
        return rows;
    };

    result.industry = extractTable(HEADINGS.industry);
    if (!result.industry.length) result.industry = extractTable(HEADINGS.industry2);
    result.region = extractTable(HEADINGS.region);
    return result;
}
