// 扫描:对上游源码精准提取 UI 可翻译文案，产出纯净快照 + 覆盖率报告
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
	extractSvelteTemplate,
	extractTypeScriptUI,
	listFiles,
	makeLineLookup,
	toPosix
} from './lib/extract.ts';
import type { Kind, RecordItem, Snapshot } from './lib/types.ts';
import { readOption, resolveUpstream } from './lib/upstream.ts';

const args = process.argv.slice(2);
const ROOT = resolveUpstream(args);
const SRC = join(ROOT, 'src');
const FRONTEND = args.includes('--前端');
const PENDING = args.includes('--待译');
const OUT = readOption(args, 'out');

/** 后端/纯服务端逻辑文件:--前端 时整文件跳过 */
function isBackend(rel: string): boolean {
	if (rel.startsWith('src/lib/server/')) return true;
	if (rel.startsWith('src/routes/api/')) return true;
	const base = rel.slice(rel.lastIndexOf('/') + 1);
	return base.endsWith('.server.ts') || base.endsWith('.test.ts') || base.endsWith('.spec.ts');
}

function readVersion(): string {
	const vFile = join(ROOT, 'VERSION');
	if (existsSync(vFile)) {
		return readFileSync(vFile, 'utf8').trim();
	}
	const pkgFile = join(ROOT, 'package.json');
	if (existsSync(pkgFile)) {
		const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { version?: string };
		return pkg.version ? `v${pkg.version}` : 'unknown';
	}
	return 'unknown';
}

/** 检查文案是否已在词典中翻译 */
function translatedMatcher(): (r: RecordItem) => boolean {
	const clean = (s: string) => s.trim();
	const keys = new Set<string>();

	const dictDir = '规则/词典';
	if (!existsSync(dictDir)) return () => false;

	const files = readdirSync(dictDir).filter((x) => x.endsWith('.json'));
	for (const f of files) {
		try {
			const d = JSON.parse(readFileSync(join(dictDir, f), 'utf8')) as {
				entries?: { 原文: string; 翻译?: string; kind: string; attr?: string }[];
			};
			for (const e of d.entries ?? []) {
				if (!e.翻译) continue;
				keys.add(`${e.kind}|${e.attr ?? ''}|${clean(e.原文)}`);
				keys.add(`${e.kind}||${clean(e.原文)}`);
			}
		} catch {
			// 忽略损坏的单文件
		}
	}

	return (r) =>
		keys.has(`${r.kind}|${r.attr ?? ''}|${clean(r.text)}`) ||
		keys.has(`${r.kind}||${clean(r.text)}`);
}

function main() {
	console.log(`🚀 开始扫描上游源码 [${ROOT}] ...`);
	const version = readVersion();
	const records: RecordItem[] = [];
	let svelteCount = 0;
	let tsCount = 0;
	let parseErrors = 0;

	const isTranslated = translatedMatcher();
	const keep = (abs: string) => !FRONTEND || !isBackend(toPosix(abs.slice(ROOT.length + 1)));

	// 1. 扫描 .svelte 文件
	const svelteFiles = listFiles(SRC, ['.svelte']).filter(keep);
	for (const abs of svelteFiles) {
		const rel = toPosix(abs.slice(ROOT.length + 1));
		const src = readFileSync(abs, 'utf8');
		const fileLineOf = makeLineLookup(src);

		// A. 提取模板 Text 和白名单 Attribute
		const { records: svelteRecs, scripts, parseError } = extractSvelteTemplate(src, rel);
		if (parseError) {
			parseErrors++;
			console.error(`  ❌ Svelte 解析失败 ${rel}: ${parseError.split('\n')[0]}`);
			continue;
		}
		records.push(...svelteRecs);

		// B. 提取 script 内部的 UI 语义
		for (const section of scripts) {
			const scriptUIRecs = extractTypeScriptUI(
				section.content,
				rel,
				section.offset,
				fileLineOf
			);
			records.push(...scriptUIRecs);
		}
		svelteCount++;
	}

	// 2. 扫描 .ts 文件 (UI 逻辑、配置表、Column 定义)
	const tsFiles = listFiles(SRC, ['.ts'])
		.filter((f) => !f.endsWith('.d.ts'))
		.filter(keep);

	for (const abs of tsFiles) {
		const rel = toPosix(abs.slice(ROOT.length + 1));
		const src = readFileSync(abs, 'utf8');
		const tsUIRecs = extractTypeScriptUI(src, rel);
		records.push(...tsUIRecs);
		tsCount++;
	}

	// 3. 过滤待译
	let outputRecords = records;
	if (PENDING) {
		outputRecords = outputRecords.filter((r) => !isTranslated(r));
	}

	// 4. 统计指标
	const stats: Record<Kind, number> = { text: 0, attr: 0, str: 0, tpl: 0 };
	for (const r of outputRecords) {
		stats[r.kind] = (stats[r.kind] ?? 0) + 1;
	}
	const uniqueText = new Set(outputRecords.map((r) => r.text.trim())).size;

	const snapshot: Snapshot = {
		version,
		generatedAt: new Date().toISOString(),
		source: ROOT,
		filter: { 前端: FRONTEND, 待译: PENDING },
		stats,
		uniqueText,
		records: outputRecords
	};

		// 5. 写出快照 (确保目标父级目录自动递归创建)
		const filename =
			OUT ??
			join(
				'快照',
				`${FRONTEND ? '[前端]' : ''}${PENDING ? '[待译]' : ''}清单-${version}.json`
			);
		mkdirSync(dirname(filename), { recursive: true });
		writeFileSync(filename, JSON.stringify(snapshot, null, 2), 'utf8');

	console.log(`\n✨ 扫描完成:`);
	console.log(`  - 源码文件: Svelte ${svelteCount} 个, TS ${tsCount} 个 (错误: ${parseErrors})`);
	console.log(`  - 提取总数: ${outputRecords.length} 条 (去重原文: ${uniqueText} 词)`);
	console.log(`  - 分类统计: Text: ${stats.text}, Attr: ${stats.attr}, UI-Str: ${stats.str}, UI-Tpl: ${stats.tpl}`);
	console.log(`  - 快照产物: ${filename}\n`);
}

main();
