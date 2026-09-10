// 应用:把词典 + 定点补丁精准应用到上游源码,写出到 output/(完整可构建的汉化产物)
// 保证原版源码只读，支持幂等反复执行
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import MagicString from 'magic-string';
import { parse } from 'svelte/compiler';
import {
	extractSvelteTemplate,
	listFiles,
	loadDictionaries,
	scopeMatches,
	toPosix,
	type DictMatcher
} from './lib/extract.ts';
import type { DictEntry } from './lib/types.ts';
import { resolveUpstream } from './lib/upstream.ts';

const ROOT = resolveUpstream();
const OUT = join(process.cwd(), 'output');
const SRC = join(ROOT, 'src');

interface AnchorPatch {
	file: string; // 相对 ROOT 的 POSIX 路径
	查找: string;
	替换为: string;
	说明?: string;
}

const updated = new Map<string, string>(); // rel -> 累积修改后的内容
const errors: string[] = [];

function current(rel: string): string {
	return updated.get(rel) ?? readFileSync(join(ROOT, rel), 'utf8');
}

/** 显式递归拷贝:替代 fs.cpSync (防止 Windows GBK 环境原生崩溃) */
function copyTree(src: string, dest: string): void {
	mkdirSync(dest, { recursive: true });
	for (const e of readdirSync(src, { withFileTypes: true })) {
		const s = join(src, e.name);
		const d = join(dest, e.name);
		if (e.isDirectory()) {
			copyTree(s, d);
		} else if (e.isFile()) {
			copyFileSync(s, d);
		}
	}
}

// 1. 应用定点补丁
function applyPatches() {
	const patchFile = '规则/定点补丁.json';
	if (!existsSync(patchFile)) return;

	const patches = JSON.parse(readFileSync(patchFile, 'utf8')) as AnchorPatch[];
	for (const p of patches) {
		const rel = toPosix(p.file);
		let content: string;
		try {
			content = readFileSync(join(ROOT, rel), 'utf8');
		} catch {
			errors.push(`定点补丁: 文件不存在 ${p.file} (${p.说明 ?? ''})`);
			continue;
		}
		const n = content.split(p.查找).length - 1;
		if (n === 0) {
			errors.push(
				`定点补丁: 锚点未命中 ${p.file} 中的 [${p.查找.slice(0, 60)}] (${p.说明 ?? ''})`
			);
			continue;
		}
		updated.set(rel, current(rel).replaceAll(p.查找, p.替换为));
		console.log(`  ✅ 定点补丁 [${p.说明 ?? p.file}] 替换 ${n} 处`);
	}
}

// 2. 应用脚本字符串字面量 (kind === 'str')
function applyStringLiterals(
	matcher: DictMatcher,
	entries: { entry: DictEntry; scope: string | string[] }[],
	allFiles: string[]
) {
	for (const { entry, scope } of entries) {
		if (entry.kind !== 'str' || !entry.翻译) continue;

		if (/['"`\\]/.test(entry.原文)) {
			// 含未转义特殊字符的跳过并告警
			continue;
		}

		let total = 0;
		for (const rel of allFiles) {
			if (!scopeMatches(scope, rel)) continue;
			let content = current(rel);
			let n = 0;

			for (const q of ["'", '"', '`']) {
				const needle = q + entry.原文 + q;
				let searchFrom = 0;
				while (true) {
					const pos = content.indexOf(needle, searchFrom);
					if (pos === -1) break;

					// 跳过对象键名:如果后面紧跟着冒号，且前面不是三元运算符 ?，表示它是 key 而非 UI 显示值
					const after = content.slice(pos + needle.length).trimStart();
					const before = content.slice(0, pos).trimEnd();
					if (after.startsWith(':') && (!before.endsWith('?') || before.endsWith('??'))) {
						searchFrom = pos + needle.length;
						continue;
					}

					content =
						content.slice(0, pos) + q + entry.翻译 + q + content.slice(pos + needle.length);
					n++;
					searchFrom = pos + q.length + entry.翻译.length + q.length;
				}
			}

			if (n > 0) {
				updated.set(rel, content);
				total += n;
			}
		}

		if (total > 0) matcher.markHit(entry.原文);
	}
}

// 3. 应用 Svelte 模板层 (Text 节点与白名单 Attribute)
function applySvelteAst(matcher: DictMatcher, svelteFiles: string[]) {
	for (const rel of svelteFiles) {
		const rawContent = current(rel);
		const { records, parseError } = extractSvelteTemplate(rawContent, rel);
		if (parseError) {
			errors.push(`Svelte 解析失败 ${rel}: ${parseError.split('\n')[0]}`);
			continue;
		}

		const ms = new MagicString(rawContent);
		let changed = false;

		for (const r of records) {
			if (r.kind !== 'text' && r.kind !== 'attr') continue;
			const tr = matcher.match(r.kind, r.attr, r.text, rel);
			if (tr === undefined || r.start === undefined || r.end === undefined) continue;

			ms.update(r.start, r.end, tr);
			changed = true;
		}

		if (!changed) continue;

		const final = ms.toString();
		// 校验写回安全性:改后的 Svelte 源码必须依然能够正常 parse
		try {
			parse(final, { filename: rel });
		} catch (e) {
			errors.push(`写回语法校验失败 ${rel}: ${String(e).split('\n')[0]}`);
			continue;
		}

		updated.set(rel, final);
	}
}

// 4. 生成 Tailwind 扫描清单
function genTailwindSources(): void {
	const srcDir = join(OUT, 'src');
	if (!existsSync(srcDir)) return;

	const sources: string[] = [];
	const collect = (dir: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) {
				collect(p);
			} else if (/\.(svelte|html|ts|js)$/.test(e.name)) {
				const rel = toPosix(p.slice(srcDir.length + 1));
				sources.push(`@source "./${rel}";`);
			}
		}
	};

	collect(srcDir);
	const target = join(srcDir, 'tw-sources.gen.css');
	writeFileSync(target, sources.join('\n') + '\n', 'utf8');
	console.log(`  🎨 已生成 Tailwind 单文件样式清单 (${sources.length} 个源文件)`);
}

