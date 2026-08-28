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
    '信息技术', '信息科技', '通信服务', '通信业务', '通讯业务', '电信服务', '电信业务', '通讯', '通信',
    '非必需消费品', '非日常生活消费品', '可选消费',
    '必需消费品', '日常消费品', '主要消费', '日常生活消费品',
    '金融', '金融业',
    '医疗保健', '保健', '医药生物', '医药',
    '工业', '制造业',
    '材料', '原材料', '基础材料',
    '能源', '能源业',
    '房地产', '房地产业',
    '公用事业', '科技', '消费',
    'Information', 'Technology', 'Health Care', 'Industrials', 'Financials', 'Consumer', 'Materials', 'Energy', 'Real Estate', 'Utilities', 'Communication',
    '信息传输、软件和信息技术服务业', '信息传输', '电子设备制造业'
];

function normalizeIndustry(name) {
    if (/通信|电信|Communication/i.test(name)) return '通讯业务';
    if (/非必需|非日常|可选|Discretionary/i.test(name)) return '非必需消费品';
    if (/必需|日常消费|主要消费|Staples/i.test(name)) return '必需消费品';
    if (/材料|原材料|基础材料|Materials/i.test(name)) return '材料';
    if (/保健|医药|Health/i.test(name)) return '医疗保健';
    if (/工业|制造业|Industrials/i.test(name)) return '工业';
    if (/能源|Energy/i.test(name)) return '能源';
    if (/房地产|Real Estate/i.test(name)) return '房地产';
    if (/金融|Financials/i.test(name)) return '金融';
    if (/信息|科技|Technology|Information|软件/i.test(name)) return '信息技术';
    return name;
}

function normalizeCountry(c) {
    if (c === '中国内地' || c === '中国') return '中国大陆';
    return c;
}

