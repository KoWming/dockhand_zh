// 汉化进度与完成度统计脚本
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DictFile } from './lib/types.ts';

function main() {
	const dictDir = '规则/词典';
	if (!existsSync(dictDir)) {
		mkdirSync(dictDir, { recursive: true });
		console.log('ℹ️ 已自动创建 规则/词典 目录，当前词典为空。\n');
		return;
	}

	console.log('📊 正在统计 dockhand_zh 汉化完成度...\n');

	let totalEntries = 0;
	let totalTranslated = 0;

	interface ModuleStat {
		name: string;
		total: number;
		translated: number;
		ratio: number;
	}

	const stats: ModuleStat[] = [];

	const files = readdirSync(dictDir)
		.filter((f) => f.endsWith('.json'))
		.sort();

	for (const f of files) {
		const p = join(dictDir, f);
		try {
			const dict = JSON.parse(readFileSync(p, 'utf8')) as DictFile;
			const total = (dict.entries || []).length;
			const translated = (dict.entries || []).filter(
				(e) => e.翻译 && typeof e.翻译 === 'string' && e.翻译.trim().length > 0
			).length;

			totalEntries += total;
			totalTranslated += translated;

			stats.push({
				name: f.replace('.json', ''),
				total,
				translated,
				ratio: total > 0 ? (translated / total) * 100 : 0
			});
		} catch {}
	}

	// 打印按模块维度的表格
	console.log('模块名称'.padEnd(16) + '总词条'.padStart(8) + '已翻译'.padStart(8) + '进度'.padStart(8) + '  可视化');
	console.log('-'.repeat(60));

	for (const s of stats) {
		const barLength = 15;
		const filled = Math.round((s.ratio / 100) * barLength);
		const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
		const name = s.name.padEnd(14);
		const total = String(s.total).padStart(6);
		const trans = String(s.translated).padStart(6);
		const pct = `${s.ratio.toFixed(1)}%`.padStart(7);
		console.log(`${name} ${total} ${trans} ${pct}  [${bar}]`);
	}

	console.log('-'.repeat(60));
	const overallRatio = totalEntries > 0 ? (totalTranslated / totalEntries) * 100 : 0;
	const fullBar = Math.round((overallRatio / 100) * 15);
	const barStr = '█'.repeat(fullBar) + '░'.repeat(15 - fullBar);
	console.log(
		`汇总合计`.padEnd(14) +
			`${String(totalEntries).padStart(6)} ${String(totalTranslated).padStart(6)} ${`${overallRatio.toFixed(1)}%`.padStart(7)}  [${barStr}]`
	);

	// 读取前端快照覆盖率
	const snapshotFiles = existsSync('快照')
		? readdirSync('快照').filter((f) => f.includes('[前端]') && f.endsWith('.json'))
		: [];

	if (snapshotFiles.length > 0 && snapshotFiles[0]) {
		const snapPath = join('快照', snapshotFiles[0]);
		try {
			const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
			const totalSnap = (snap.records || []).length;

			// 收集所有已翻译原文
			const transSet = new Set<string>();
			for (const f of files) {
				const d = JSON.parse(readFileSync(join(dictDir, f), 'utf8')) as DictFile;
				for (const e of d.entries || []) {
					if (e.翻译 && e.翻译.trim()) transSet.add(e.原文.trim());
				}
			}

			let hit = 0;
			for (const r of snap.records || []) {
				if (transSet.has(r.text.trim())) hit++;
			}

			console.log('\n📌 前端全量渲染覆盖基准:');
			console.log(`  - 前端提取文案总计: ${totalSnap} 处`);
			console.log(`  - 当前已命中翻译数: ${hit} 处`);
			console.log(`  - 前端界面综合覆盖率: ${((hit / totalSnap) * 100).toFixed(1)}%`);
		} catch {}
	}
}

main();