function main() {
	console.log('\n================== 开始执行汉化流水线 (apply) ==================');
	console.log(`上游只读源: ${ROOT}`);
	console.log(`输出目标:   ${OUT}`);

	// 1. 定点补丁
	applyPatches();

	// 2. 收集源文件
	const svelteFiles = listFiles(SRC, ['.svelte']).map((abs) =>
		toPosix(abs.slice(ROOT.length + 1))
	);
	const tsFiles = listFiles(SRC, ['.ts'])
		.filter((abs) => !abs.endsWith('.d.ts'))
		.map((abs) => toPosix(abs.slice(ROOT.length + 1)));

	// 3. 加载词典
	const matcher = loadDictionaries('规则/词典');
	const entries = matcher
		.allEntries()
		.filter(({ entry }) => Boolean(entry.翻译))
		.map(({ entry, scope }) => ({ entry, scope }));

	console.log(`📚 已加载有效翻译词条: ${entries.length} 条`);

	// 4. 执行替换
	applyStringLiterals(matcher, entries, [...svelteFiles, ...tsFiles]);
	applySvelteAst(matcher, svelteFiles);

	// 5. 校验门禁
	if (errors.length > 0) {
		console.error(`\n❌ 检测到 ${errors.length} 处错误，已安全阻断，未写出任何文件:`);
		for (const e of errors) console.error('  - ' + e);
		process.exit(1);
	}

		// 6. 全量重建输出目录 (保留 node_modules 提速)
		try {
			mkdirSync(OUT, { recursive: true });
			mkdirSync(join(OUT, 'bin'), { recursive: true });
				for (const e of readdirSync(OUT)) {
					if (e === 'node_modules' || e === 'bin' || e === '.svelte-kit' || e === 'package-lock.json' || e === 'BRANCH') continue;
					rmSync(join(OUT, e), { recursive: true, force: true });
				}
		} catch (err) {
			errors.push(`清理 output 目录失败: ${String(err).split('\n')[0]}`);
		}

		// 7. 拷贝上游树并覆写汉化文件
		copyTree(ROOT, OUT);
		let writeCount = 0;
		for (const [rel, content] of updated) {
			const targetFile = join(OUT, rel);
			mkdirSync(dirname(targetFile), { recursive: true });
			writeFileSync(targetFile, content, 'utf8');
			writeCount++;
		}

		// 8. 补全 Tailwind 样式清单
		genTailwindSources();

		// 9. 写入构建分支标识 (避免 shallow clone 时出现孤零零的 HEAD)
		writeFileSync(join(OUT, 'BRANCH'), 'main\n', 'utf8');

	console.log(`\n🎉 汉化产物生成成功:`);
	console.log(`  - 累计修改文件: ${writeCount} 个`);
	console.log(`  - 完整产物目录: ${OUT}\n`);
}

main();
