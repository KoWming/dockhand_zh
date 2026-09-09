// 数据结构定义:快照、词典与提取记录
export type Kind = 'text' | 'attr' | 'str' | 'tpl';

export interface RecordItem {
	file: string; // 相对代码根目录的 POSIX 路径
	kind: Kind;
	attr?: string; // 属性名(kind === 'attr' 时有效)
	text: string; // 待翻译原文字符串
	line: number; // 所在行号(1-based)
	start?: number; // 替换起始绝对偏移量(AST 层精确记录)
	end?: number; // 替换结束绝对偏移量(AST 层精确记录)
	context?: string; // 提取语义来源(如 prop:label, call:toast.error, svelte:text)
}

export interface DictEntry {
	原文: string;
	翻译: string;
	kind: Kind;
	attr?: string;
	context?: string;
	n?: number;
}

export interface DictFile {
	scope?: string | string[]; // 生效路径前缀或精确文件路径
	entries: DictEntry[];
}

export interface Snapshot {
	version: string;
	generatedAt: string;
	source: string;
	filter?: { 前端: boolean; 待译: boolean };
	stats: Record<Kind, number>;
	uniqueText: number;
	records: RecordItem[];
}
