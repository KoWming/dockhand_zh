// 核心提取模块:Svelte AST (模板) + TypeScript 语义 AST (脚本)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';
import ts from 'typescript';
import type { DictEntry, Kind, RecordItem } from './types.ts';

/** Svelte 模板中的文案属性白名单 */
export const ATTR_WHITELIST = new Set([
	'title',
	'placeholder',
	'aria-label',
	'label',
	'alt',
	'tooltip',
	'emptyText',
	'heading',
	'subtext',
	'description'
]);

/** UI 对象属性名白名单 (只提取其值，绝不提取属性键名) */
export const UI_PROPERTY_NAMES = new Set([
	'label',
	'title',
	'header',
	'description',
	'placeholder',
	'emptyText',
	'tooltip',
	'confirmText',
	'cancelText',
	'badge',
	'help',
	'hint',
	'subtext',
	'heading',
	'message',
	'statusText',
	'buttonText',
	'summary',
	'subtitle',
	'promptText',
	'okText'
]);

/** UI 交互函数/方法调用正则模式 */
const UI_CALL_PATTERNS = [
	/\btoast\.(success|error|info|warning|default)\b/,
	/\bshowToast\b/,
	/\bnotify\b/,
	/\balert\b/,
	/\bconfirm\b/,
	/\bopenConfirmModal\b/,
	/\bopenModal\b/,
	/\baddToast\b/,
	/\bcreateNotification\b/
];

interface AnyNode {
	type?: string;
	start?: number;
	end?: number;
	data?: string;
	name?: string;
	value?: unknown;
	content?: string;
	[key: string]: unknown;
}

export function toPosix(p: string): string {
	return p.replaceAll('\\', '/');
}

export function listFiles(root: string, suffixes: string[]): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const e of readdirSync(dir)) {
			const p = join(dir, e);
			if (statSync(p).isDirectory()) walk(p);
			else if (suffixes.some((s) => e.endsWith(s))) out.push(p);
		}
	};
	walk(root);
	return out;
}

/** 行号查找器:每个文件建一次索引 */
export function makeLineLookup(src: string): (pos: number) => number {
	const starts = [0];
	for (let i = 0; i < src.length; i++) {
		if (src.charCodeAt(i) === 10) starts.push(i + 1);
	}
	return (pos: number) => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if ((starts[mid] as number) <= pos) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};
}

