// 严格多维数据与持仓穿透驱动分类引擎（四维全景体系）：
// 维度 1【大类资产属性 (Asset Class)】：非纯股票类（大宗商品/原油/黄金、QDII REITs、多元资产FOF、QDII债券）严格归入【其他大类 (other)】。
// 维度 2【欧洲宏观大类 (Europe)】：欧洲单市场/欧洲宽基，统一平铺展示，不设二级子分类。
// 维度 3【指数基金跟踪标的与基准 (Index & Benchmark)】：以官方跟踪标的 (tracking_index) 为唯一第一判定依据，业绩基准 (benchmark) 为第二依据。
// 维度 4【主动基金持仓风格与行业穿透 (Deep Look-Through)】：深度穿透底层行业敞口 (industry_alloc) 与前十大重仓股 (holdings)，精准归入真实赛道，彻底消灭模糊的“精选”分类。

export function classify(fundOrName = '', type = '', regions = [], trackingIndex = '', holdings = [], industries = [], benchmark = '') {
    // 兼容对象入参或多参数入参
    let name = '';
    let bm = '';
    if (typeof fundOrName === 'object' && fundOrName !== null) {
        name = fundOrName.name || '';
        type = fundOrName.raw_type || fundOrName.type || '';
        trackingIndex = fundOrName.tracking_index || fundOrName.trackingIndex || '';
        benchmark = fundOrName.benchmark || '';
        regions = fundOrName.regions || regions;
        holdings = fundOrName.holdings || holdings;
        industries = fundOrName.industries || industries;
    } else {
        name = fundOrName || '';
    }

    const idx = (trackingIndex || '').trim();
    bm = (benchmark || '').trim();
    const isIndex = Boolean(idx && idx !== '--' && idx !== '---') || /指数|ETF|联接|等权重|标普|纳斯达克|纳指|道琼斯|日经|东证|中韩/.test(name) || /指数/.test(type);

    // =========================================================================
    // 维度 1：投资资产大类属性（非纯股票类一律归入【其他大类 other】）
    // =========================================================================
    // 1.1 QDII REITs / 不动产信托
    if (/reit|房地产|不动产|epra/i.test(idx + ' ' + name + ' ' + type) || (/reit|房地产|不动产/i.test(bm) && !/股票|equity|stock/i.test(bm))) {
        return { tab: 'other', pill: 'QDII REITs', basis: `资产属性(REITs)` };
    }
    // 1.2 大宗商品 / 石油 / 原油 / 天然气 / 黄金 / 天然资源
    if (/石油|原油|油气|天然气|黄金|商品|贵金属|天然资源|资源|oil|gas|gold|commodity/i.test(idx + ' ' + name + ' ' + type) ||
        (/标普全球石油|道琼斯美国石油|商品指数|原油指数|石油指数/.test(bm))) {
        return { tab: 'other', pill: '大宗商品/能源', basis: `资产属性(大宗商品/能源)` };
    }
    // 1.3 债券 / 纯债 / 固收（仅限以债券为主的产品）
    if (type.includes('纯债') || type.includes('混合债') || /债券型|纯债|高收益债/.test(type + ' ' + name)) {
        return { tab: 'other', pill: 'QDII债券', basis: `资产属性(债券固收)` };
    }
    // 1.4 多元资产 FOF / 全球宏观配置 FOF（严格限定为全球宏观/多资产配置FOF，排除标普500、纳指等单指数/单赛道ETF联接型FOF）
    const isSingleThemeOrIndexFof = /标普|标准普尔|纳斯达克|纳指|道琼斯|日经|东证|恒生|中韩|半导体|芯片|医药|生物|消费|越南|印度|德国|法国|s&p|nasdaq/i.test(name + ' ' + idx);
    if (!isSingleThemeOrIndexFof && (type.includes('FOF') || name.includes('FOF') || name.includes('多元配置') || name.includes('聚享') || name.includes('全球策略') || name.includes('全球配置'))) {
        return { tab: 'other', pill: '多元资产FOF', basis: `资产属性(多元资产FOF)` };
    }

    // =========================================================================
    // 维度 2：欧洲宏观大类（单市场/欧洲宽基，不设二级子分类）
    // =========================================================================
    if (/德国|dax|法国|cac|英国|富时100|ftse 100|欧洲动力|欧洲成长/i.test(name + ' ' + idx + ' ' + bm)) {
        return { tab: 'europe', pill: '全部', basis: `欧洲市场` };
    }

    // 计算地区敞口
    const regMap = {};
    for (const r of (regions || [])) {
        const cleanName = (r.name || '').replace(/^大/, '').replace(/地区$/, '');
        regMap[cleanName] = Number(r.pct) || 0;
        regMap[r.name] = Number(r.pct) || 0;
    }
    const pAmericas = regMap['美洲'] || 0;
    const pAsia = regMap['亚洲'] || regMap['大亚洲地区'] || 0;
    const pEurope = regMap['欧洲'] || regMap['大欧洲地区'] || 0;

    // =========================================================================
    // 维度 3：指数型基金精准分类（仅针对指数基金：跟踪指数为第一依据，基金名称为第二依据）
    // =========================================================================
    if (isIndex) {
        const indexText = `${idx} ${name}`;
        // 3.1 亚太单国别宽基
        if (/日经|东证|nikkei|topix/i.test(indexText)) return { tab: 'apac', pill: '日本', basis: `指数/标的→日本` };
        if (/印度|india|nifty/i.test(indexText)) return { tab: 'apac', pill: '印度', basis: `指数/标的→印度` };
        if (/越南|vietnam/i.test(indexText)) return { tab: 'apac', pill: '越南', basis: `指数/标的→越南` };
        if (/东南亚|泛东南亚/i.test(indexText)) return { tab: 'apac', pill: '东南亚', basis: `指数/标的→东南亚` };
        if (/中韩/i.test(indexText)) return { tab: 'apac', pill: '科技/半导体', basis: `指数/标的→中韩半导体` };

        // 3.2 行业与主题指数（优先级高于宽基，防止标普信息科技、标普医疗保健被误归入标普宽基）
        if (/生物科技|医药|医疗|健康|biotech|health|pharma/i.test(indexText)) {
            return { tab: 'us', pill: '生物医药', basis: `指数/标的→生物医药` };
        }
        if (/消费|高端消费|汽车|新能源|consumer|auto/i.test(indexText)) {
            return { tab: 'us', pill: '消费/新能源', basis: `指数/标的→消费/新能源` };
        }
        if (/科技|半导体|芯片|信息|互联网|数字经济|tech|semiconductor/i.test(indexText)) {
            return { tab: 'us', pill: '科技/半导体', basis: `指数/标的→美股科技/半导体` };
        }

        // 3.3 美股纯宽基指数
        if (/纳斯达克100|nasdaq 100|ndx/i.test(indexText) || (/纳斯达克|nasdaq/i.test(indexText) && !/科技|生物|医疗|消费|信息|芯片/.test(indexText))) {
            return { tab: 'us', pill: '纳斯达克', basis: `指数/标的→纳斯达克100宽基` };
        }
        if ((/标准普尔500|标普500|s&p 500|sp500|spx|标准普尔|标普100|s&p 100|usa 50|美国50|标普/i.test(indexText)) && !/科技|信息|半导体|芯片|生物|医疗|医药|健康|消费|石油|天然气|能源/.test(indexText)) {
            return { tab: 'us', pill: '标普', basis: `指数/标的→标普500宽基` };
        }
        if (/道琼斯|dow jones/i.test(indexText) && !/石油|消费|房地产|reit/.test(indexText)) {
            return { tab: 'us', pill: '道琼斯', basis: `指数/标的→道琼斯宽基` };
        }
    }

    // =========================================================================
    // 维度 4：主动管理型基金深度穿透（单国别优先 + 地区判定 + 行业与重仓穿透）
    // =========================================================================
    // 4.1 单国别优先（严格排除 “除日本/不含日本/ex-Japan” 等负面干扰）
    const isJapan = (/日经|东证|nikkei|topix/i.test(name + ' ' + bm)) || (/日本|japan/i.test(name) && !/除日本|不含日本|ex japan|ex-japan/i.test(name));
    const isIndia = /印度|india|nifty/i.test(name + ' ' + bm);
    const isVietnam = /越南|vietnam/i.test(name + ' ' + bm);

    if (isJapan) return { tab: 'apac', pill: '日本', basis: `单国别→日本` };
    if (isIndia) return { tab: 'apac', pill: '印度', basis: `单国别→印度` };
    if (isVietnam) return { tab: 'apac', pill: '越南', basis: `单国别→越南` };

    // 4.2 判定一级地区 Tab
    let primaryTab = 'us';
    if (pAmericas >= 0.50 || (pAmericas > pAsia && pAmericas > pEurope)) primaryTab = 'us';
    else if (pAsia >= 0.50 || (pAsia > pAmericas && pAsia > pEurope)) primaryTab = 'apac';
    else primaryTab = 'us';

    // 4.3 穿透计算行业敞口 (Industry Allocations)
    let techPct = 0, bioPct = 0, consPct = 0;
    for (const ind of (industries || [])) {
        const iname = ind.name || '';
        const pct = Number(ind.pct) || 0;
        if (/信息技术|科技|半导体|芯片|通讯业务|通信服务|电信服务|technology/i.test(iname)) techPct += pct;
        if (/医疗|医药|保健|健康|healthcare|pharma|biotech/i.test(iname)) bioPct += pct;
        if (/消费|非日常生活消费品|必需消费品|非必需消费品|消费者|汽车|新能源|高端制造/i.test(iname)) consPct += pct;
    }

    // 4.4 检查重仓股集中度
    const hText = (holdings || []).map(h => h.name || '').join(' ');
    const techHoldingCount = (hText.match(/台积电|三星|SK海力士|美光|英伟达|苹果|微软|阿斯麦|博通|超威半导体|应用材料|科磊|泰瑞达|康宁|迈威尔|闪迪|智谱|腾讯|阿里|中芯国际|华虹|美团|百度|联想|快手|安集|中际旭创|兆易创新|澜起科技|拉姆研究|铠侠|KIOXIA|北方华创|紫光国微/g) || []).length;
    const bioHoldingCount = (hText.match(/信达生物|科伦博泰|恒瑞医药|药明康德|百利天恒|百济神州|泽璟制药|百奥赛图|歌礼制药|海思科|荣昌生物|荃信生物|康诺亚|莫德纳|Moderna|Bio-Techne|福泰制药|查尔斯河|强生|辉瑞|默沙东|礼来|诺和诺德|泰格医药/g) || []).length;
    const consHoldingCount = (hText.match(/茅台|五粮液|汾酒|泸州老窖|华住|携程|泡泡玛特|比亚迪|宁德时代|特斯拉|法拉利|爱马仕|LVMH|路易威登|历峰|开云|家得宝|麦当劳|TJX|亚马逊|美的|福耀玻璃|拼多多/g) || []).length;

    const isExplicitTech = /半导体|芯片|科技|智能|移动互联|数字经济|互联网|信息技术|technology|ai|chip/i.test(name + ' ' + bm);
    const isExplicitBio = /医药|医疗|生物|健康|创新药|pharma|healthcare|biotech/i.test(name + ' ' + bm);
    const isExplicitCons = /消费|汽车|新能源|高端制造|制造|新经济|豪华|电动车/i.test(name + ' ' + bm);

    // 穿透判定
    if (isExplicitBio || bioPct >= 0.35 || bioHoldingCount >= 4) {
        return { tab: primaryTab, pill: '生物医药', basis: `穿透生物医药 (行业:${(bioPct * 100).toFixed(1)}%, 重仓:${bioHoldingCount}只)` };
    }
    if (isExplicitTech || techPct >= 0.40 || techHoldingCount >= 4) {
        return { tab: primaryTab, pill: '科技/半导体', basis: `穿透科技半导体 (行业:${(techPct * 100).toFixed(1)}%, 重仓:${techHoldingCount}只)` };
    }
    if (isExplicitCons || consPct >= 0.35 || consHoldingCount >= 4) {
        return { tab: primaryTab, pill: (primaryTab === 'us' ? '消费/新能源' : '消费/高端制造'), basis: `穿透消费产业 (行业:${(consPct * 100).toFixed(1)}%, 重仓:${consHoldingCount}只)` };
    }

    return { tab: primaryTab, pill: '全行业配置', basis: `均衡多赛道配置 (科技:${(techPct * 100).toFixed(1)}%, 消费:${(consPct * 100).toFixed(1)}%, 医药:${(bioPct * 100).toFixed(1)}%)` };
}

