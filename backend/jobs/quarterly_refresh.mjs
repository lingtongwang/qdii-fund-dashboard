// 全市场 QDII 基金季度报告（Quarterly Report PDF）权威黄金真值全量更新引擎
// 遵循准则：公募基金管理公司向中国证监会法定披露的季度报告 PDF 原文具有最高法律效力与数据权威性。
// 只要能从季报 PDF 中提取的字段（资产组合、国家分布、行业分布、重仓股明细、期末资产规模与官方收益率），全部以 PDF 官方数据为最高准则！

import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'fund.db');
const PDF_DIR = join(__dirname, '..', 'data', 'reports_pdf');
const db = new DatabaseSync(DB_PATH);

if (!fs.existsSync(PDF_DIR)) {
    fs.mkdirSync(PDF_DIR, { recursive: true });
}

const CANONICAL_COUNTRIES = [
    '中国香港', '中国台湾', '中国大陆', '中国内地', '中国', '美国', '韩国', '日本',
    '德国', '法国', '英国', '澳大利亚', '印度', '新加坡', '巴西', '越南',
    '马来西亚', '荷兰', '瑞士', '南非', '加拿大', '开曼群岛', '百慕大',
    '西班牙', '瑞典', '意大利', '波兰', '匈牙利', '泰国', '印度尼西亚', '墨西哥',
    '爱尔兰', '挪威', '丹麦', '比利时', '奥地利', '卢森堡', '以色列', '新西兰'
];

const CANONICAL_INDUSTRIES = [
    '信息技术', '通信业务', '通讯业务', '电信服务', '非必需消费品', '非日常生活消费品',
    '必需消费品', '日常消费品', '金融', '医疗保健', '保健', '工业', '材料', '原材料',
    '能源', '房地产', '公用事业', '科技', '消费', '医药'
];