/** 识别技术性噪音与无须翻译的字面量 */
export function isNoise(text: string, kind?: Kind): boolean {
	const trimmed = text.trim();
	if (!trimmed) return true;
	// 纯符号或数字
	if (!/[A-Za-z]/.test(trimmed)) return true;
	// 单字符
	if (trimmed.length <= 1) return true;
	// URL / 协议 (含单行及多行协议示例)
	if (/^(https?:\/\/|wss?:\/\/|mailto:|data:|blob:|\/api\/)/.test(trimmed)) return true;
	if (trimmed.includes('://') && trimmed.split('\n').filter((l) => l.includes('://')).length >= 2) return true;
	// 文件名 / 路径
	if (/^(\/|\.\/|\.\.\/)/.test(trimmed)) return true;
	if (/\.(png|jpe?g|svg|webp|woff2?|ttf|css|scss|js|ts|json|yaml|yml|md)$/i.test(trimmed)) return true;
	// 键盘按键
	if (/^(Enter|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Tab|Space|Backspace|Delete|Home|End|PageUp|PageDown)$/.test(trimmed)) {
		return true;
	}
	// 时区常量
	if (/^(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//.test(trimmed)) {
		return true;
	}
	// 纯大写代码常量 (如 GET, POST, DOCKER_HOST)
	if (/^[A-Z0-9_]{3,}$/.test(trimmed)) return true;
	// 驼峰变量名且无空格 (如 containerList, isFetchingData)
	if (/^[a-z]+[A-Z0-9][a-zA-Z0-9]*$/.test(trimmed)) return true;
	// Tailwind CSS 类串特征 (含多个短横线类名、hover:、dark: 等)
	if (kind === 'str' && (trimmed.includes('hover:') || trimmed.includes('dark:') || trimmed.includes('bg-') || trimmed.includes('text-') || trimmed.includes('border-'))) {
		const tokens = trimmed.split(/\s+/);
		if (tokens.length >= 2 && tokens.every((t) => /^[a-z0-9:\-[\]/]+$/.test(t))) return true;
	}
	// 常见 HTTP Header
	if (kind === 'str' && /^(Content-Type|Authorization|Accept|User-Agent|X-[A-Za-z0-9-]+)$/i.test(trimmed)) {
		return true;
	}
	return false;
}

/** 递归遍历通用节点 */
function walkNode(node: unknown, parent: AnyNode | null, visit: (n: AnyNode, p: AnyNode | null) => void): void {
	if (!node || typeof node !== 'object') return;
	const n = node as AnyNode;
	if (typeof n.type !== 'string') return;
	visit(n, parent);
	for (const key of Object.keys(n)) {
		if (key === 'start' || key === 'end' || key === 'parent') continue;
		const v = n[key];
		if (Array.isArray(v)) {
			for (const c of v) walkNode(c, n, visit);
		} else if (v && typeof v === 'object' && typeof (v as AnyNode).type === 'string') {
			walkNode(v, n, visit);
		}
	}
}

export interface SvelteScriptSection {
	content: string;
	offset: number; // 在原 .svelte 文件中的字符起点
}

/** 解析 .svelte 模板中的可见 UI 文本和白名单属性 */
export function extractSvelteTemplate(src: string, relFile: string): {
	records: RecordItem[];
	scripts: SvelteScriptSection[];
	parseError?: string;
} {
	const lineOf = makeLineLookup(src);
	const records: RecordItem[] = [];
	const scripts: SvelteScriptSection[] = [];
	let ast: AnyNode;

	try {
		ast = parse(src, { filename: relFile }) as unknown as AnyNode;
	} catch (e) {
		return { records, scripts, parseError: String(e) };
	}

	const visit = (n: AnyNode, parent: AnyNode | null) => {
		// 收集 Script 标签供 AST 语义分析
		if (n.type === 'Script' && typeof n.start === 'number' && typeof n.end === 'number') {
			const fullTag = src.slice(n.start, n.end);
			const openTagEnd = fullTag.indexOf('>') + 1;
			const closeTagStart = fullTag.lastIndexOf('</script>');
			if (openTagEnd > 0 && closeTagStart > openTagEnd) {
				const inner = fullTag.slice(openTagEnd, closeTagStart);
				scripts.push({
					content: inner,
					offset: n.start + openTagEnd
				});
			}
			return;
		}

		// 白名单属性
		if (n.type === 'Attribute' && Array.isArray(n.value) && n.value.length > 0) {
			const parts = n.value as AnyNode[];
			if (!parts.every((p) => p.type === 'Text' && typeof p.data === 'string')) return;
			const attrName = n.name ?? '';
			if (!ATTR_WHITELIST.has(attrName)) return;

			const text = parts.map((p) => p.data as string).join('');
			if (text.trim() && !isNoise(text, 'attr')) {
				const first = parts[0]!;
				const last = parts[parts.length - 1]!;
				records.push({
					file: relFile,
					kind: 'attr',
					attr: attrName,
					text,
					line: lineOf(n.start ?? 0),
					start: first.start,
					end: last.end,
					context: `attr:${attrName}`
				});
			}
			return;
		}

		// 静态 Text 节点
		if (n.type === 'Text' && typeof n.data === 'string' && parent?.type !== 'Attribute') {
			const raw = n.data;
			const trimmed = raw.trim();
			if (trimmed && !isNoise(trimmed, 'text')) {
				const lead = raw.length - raw.trimStart().length;
				const trail = raw.length - raw.trimEnd().length;
				records.push({
					file: relFile,
					kind: 'text',
					text: trimmed,
					line: lineOf(n.start ?? 0),
					start: (n.start ?? 0) + lead,
					end: (n.end ?? 0) - trail,
					context: 'svelte:text'
				});
			}
		}
	};

	for (const key of Object.keys(ast)) {
		const child = ast[key];
		if (Array.isArray(child)) {
			for (const c of child) walkNode(c, null, visit);
		} else if (child && typeof child === 'object') {
			walkNode(child, null, visit);
		}
	}

	return { records, scripts };
}

/** 利用 TypeScript 语义 AST 精确提取 TS/JS 脚本中的 UI 文案 */
export function extractTypeScriptUI(
	code: string,
	relFile: string,
	globalOffset = 0,
	fileLineOf?: (pos: number) => number
): RecordItem[] {
	const sourceFile = ts.createSourceFile(
		relFile,
		code,
		ts.ScriptTarget.Latest,
		/* setParentNodes */ true,
		ts.ScriptKind.TS
	);

	const records: RecordItem[] = [];
	const lineOf = fileLineOf ?? makeLineLookup(code);

	function visit(node: ts.Node) {
		// 1. 提取 UI 对象属性值 (如 { label: "Container Name", title: "..." })
		if (ts.isPropertyAssignment(node)) {
			let propName = '';
			if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) {
				propName = node.name.text;
			}
			if (UI_PROPERTY_NAMES.has(propName)) {
				const init = node.initializer;
				if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
					const text = init.text;
					if (!isNoise(text, 'str')) {
						const start = globalOffset + init.getStart(sourceFile) + 1;
						const end = globalOffset + init.getEnd() - 1;
						records.push({
							file: relFile,
							kind: 'str',
							text,
							line: lineOf(globalOffset + init.getStart(sourceFile)),
							start,
							end,
							context: `prop:${propName}`
						});
					}
				} else if (ts.isTemplateExpression(init)) {
					// 模板串
					const raw = init.getText(sourceFile);
					const body = raw.slice(1, -1);
					if (!isNoise(body, 'tpl')) {
						records.push({
							file: relFile,
							kind: 'tpl',
							text: body,
							line: lineOf(globalOffset + init.getStart(sourceFile)),
							context: `prop:${propName}`
						});
					}
				}
			}
		}

		// 2. 提取 UI 交互函数调用实参 (如 toast.error("Failed to delete"), notify("..."))
		if (ts.isCallExpression(node)) {
			const exprText = node.expression.getText(sourceFile);
			const isUiCall = UI_CALL_PATTERNS.some((pat) => pat.test(exprText));
			if (isUiCall && node.arguments.length > 0) {
				const firstArg = node.arguments[0]!;
				if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
					const text = firstArg.text;
					if (!isNoise(text, 'str')) {
						const start = globalOffset + firstArg.getStart(sourceFile) + 1;
						const end = globalOffset + firstArg.getEnd() - 1;
						records.push({
							file: relFile,
							kind: 'str',
							text,
							line: lineOf(globalOffset + firstArg.getStart(sourceFile)),
							start,
							end,
							context: `call:${exprText}`
						});
					}
				} else if (ts.isTemplateExpression(firstArg)) {
					const raw = firstArg.getText(sourceFile);
					const body = raw.slice(1, -1);
					if (!isNoise(body, 'tpl')) {
						records.push({
							file: relFile,
							kind: 'tpl',
							text: body,
							line: lineOf(globalOffset + firstArg.getStart(sourceFile)),
							context: `call:${exprText}`
						});
					}
				}
			}
		}

		// 3. 提取前端可读的错误构造 (new Error("Unable to connect to Docker daemon"))
		if (ts.isNewExpression(node)) {
			const exprText = node.expression.getText(sourceFile);
			if (exprText === 'Error' && node.arguments && node.arguments.length > 0) {
				const arg = node.arguments[0]!;
				if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
					const text = arg.text;
					// 必须包含空格、长度适中，证明是人类可读的英文短语，而非内部错误代号
					if (text.includes(' ') && text.length >= 8 && !isNoise(text, 'str')) {
						const start = globalOffset + arg.getStart(sourceFile) + 1;
						const end = globalOffset + arg.getEnd() - 1;
						records.push({
							file: relFile,
							kind: 'str',
							text,
							line: lineOf(globalOffset + arg.getStart(sourceFile)),
							start,
							end,
							context: 'new:Error'
						});
					}
				}
			}
		}

		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	return records;
}

