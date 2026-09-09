// 从扫描快照批量生成各页面模块词典骨架
// 特色:
// 1. 已有翻译条目 100% 原样保留，新词条自动追加
// 2. 携带提取上下文 (context: prop:label, call:toast.error 等)，方便翻译理解语境
// 3. 支持 --清理 剔除已失效且未翻译的空骨架
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DictEntry, DictFile, Kind, RecordItem, Snapshot } from './lib/types.ts';

interface GeneratedEntry extends DictEntry {
	n: number; // 该词在该模块出现的次数
}

const MODULES: { file: string; scope: string | string[] }[] = [
	{ file: '基础组件.json', scope: 'src/lib/components/ui' },
	{ file: '设置页.json', scope: 'src/routes/settings' },
	{ file: '容器页.json', scope: 'src/routes/containers' },
	{ file: '共享组件.json', scope: 'src/lib/components' },
	{ file: '堆栈页.json', scope: 'src/routes/stacks' },
	{ file: '镜像页.json', scope: 'src/routes/images' },
	{ file: '网络页.json', scope: 'src/routes/networks' },
	{ file: '备份页.json', scope: 'src/routes/backups' },
	{ file: '计划任务页.json', scope: 'src/routes/schedules' },
	{ file: '存储卷页.json', scope: 'src/routes/volumes' },
	{ file: '个人资料页.json', scope: 'src/routes/profile' },
	{ file: '日志页.json', scope: 'src/routes/logs' },
	{ file: '审计页.json', scope: 'src/routes/audit' },
	{ file: '活动页.json', scope: 'src/routes/activity' },
	{ file: '镜像仓库页.json', scope: 'src/routes/registry' },
	{ file: '仪表盘.json', scope: 'src/routes/dashboard' },
	{ file: '环境页.json', scope: 'src/routes/environments' },
	{ file: '终端页.json', scope: 'src/routes/terminal' },
	{ file: '模板页.json', scope: 'src/routes/templates' },
	{ file: '登录页.json', scope: 'src/routes/login' },
	{ file: '监控页.json', scope: 'src/routes/metrics' },
	{ file: '告警页.json', scope: 'src/routes/alerts' },
	{ file: 'lib其他.json', scope: 'src/lib' },
	{ file: '通用页.json', scope: 'src/routes' }
];

function matchScope(scope: string | string[], relFile: string): boolean {
	if (Array.isArray(scope)) return scope.some((s) => relFile === s || relFile.startsWith(s + '/'));
	return relFile === scope || relFile.startsWith(scope + '/');
}

function latestSnapshot(): string {
	if (!existsSync('快照')) throw new Error('快照目录不存在，请先执行 npm run scan:fe');
	const files = readdirSync('快照')
		.filter((f) => f.endsWith('.json') && !f.includes('待译'))
		.sort();
	if (files.length === 0) throw new Error('快照/ 下没有清单 json，请先运行 npm run scan:fe');
	return join('快照', files[files.length - 1]!);
}

function loadExistingDict(file: string): DictFile | undefined {
	const p = join('规则/词典', file);
	if (!existsSync(p)) return undefined;
	return JSON.parse(readFileSync(p, 'utf8')) as DictFile;
}

function main() {
	const args = process.argv.slice(2);
	const doPrune = args.includes('--清理');

	const snapPath = latestSnapshot();
	console.log(`📖 读取最新快照: ${snapPath}`);
	const snap = JSON.parse(readFileSync(snapPath, 'utf8')) as Snapshot;

	mkdirSync('规则/词典', { recursive: true });

	// 排除模板串 tpl (模板串需单独做插值处理，不作为静态词典)
	const validRecords = snap.records.filter((r) => r.kind !== 'tpl');

	// 分配记录到各模块
	const unassigned: RecordItem[] = [];
	const assignedByModule = new Map<string, RecordItem[]>();
	for (const m of MODULES) {
		assignedByModule.set(m.file, []);
	}

	for (const r of validRecords) {
		let found = false;
		for (const m of MODULES) {
			if (matchScope(m.scope, r.file)) {
				assignedByModule.get(m.file)!.push(r);
				found = true;
				break;
			}
		}
		if (!found) unassigned.push(r);
	}

	let totalNewEntries = 0;
	let totalExistingEntries = 0;

	for (const m of MODULES) {
		const recs = assignedByModule.get(m.file) ?? [];
		const existingDict = loadExistingDict(m.file);

		// key: `${kind}|${attr || ''}|${原文}`
		const keyOf = (kind: Kind, attr: string | undefined, text: string) =>
			`${kind}|${attr ?? ''}|${text.trim()}`;

		const existingMap = new Map<string, DictEntry>();
		if (existingDict) {
			for (const e of existingDict.entries) {
				existingMap.set(keyOf(e.kind, e.attr, e.原文), e);
			}
		}

		// 聚合当前快照中的条目
		const currentCounts = new Map<string, { item: RecordItem; count: number }>();
		for (const r of recs) {
			const k = keyOf(r.kind, r.attr, r.text);
			const cur = currentCounts.get(k);
			if (cur) {
				cur.count++;
			} else {
				currentCounts.set(k, { item: r, count: 1 });
			}
		}

		// 生成最终词典条目列表
		const entries: GeneratedEntry[] = [];

		// 1. 保留已有词典中已翻译的条目
		for (const [k, e] of existingMap) {
			const count = currentCounts.get(k)?.count ?? 0;
			// 若存在翻译，无论快照是否还在都保留
			if (e.翻译 && e.翻译.trim()) {
				entries.push({
					原文: e.原文,
					翻译: e.翻译,
					kind: e.kind,
					attr: e.attr,
					context: e.context,
					n: count
				});
				totalExistingEntries++;
			} else if (!doPrune && count > 0) {
				// 未翻译且在当前快照中存在
				entries.push({
					原文: e.原文,
					翻译: '',
					kind: e.kind,
					attr: e.attr,
					context: e.context,
					n: count
				});
			}
		}

		// 2. 追加快照中新出现的条目
		for (const [k, { item, count }] of currentCounts) {
			if (!existingMap.has(k)) {
				entries.push({
					原文: item.text.trim(),
					翻译: '',
					kind: item.kind,
					attr: item.attr,
					context: item.context,
					n: count
				});
				totalNewEntries++;
			}
		}

		// 排序:按出现频次降序，频次相同按原文升序
		entries.sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.原文.localeCompare(b.原文));

		const dictFile: DictFile = {
			scope: existingDict?.scope ?? m.scope,
			entries
		};

		writeFileSync(join('规则/词典', m.file), JSON.stringify(dictFile, null, '\t'), 'utf8');
	}

	console.log(`\n🎉 词典骨架生成完毕:`);
	console.log(`  - 模块文件: ${MODULES.length} 个`);
	console.log(`  - 已保留翻译: ${totalExistingEntries} 条`);
	console.log(`  - 新追加条目: ${totalNewEntries} 条`);
	if (unassigned.length > 0) {
		console.log(`  ⚠️ 未分配记录: ${unassigned.length} 条 (请检查 MODULES 配置)`);
	}
}

main();
