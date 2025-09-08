import { Container } from '../../../../container';
import { run } from '../../git/shell';
import { getPlatform } from '../../platform';

export function toMcpInstallProvider(appHostName: string | undefined): string | undefined {
	switch (appHostName) {
		case 'code':
			return 'vscode';
		case 'code-insiders':
			return 'vscode-insiders';
		case 'code-exploration':
			return 'vscode-exploration';
		default:
			return appHostName;
	}
}

export async function runCLICommand(args: string[], options?: { cwd?: string }): Promise<string> {
	const cwd = options?.cwd ?? Container.instance.storage.get('gk:cli:path');
	if (cwd == null) {
		throw new Error('CLI is not installed');
	}

	const platform = getPlatform();

	return run(platform === 'windows' ? 'gk.exe' : './gk', args, 'utf8', { cwd: cwd });
}