// ---------------- 词典加载与匹配 ----------------

export function entryKey(kind: Kind, attr: string | undefined, text: string): string {
	return `${kind}|${attr ?? ''}|${text.trim()}`;
}

function scopeOne(scope: string, relFile: string): boolean {
	if (scope === '**') return true;
	const prefix = scope.endsWith('/**') ? scope.slice(0, -3) : scope;
	return relFile === prefix || relFile.startsWith(prefix + '/');
}

export function scopeMatches(scope: string | string[] | undefined, relFile: string): boolean {
	if (!scope || scope.length === 0) return true;
	if (Array.isArray(scope)) return scope.some((s) => scopeOne(s, relFile));
	return scopeOne(scope, relFile);
}

export interface DictMatcher {
	match(kind: Kind, attr: string | undefined, text: string, relFile: string): string | undefined;
	markHit(original: string): void;
	hitOriginals(): Set<string>;
	allEntries(): { entry: DictEntry; scope: string | string[]; from: string }[];
}

export function loadDictionaries(dir: string): DictMatcher {
	const hitSet = new Set<string>();
	const candidates = new Map<
		string,
		{ translation: string; scope: string | string[]; scopeLen: number; scopeKey: string; from: string; original: string }[]
	>();

	const scopeLength = (s: string | string[]): number =>
		Array.isArray(s) ? Math.max(0, ...s.map((x) => x.length)) : s.length;

	for (const f of listFiles(dir, ['.json'])) {
		const dict = JSON.parse(readFileSync(f, 'utf8')) as { scope?: string | string[]; entries?: DictEntry[] };
		const from = toPosix(f);
		const scopeVal = dict.scope ?? '**';
		const scopeKey = JSON.stringify(scopeVal);
		const scopeLen = scopeLength(scopeVal);

		for (const e of dict.entries ?? []) {
			if (!e.原文 || !e.翻译) continue;
			const key = entryKey(e.kind, e.attr, e.原文);
			const list = candidates.get(key) ?? [];
			for (const dup of list) {
				if (dup.scopeKey === scopeKey && dup.translation !== e.翻译) {
					throw new Error(`词典冲突: ${key} 在 ${dup.from} 与 ${from} 中 scope 相同但译文不同`);
				}
			}
			list.push({ translation: e.翻译, scope: scopeVal, scopeLen, scopeKey, from, original: e.原文 });
			candidates.set(key, list);
		}
	}

	const resolve = (key: string, relFile: string) => {
		const list = candidates.get(key);
		if (!list) return undefined;
		const applicable = list.filter((c) => scopeMatches(c.scope, relFile));
		if (applicable.length === 0) return undefined;
		applicable.sort((a, b) => b.scopeLen - a.scopeLen);
		return applicable[0]!;
	};

	return {
		match(kind, attr, text, relFile) {
			if (kind === 'attr' && attr) {
				const specific = resolve(entryKey(kind, attr, text), relFile);
				if (specific) {
					hitSet.add(specific.original);
					return specific.translation;
				}
			}
			const wild = resolve(entryKey(kind, undefined, text), relFile);
			if (wild) hitSet.add(wild.original);
			return wild?.translation;
		},
		markHit(original: string) {
			hitSet.add(original);
		},
		hitOriginals: () => hitSet,
		allEntries() {
			const out: { entry: DictEntry; scope: string | string[]; from: string }[] = [];
			for (const f of listFiles(dir, ['.json'])) {
				const dict = JSON.parse(readFileSync(f, 'utf8')) as { scope?: string | string[]; entries?: DictEntry[] };
				for (const e of dict.entries ?? []) {
					out.push({ entry: e, scope: dict.scope ?? '**', from: toPosix(f) });
				}
			}
			return out;
		}
	};
}

