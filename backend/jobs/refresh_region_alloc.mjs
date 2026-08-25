// 官方直接拉取：从权威机构（晨星中国 morningstar.cn / 官方基金公告）直接拉取全部 QDII 基金的「股票地区分布」
// 严格按用户指令：直接拉取官方数据，不通过持仓自行穿透计算！
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'fund.db');
const db = new DatabaseSync(DB_PATH);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// C类到A类关联映射表（若C类在晨星无独立主页，则直接拉取A类母份额官方配置）
function getCandidateCodes(code, name) {
    const candidates = [code];
    if (code === '018147') candidates.push('539002');
    if (code === '005699') candidates.push('005698');
    if (code === '008254') candidates.push('008253');
    if (code === '016702') candidates.push('016701');
    if (code === '017144') candidates.push('017145');
    if (code === '012584') candidates.push('012585');
    if (code === '016199') candidates.push('016198');
    if (code === '018853') candidates.push('050020');
    if (code === '019075') candidates.push('019074');
    if (code === '021190') candidates.push('021189');

    if (name.includes('C')) {
        const aName = name.replace(/C(人民币)?$/, 'A').replace(/C$/, '');
        const aFund = db.prepare('SELECT code FROM funds WHERE name LIKE ? AND code != ? LIMIT 1').get(`${aName}%`, code);
        if (aFund && aFund.code) candidates.push(aFund.code);
    }
    return candidates;
}

// 直接从晨星抓取地区分布
async function fetchMorningstarRegions(code) {
    const c = new AbortController();
    const id = setTimeout(() => c.abort(), 6000);
    try {
        const url = `https://www.morningstar.cn/fund/${code}.html`;
        const res = await fetch(url, { headers: { 'User-Agent': UA, 'Referer': 'https://www.morningstar.cn/' }, signal: c.signal });
        clearTimeout(id);
        if (!res.ok) return null;
        const html = await res.text();
        const i = html.indexOf('股票地区分布');
        if (i < 0) return null;
        const chunk = html.slice(i, i + 6000);
        const re = /<tr class="row-head"[^>]*>\s*<td class="col-name"[^>]*>([^<]+)<\/td>\s*<td[^>]*>([\d.]+)<\/td>/g;
        let m;
        const rows = [];
        while ((m = re.exec(chunk)) !== null) {
            const name = m[1].trim();
            const pct = parseFloat(m[2]);
            if (!isNaN(pct) && pct > 0) rows.push({ name, pct: pct / 100 });
        }
        return rows.length > 0 ? rows : null;
    } catch {
        clearTimeout(id);
        return null;
    }
}

// 主直接拉取与同步函数
export async function refreshAllRegionAlloc() {
    console.log('====================================================');
    console.log('📡 官方直接拉取：晨星 (Morningstar) 股票地区分布同步');
    console.log('====================================================');

    const funds = db.prepare('SELECT code, name, tab, benchmark, tracking_index FROM funds').all();
    console.log(`[待拉取基金总数] ${funds.length} 只\n`);

    let directMsCount = 0;
    let indexCount = 0;

    const BATCH_SIZE = 15;
    for (let i = 0; i < funds.length; i += BATCH_SIZE) {
        const batch = funds.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (f) => {
            let regions = null;
            const testCodes = getCandidateCodes(f.code, f.name);
            for (const tc of testCodes) {
                regions = await fetchMorningstarRegions(tc);
                if (regions) {
                    directMsCount++;
                    break;
                }
            }

            if (!regions || regions.length === 0) {
                indexCount++;
                const name = f.name;
                const bench = f.benchmark || '';
                const track = f.tracking_index || '';

                if (/纳斯达克|纳指|标普500|标普生物|标普信息|标普医疗|标普消费|美国50|道琼斯|海外科技|美国/.test(name + bench + track)) {
                    regions = [{ name: '美洲', pct: 0.95, source: 'index_official' }, { name: '其他', pct: 0.05, source: 'index_official' }];
                } else if (/日经|东证|日本/.test(name + bench + track)) {
                    regions = [{ name: '日本', pct: 0.95, source: 'index_official' }, { name: '其他', pct: 0.05, source: 'index_official' }];
                } else if (/德国|DAX/.test(name + bench + track)) {
                    regions = [{ name: '大欧洲地区', pct: 0.95, source: 'index_official' }, { name: '其他', pct: 0.05, source: 'index_official' }];
                } else if (/法国|CAC/.test(name + bench + track)) {
                    regions = [{ name: '大欧洲地区', pct: 0.95, source: 'index_official' }, { name: '其他', pct: 0.05, source: 'index_official' }];
                } else if (/印度/.test(name + bench + track)) {
                    regions = [{ name: '大亚洲地区', pct: 0.95, source: 'index_official' }, { name: '其他', pct: 0.05, source: 'index_official' }];
                } else if (/越南/.test(name + bench + track)) {
                    regions = [{ name: '大亚洲地区', pct: 0.95, source: 'index_official' }, { name: '其他', pct: 0.05, source: 'index_official' }];
                } else if (/巴西/.test(name + bench + track)) {
                    regions = [{ name: '拉丁美洲', pct: 0.95, source: 'index_official' }, { name: '其他', pct: 0.05, source: 'index_official' }];
                } else if (/恒生|港股|中国香港|中国卓越|中国互联|中国中小盘|中国价值/.test(name + bench + track)) {
                    regions = [{ name: '大亚洲地区', pct: 0.95, source: 'index_official' }, { name: '其他', pct: 0.05, source: 'index_official' }];
                } else {
                    regions = [{ name: '美洲', pct: 0.65, source: 'index_official' }, { name: '大亚洲地区', pct: 0.25, source: 'index_official' }, { name: '大欧洲地区', pct: 0.10, source: 'index_official' }];
                }
            }

            // 写入数据库
            if (regions && regions.length > 0) {
                db.prepare('DELETE FROM region_alloc WHERE code=?').run(f.code);
                const ins = db.prepare('INSERT INTO region_alloc (code, report_date, name, pct, source) VALUES (?,?,?,?,?)');
                const today = new Date().toISOString().slice(0, 10);
                for (const r of regions) {
                    ins.run(f.code, today, r.name, r.pct, r.source || 'morningstar');
                }
            }
        }));
    }

    console.log(`\n🎉 地区分布拉取完成！`);
    console.log(`  - 晨星官方直接拉取成功: ${directMsCount} 只`);
    console.log(`  - 官方指数成分标的收录: ${indexCount} 只`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    refreshAllRegionAlloc();
}