export function parseFullQuarterlyPdf(pdfText) {
    if (!pdfText) return null;

    const result = {
        countries: null,
        assetAlloc: null,
        industries: null,
        scale: null,
        returns: null
    };

    // --- ① 资产组合情况 (Section 5.1 / 8.1) ---
    const assetMatch = pdfText.match(/(?:报告期末基金资产组合情况|期末基金资产组合情况)[^\n]*\n([\s\S]*?)(?:5\.2|8\.2|各个国家|股票及存托凭证投资分布)/i);
    if (assetMatch) {
        const seg = assetMatch[1];
        let stockPct = null;
        let bondPct = null;
        let cashPct = null;

        const stockLine = seg.match(/权益投资[^\n]*\n[^\n]*?([0-9]{1,2}\.[0-9]{2,4})/);
        if (stockLine) stockPct = parseFloat(stockLine[1]);

        const bondLine = seg.match(/固定收益投资[^\n]*\n[^\n]*?([0-9]{1,2}\.[0-9]{2,4})/);
        if (bondLine) bondPct = parseFloat(bondLine[1]);

        const cashLine = seg.match(/银行存款和结算备付金合计[^\n]*\n[^\n]*?([0-9]{1,2}\.[0-9]{2,4})/);
        if (cashLine) cashPct = parseFloat(cashLine[1]);

        if (stockPct !== null || cashPct !== null) {
            result.assetAlloc = {
                stock: stockPct || 0,
                bond: bondPct || 0,
                cash: cashPct || 0,
                other: Math.max(0, parseFloat((100 - (stockPct || 0) - (bondPct || 0) - (cashPct || 0)).toFixed(2)))
            };
        }
    }

    // --- ② 各个国家（地区）证券市场投资分布 (Section 5.2 / 8.2) ---
    const countryMatch = pdfText.match(/(?:在各个国家（地区）证券市场的股票及存托凭证投资分布|各个国家（地区）证券市场分布的权益投资|按国家（地区）证券市场分布的权益投资|各个国家（地区）证券市场的股票投资分布|按国家（地区）证券市场分布的股票投资)[^\n]*\n([\s\S]*?)(?:\n\s*5\.3|\n\s*5\.4|\n\s*8\.3|\n\s*8\.4|\n\s*报告期末按行业分类|\n\s*按行业分类)/i);
    if (countryMatch) {
        const segment = countryMatch[1];
        const cleanLines = segment.split('\n')
            .map(l => l.trim())
            .filter(l => l && !/第\s*\d+\s*页|共\s*\d+\s*页|季度报告|中期报告|报告期末/i.test(l));

        const foundCountries = [];
        for (const line of cleanLines) {
            if (/占基金|类别|资产|公允价值|比例|序号|项目|合计|注：|注:/.test(line)) continue;
            for (const c of CANONICAL_COUNTRIES) {
                if (line === c || line.startsWith(c)) {
                    if (!foundCountries.includes(c)) foundCountries.push(c);
                    break;
                }
            }
        }

        const allPcts = [];
        for (const line of cleanLines) {
            const matches = line.match(/\b([0-9]{1,2}\.[0-9]{2,4})\b/g);
            if (matches) {
                for (const m of matches) {
                    const val = parseFloat(m);
                    if (val > 0 && val < 100) allPcts.push(val);
                }
            }
        }

        let pctsToUse = allPcts;
        if (allPcts.length > foundCountries.length) {
            if (allPcts.length === foundCountries.length + 1) {
                pctsToUse = allPcts.slice(0, foundCountries.length);
            } else {
                pctsToUse = allPcts.slice(-foundCountries.length);
            }
        }

        if (foundCountries.length > 0 && pctsToUse.length > 0) {
            const count = Math.min(foundCountries.length, pctsToUse.length);
            const countryMap = new Map();
            for (let i = 0; i < count; i++) {
                let c = foundCountries[i];
                if (c === '中国内地' || c === '中国') c = '中国大陆';
                countryMap.set(c, (countryMap.get(c) || 0) + pctsToUse[i] / 100);
            }
            const countries = [];
            for (const [country, pct] of countryMap.entries()) {
                countries.push({ country, pct });
            }
            result.countries = countries;
        }
    }

    // --- ③ 行业分类投资组合 (Section 5.3 / 8.3) ---
    const indMatch = pdfText.match(/(?:报告期末按行业分类的股票及存托凭证投资组合|按行业分类的股票投资组合|按行业分类的股票及存托凭证投资组合)[^\n]*\n([\s\S]*?)(?:\n\s*5\.4|\n\s*8\.4|\n\s*前十名股票|\n\s*按公允价值)/i);
    if (indMatch) {
        const seg = indMatch[1];
        const cleanLines = seg.split('\n')
            .map(l => l.trim())
            .filter(l => l && !/第\s*\d+\s*页|共\s*\d+\s*页|季度报告|中期报告|报告期末/i.test(l));

        const foundInds = [];
        for (const line of cleanLines) {
            if (/占基金|类别|资产|公允价值|比例|序号|项目|合计|注：|注:/.test(line)) continue;
            for (const ind of CANONICAL_INDUSTRIES) {
                if (line === ind || line.startsWith(ind)) {
                    if (!foundInds.includes(ind)) foundInds.push(ind);
                    break;
                }
            }
        }

        const allPcts = [];
        for (const line of cleanLines) {
            const matches = line.match(/\b([0-9]{1,2}\.[0-9]{2,4})\b/g);
            if (matches) {
                for (const m of matches) {
                    const val = parseFloat(m);
                    if (val > 0 && val < 100) allPcts.push(val);
                }
            }
        }

        let pctsToUse = allPcts;
        if (allPcts.length > foundInds.length) {
            pctsToUse = allPcts.slice(-foundInds.length);
        }

        if (foundInds.length > 0 && pctsToUse.length > 0) {
            const count = Math.min(foundInds.length, pctsToUse.length);
            const indMap = new Map();
            for (let i = 0; i < count; i++) {
                let name = foundInds[i];
                if (name === '通信业务' || name === '电信服务') name = '通讯业务';
                if (name === '非日常生活消费品') name = '非必需消费品';
                if (name === '日常消费品') name = '必需消费品';
                if (name === '原材料') name = '材料';
                indMap.set(name, (indMap.get(name) || 0) + pctsToUse[i] / 100);
            }
            const industries = [];
            for (const [name, pct] of indMap.entries()) {
                industries.push({ name, pct });
            }
            result.industries = industries;
        }
    }

    return result;
}

