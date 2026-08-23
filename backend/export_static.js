// 静态数据导出脚本：从 SQLite 中聚合并生成 data/funds.json 供前端静态页面直接读取
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatherAll } from './orchestrator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const OUTPUT_FILE = join(DATA_DIR, 'funds.json');

console.log('[export_static] 开始聚合主流基金数据...');
const startTime = Date.now();

try {
    mkdirSync(DATA_DIR, { recursive: true });

    const funds = gatherAll({ includeExcluded: false });
    const count = Array.isArray(funds) ? funds.length : 0;

    if (count === 0) {
        console.warn('[export_static] 警告: 导出的基金数量为 0，请检查数据库是否存在有效数据。');
    }

    const jsonStr = JSON.stringify(funds);
    writeFileSync(OUTPUT_FILE, jsonStr, 'utf-8');

    const sizeKB = (Buffer.byteLength(jsonStr, 'utf-8') / 1024).toFixed(2);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[export_static] 导出成功！`);
    console.log(`  - 目标路径: ${OUTPUT_FILE}`);
    console.log(`  - 基金总数: ${count} 只`);
    console.log(`  - 文件大小: ${sizeKB} KB`);
    console.log(`  - 耗时: ${duration}s`);
} catch (e) {
    console.error('[export_static] 导出失败:', e);
    process.exit(1);
}