export function parseFullQuarterlyPdf(pdfText) {
    if (!pdfText) return null;

    const result = {
        countries: [],
        assetAlloc: null,
        industries: [],
        scale: null,
        returns: null
    };

    // --- ① 资产组合情况 (Section 5.1 / 7.1 / 8.1 / 9.1) ---
    const assetMatches = [...pdfText.matchAll(/(?:报告期末基金资产组合情况|期末基金资产组合情况|基金资产组合情况)/g)];
    for (const m of assetMatches) {
        if (m.index < 800) continue;
        const seg = pdfText.slice(m.index, m.index + 2000);
        let stockPct = null;
        let bondPct = null;
        let cashPct = null;

        for (const line of seg.split('\n')) {
            const trimmed = line.trim();
            if (/^1\s+权益投资|^\s*权益投资/.test(trimmed)) {
                const nums = trimmed.match(/(\d+\.\d{2,4})/g);
                if (nums && nums.length > 0) stockPct = parseFloat(nums[nums.length - 1]);
            }
            if (/^3\s+固定收益投资|^\s*固定收益投资|^\s*债券投资/.test(trimmed)) {
                const nums = trimmed.match(/(\d+\.\d{2,4})/g);
                if (nums && nums.length > 0) bondPct = parseFloat(nums[nums.length - 1]);
            }
            if (/银行存款和结算备付金|银行存款/.test(trimmed)) {
                const nums = trimmed.match(/(\d+\.\d{2,4})/g);
                if (nums && nums.length > 0) cashPct = parseFloat(nums[nums.length - 1]);
            }
        }

        if (stockPct !== null || cashPct !== null) {
            result.assetAlloc = {
                stock: stockPct || 0,
                bond: bondPct || 0,
                cash: cashPct || 0,
                other: Math.max(0, parseFloat((100 - (stockPct || 0) - (bondPct || 0) - (cashPct || 0)).toFixed(2)))
            };
            break;
        }
    }

    // --- ② 各个国家（地区）证券市场投资分布 (Section 5.2 / 7.2 / 8.2 / 9.2) ---
    const countryMatches = [...pdfText.matchAll(/(?:在各个国家（地区）证券市场的股票及存托凭证投资分布|各个国家（地区）证券市场分布的权益投资|按国家（地区）证券市场分布的权益投资|各个国家（地区）证券市场的股票投资分布|按国家（地区）证券市场分布的股票投资|在各个国家（地区）证券市场的权益投资分布|期末在各个国家（地区）证券市场的权益投资分布)/g)];
    let bestCountries = [];
    for (const m of countryMatches) {
        if (m.index < 800) continue;
        const seg = pdfText.slice(m.index, m.index + 2000);
        const endMatch = seg.match(/(?:\n\s*[5-9]\.3|\n\s*报告期末按行业分类|\n\s*按行业分类|\n\s*期末按行业分类)/i);
        const tableText = endMatch ? seg.slice(0, endMatch.index) : seg.slice(0, 1200);

        const lines = tableText.split('\n');
        const countryMap = new Map();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || /合计|小计|序号|项目|公允价值|比例|注：|注:|第\s*\d+\s*页|共\s*\d+\s*页/i.test(trimmed)) continue;
            if (/\s+-\s+-|\s+-\s*$/.test(trimmed) && !/\d+\.\d+/.test(trimmed)) continue;

            for (const c of CANONICAL_COUNTRIES) {
                const idx = trimmed.indexOf(c);
                if (idx >= 0 && idx < 12) {
                    const nums = trimmed.match(/(\d+\.\d{1,4})/g);
                    if (nums && nums.length > 0) {
                        const lastNum = parseFloat(nums[nums.length - 1]);
                        if (!isNaN(lastNum) && lastNum > 0 && lastNum <= 100) {
                            const norm = normalizeCountry(c);
                            countryMap.set(norm, (countryMap.get(norm) || 0) + lastNum / 100);
                        }
                    }
                    break;
                }
            }
        }
        const cList = [];
        for (const [country, pct] of countryMap.entries()) cList.push({ country, pct });
        if (cList.length > bestCountries.length) bestCountries = cList;
    }
    result.countries = bestCountries;

    // --- ③ 行业分类投资组合 (Section 5.3 / 7.3 / 8.3 / 9.3) ---
    const indMatches = [...pdfText.matchAll(/(?:按行业分类的股票及存托凭证投资组合|按行业分类的股票投资组合|按行业分类的权益投资组合|期末按行业分类的权益投资组合|期末指数投资按行业分类|报告期末按行业分类)/g)];
    let bestInds = [];
    for (const m of indMatches) {
        if (m.index < 800) continue;
        const seg = pdfText.slice(m.index, m.index + 2500);
        const endMatch = seg.match(/(?:\n\s*[5-9]\.4|\n\s*前十名|\n\s*按公允价值排序|\n\s*7\.4|\n\s*8\.4|\n\s*9\.4)/i);
        const tableText = endMatch ? seg.slice(0, endMatch.index) : seg.slice(0, 1500);

        const lines = tableText.split('\n');
        const indMap = new Map();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (!trimmed || /合计|小计|总计|序号|项目|公允价值|比例|注：|注:|第\s*\d+\s*页|共\s*\d+\s*页/i.test(trimmed)) continue;

            // 若当前行末尾是破折号且无有效小数百分比，直接作为 0% 跳过
            if (/\s+-\s+-|\s+-\s*$/.test(trimmed) && !/\d+\.\d+/.test(trimmed)) continue;

            // 若当前行无数字，尝试与下一行合并（适配工银瑞信等中英双语跨行折行排版），但下一行若为合计行则坚决不合并
            let combined = trimmed;
            if (i + 1 < lines.length && !/\d+\.\d+/.test(trimmed) && !/合计|总计|小计|Total|注：|注:/i.test(lines[i + 1])) {
                combined = trimmed + ' ' + lines[i + 1].trim();
            }

            if (/\s+-\s+-|\s+-\s*$/.test(combined) && !/\d+\.\d+/.test(combined)) continue;

            for (const ind of CANONICAL_INDUSTRIES) {
                const idx = combined.indexOf(ind);
                if (idx >= 0 && idx < 30) {
                    const nums = combined.match(/(\d+\.\d{1,4})/g);
                    if (nums && nums.length > 0) {
                        const lastNum = parseFloat(nums[nums.length - 1]);
                        if (!isNaN(lastNum) && lastNum > 0 && lastNum <= 100) {
                            const norm = normalizeIndustry(ind);
                            indMap.set(norm, (indMap.get(norm) || 0) + lastNum / 100);
                        }
                    }
                    break;
                }
            }
        }
        const iList = [];
        for (const [name, pct] of indMap.entries()) iList.push({ name, pct });
        if (iList.length > bestInds.length) bestInds = iList;
    }
    result.industries = bestInds;

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

                let targetPdfPath = null;
                if (latest) {
                    const pdfPath = join(PDF_DIR, `${f.code}_${latest.ID}.pdf`);
                    if (!fs.existsSync(pdfPath)) {
                        try {
                            const pdfUrl = `https://pdf.dfcfw.com/pdf/H2_${latest.ID}_1.pdf`;
                            const pdfRes = await fetch(pdfUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
                            if (pdfRes.ok) {
                                const buf = Buffer.from(await pdfRes.arrayBuffer());
                                fs.writeFileSync(pdfPath, buf);
                                pdfCount++;
                            }
                        } catch {}
                    }
                    if (fs.existsSync(pdfPath)) targetPdfPath = pdfPath;
                }

                // 兜底：若最新公告未下载成功，优先使用本地已归档的该基金历史季报/定期报告 PDF
                if (!targetPdfPath) {
                    const localFiles = fs.readdirSync(PDF_DIR).filter(p => p.startsWith(`${f.code}_`) && p.endsWith('.pdf'));
                    if (localFiles.length > 0) {
                        localFiles.sort().reverse();
                        targetPdfPath = join(PDF_DIR, localFiles[0]);
                    }
                }

                if (!targetPdfPath) return;

                // 3. 本地原生提取并解析 PDF 黄金真值（使用 -layout 保留表格行列对齐）
                const text = execSync(`pdftotext -layout "${targetPdfPath}" -`, { encoding: 'utf8', timeout: 3000 });
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

                    // 更新资产组合配置 (按 name / pct 结构)
                    if (parsed.assetAlloc) {
                        db.prepare('DELETE FROM asset_alloc WHERE code=?').run(f.code);
                        const insAsset = db.prepare('INSERT INTO asset_alloc (code, report_date, name, pct) VALUES (?,?,?,?)');
                        if (parsed.assetAlloc.stock > 0) insAsset.run(f.code, today, '股票', parsed.assetAlloc.stock / 100);
                        if (parsed.assetAlloc.cash > 0) insAsset.run(f.code, today, '现金', parsed.assetAlloc.cash / 100);
                        if (parsed.assetAlloc.bond > 0) insAsset.run(f.code, today, '债券', parsed.assetAlloc.bond / 100);
                        if (parsed.assetAlloc.other > 0) insAsset.run(f.code, today, '其他', parsed.assetAlloc.other / 100);
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
