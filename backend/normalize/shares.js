// 基金家族与多份额归一化合并工具
// 将基金家族内的多份额（A/C/D/E/F/H/I...）聚合展示为单一代表名称，如「建信新兴市场混合(QDII) A/C」

function stem(n) {
    return n
        .replace(/美元现钞|美元现汇|美元|港币|人民币|RMB|欧元/g, '')
        .replace(/（.*?）|\(.*?\)/g, '')
        .replace(/(发起式|联接|母基|指数|ETF|LOF)?\s*(A|B|C|D|E|F|H|I|O|R|Y|后端)$/i, '')
        .replace(/\s+/g, '').trim();
}

function extractShareLetter(name) {
    const clean = name.replace(/（.*?）|\(.*?\)/g, ' ').replace(/人民币|美元|现汇|现钞|港币|后端/g, ' ').trim();
    const m = clean.match(/([A-Z])$/i) || name.match(/([A-Z])(类|份额)?$/i);
    return m ? m[1].toUpperCase() : null;
}

export function formatMergedFundName(name, allFamilyShares = []) {
    const letters = new Set();
    for (const f of allFamilyShares) {
        const l = extractShareLetter(f.name || f);
        if (l) letters.add(l);
    }
    
    // 清理主名字：去除末尾的单份字母、人民币/美元字样、空的括号
    let cleanName = name
        .replace(/（人民币.*?）|\(人民币.*?\)|（RMB.*?）|\(RMB.*?\)/g, '')
        .replace(/人民币(份额)?|美元(现汇|现钞)?|现汇|现钞|港币/g, '')
        .replace(/\(\s*\)|（\s*）/g, '')
        .replace(/\s*(A|B|C|D|E|F|H|I|O|R|Y|后端)$/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    const sortedLetters = Array.from(letters).sort();
    if (sortedLetters.length > 1 || (sortedLetters.length === 1 && !cleanName.endsWith(sortedLetters[0]))) {
        if (sortedLetters.length > 0) {
            return `${cleanName} ${sortedLetters.join('/')}`;
        }
    }
    return cleanName;
}

export { stem, extractShareLetter };
