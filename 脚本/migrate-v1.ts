// 迁移工具:从旧版 dockhand_zh 规则/词典 或 规则old 中自动将已翻译条目注入 v2 词典
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DictFile } from './lib/types.ts';

function main() {
	// 向上探测寻找旧版目录
	const candidateRoots = [
		resolve(process.cwd(), '../dockhand_zh'),
		resolve(process.cwd(), '../../dockhand_zh'),
		'C:/Users/ZBOM-Geil/Documents/GitHub/dockhand_zh'
	];

	let foundRoot = '';
	for (const r of candidateRoots) {
		if (existsSync(r)) {
			foundRoot = r;
			break;
		}
	}

	if (!foundRoot) {
		console.error('❌ 未找到旧版 dockhand_zh 目录，请检查路径。');
		return;
	}

	console.log(`📂 定位到旧版工程根目录: ${foundRoot}`);

	// 扫描所有旧版词典目录（包括 规则/词典、规则old/词典、规则old 等）
	const searchDirs = [
		join(foundRoot, '规则old/词典'),
		join(foundRoot, '规则old'),
		join(foundRoot, '规则/词典')
	].filter((d) => existsSync(d));

	const translatedMap = new Map<string, string>(); // 原文 -> 翻译
	let totalScannedFiles = 0;

	for (const dir of searchDirs) {
		for (const f of readdirSync(dir)) {
			if (!f.endsWith('.json')) continue;
			const p = join(dir, f);
			if (!statSync(p).isFile()) continue;
			totalScannedFiles++;
			try {
				const content = JSON.parse(readFileSync(p, 'utf8'));
				const entries = Array.isArray(content) ? content : (content.entries || []);
				for (const e of entries) {
					if (e && e.原文 && e.翻译 && typeof e.翻译 === 'string' && e.翻译.trim()) {
						translatedMap.set(e.原文.trim(), e.翻译.trim());
					}
				}
			} catch (err) {
				// 忽略非词典 JSON
			}
		}
	}

	console.log(`🔍 扫描了 ${totalScannedFiles} 个旧版 JSON 文件，成功收集已翻译条目: ${translatedMap.size} 条`);
	if (translatedMap.size === 0) {
		console.log('ℹ️ 旧版暂无已翻译词条，跳过继承。');
		return;
	}

	const v2DictDir = resolve(process.cwd(), '规则/词典');
	if (!existsSync(v2DictDir)) {
		console.error(`❌ v2 词典目录不存在: ${v2DictDir}，请先运行 npm run gen-dicts`);
		return;
	}

	let mergedCount = 0;
	let targetFiles = 0;
	for (const f of readdirSync(v2DictDir).filter((x) => x.endsWith('.json'))) {
		const p = join(v2DictDir, f);
		const dict = JSON.parse(readFileSync(p, 'utf8')) as DictFile;
		let modified = false;
		targetFiles++;

		for (const e of dict.entries) {
			if (!e.翻译 || !e.翻译.trim()) {
				const trans = translatedMap.get(e.原文.trim());
				if (trans) {
					e.翻译 = trans;
					modified = true;
					mergedCount++;
				}
			}
		}

		if (modified) {
			writeFileSync(p, JSON.stringify(dict, null, '\t'), 'utf8');
		}
	}

	console.log(`\n🎉 继承完成！`);
	console.log(`  - 目标词典文件: ${targetFiles} 个`);
	console.log(`  - 成功自动继承填入翻译: ${mergedCount} 条词条`);
}

main();
