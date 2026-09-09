// 上游源码定位:支持 --src=<dir>、环境变量 DH_SRC、当前代码/、或自动回退至旧项目 ../dockhand_zh/代码
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** 读取 --name=<值> 或 --name <值> 形式的命令行选项 */
export function readOption(argv: string[], name: string): string | undefined {
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i] as string;
		if (a === `--${name}`) return argv[i + 1];
		if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
	}
	return undefined;
}

export function resolveUpstream(argv: string[] = process.argv.slice(2), env = process.env): string {
	const cliSrc = readOption(argv, 'src') ?? env.DH_SRC;
	if (cliSrc) {
		const abs = isAbsolute(cliSrc) ? cliSrc : resolve(cliSrc);
		if (!existsSync(abs) || !statSync(abs).isDirectory()) {
			throw new Error(`指定的上游源码目录不存在: ${abs}`);
		}
		return abs;
	}

	// 候选查找顺序
	const candidates = [
		resolve('代码'),
		resolve('../dockhand_zh/代码'),
		resolve('../../dockhand_zh/代码')
	];

		for (const candidate of candidates) {
			if (existsSync(candidate) && statSync(candidate).isDirectory()) {
				return candidate;
			}
		}

		// 若均不存在，自动为用户创建本工程下的 代码/ 目录并给出引导
		const defaultDir = resolve('代码');
		mkdirSync(defaultDir, { recursive: true });

		throw new Error(
			`未找到上游源码。已自动为您创建 ${defaultDir} 目录，请将上游代码 (https://github.com/Finsys/dockhand) 克隆或解压至该目录，或使用 --src=<路径> 指定。`
		);
}