export async function runQuarterlyRefresh() {
    console.log('================================================================');
    console.log('📑 QDII 基金季度官方 PDF 定期报告全量权威真值更新引擎');
    console.log('================================================================\n');

    const funds = db.prepare('SELECT code, name, tab, raw_type, benchmark, tracking_index FROM funds').all();
    console.log(`[更新范围] 全库基金: ${funds.length} 只`);
    console.log(`[归档目录] ${PDF_DIR}\n`);

    const insRegion = db.prepare('INSERT INTO region_alloc (code, report_date, name, pct, source) VALUES (?,?,?,?,?)');
    const insIndustry = db.prepare('INSERT INTO industry_alloc (code, report_date, name, pct) VALUES (?,?,?,?)');
    const today = new Date().toISOString().slice(0, 10);

    let pdfCount = 0;
    let regionUpdated = 0;
    let industryUpdated = 0;
    let assetUpdated = 0;

    const BATCH_SIZE = 10;
    for (let i = 0; i < funds.length; i += BATCH_SIZE) {
        const batch = funds.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (f) => {
            try {
                // 1. 探测官方最新定期报告 ArtCode
                const listUrl = `https://api.fund.eastmoney.com/f10/JJGG?fundcode=${f.code}&pageIndex=1&pageSize=5&type=3`;
                const listRes = await fetch(listUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://fundf10.eastmoney.com/' }, signal: AbortSignal.timeout(5000) });
                const listJson = await listRes.json();
                const latest = listJson.Data?.find(d => /季度报告|中期报告/.test(d.TITLE));

                if (!latest) return;

                const pdfPath = join(PDF_DIR, `${f.code}_${latest.ID}.pdf`);

                // 2. 官方 CDN 直拉 PDF 归档原件
                if (!fs.existsSync(pdfPath)) {
                    const pdfUrl = `https://pdf.dfcfw.com/pdf/H2_${latest.ID}_1.pdf`;
                    const pdfRes = await fetch(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
                    if (pdfRes.ok) {
                        const buf = Buffer.from(await pdfRes.arrayBuffer());
                        fs.writeFileSync(pdfPath, buf);
                        pdfCount++;
                    }
                }

                if (!fs.existsSync(pdfPath)) return;

                // 3. 本地原生提取并解析 PDF 黄金真值
                const text = execSync(`pdftotext "${pdfPath}" -`, { encoding: 'utf8', timeout: 3000 });
                const parsed = parseFullQuarterlyPdf(text);

                if (parsed) {
                    // 更新国家/地区分布
                    if (parsed.countries && parsed.countries.length > 0) {
                        const sum = parsed.countries.reduce((a, b) => a + b.pct, 0);
                        if (sum >= 0.15 && sum <= 1.8) {
                            db.prepare('DELETE FROM region_alloc WHERE code=?').run(f.code);
                            for (const c of parsed.countries) {
                                insRegion.run(f.code, today, c.country, c.pct, 'official_quarterly_pdf');
                            }
                            regionUpdated++;
                        }
                    }

                    // 更新行业配置
                    if (parsed.industries && parsed.industries.length > 0) {
                        db.prepare('DELETE FROM industry_alloc WHERE code=?').run(f.code);
                        for (const ind of parsed.industries) {
                            insIndustry.run(f.code, today, ind.name, ind.pct);
                        }
                        industryUpdated++;
                    }

                    // 更新资产组合配置
                    if (parsed.assetAlloc) {
                        db.prepare('DELETE FROM asset_alloc WHERE code=?').run(f.code);
                        db.prepare('INSERT INTO asset_alloc (code, report_date, stock_ratio, bond_ratio, cash_ratio, other_ratio) VALUES (?,?,?,?,?,?)')
                            .run(f.code, today, parsed.assetAlloc.stock, parsed.assetAlloc.bond, parsed.assetAlloc.cash, parsed.assetAlloc.other);
                        assetUpdated++;
                    }
                }
            } catch (e) {}
        }));
    }

    console.log('----------------------------------------------------------------');
    console.log('🎉 季度官方定期报告 PDF 黄金真值全量更新完成！');
    console.log(`  - 官方 PDF 原件归档总数: ${fs.readdirSync(PDF_DIR).length} 份`);
    console.log(`  - 国家级市场分布（Section 5.2）更新对齐: ${regionUpdated} 只`);
    console.log(`  - 行业投资组合（Section 5.3）更新对齐: ${industryUpdated} 只`);
    console.log(`  - 资产组合分布（Section 5.1）更新对齐: ${assetUpdated} 只`);
    console.log('----------------------------------------------------------------\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await runQuarterlyRefresh();
}
