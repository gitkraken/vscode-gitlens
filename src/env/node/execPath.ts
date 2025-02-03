import { resolve } from 'path';
import { env } from 'vscode';
import { getPlatform } from './platform';

export function getExecPath(): string {
	if (env.appHost !== 'desktop') {
		throw new Error('Cannot get exec path for not desktop runtime');
	}
	switch (getPlatform()) {
		case 'windows':
			// tested with vscode portable (from zip) https://code.visualstudio.com/docs/editor/portable#_enable-portable-mode
			return resolve(env.appRoot, '../../bin/code').replace(/\\/g, '/');
		case 'linux':
			return resolve(env.appRoot, '../../bin/code');
		case 'macOS':
			return resolve(env.appRoot, 'bin/code');
		default:
			break;
	}
	switch (env.appName) {
		case 'Visual Studio Code - Insiders':
			return 'code-insiders';
		case 'Visual Studio Code - Exploration':
			return 'code-exploration';
		case 'VSCodium':
			return 'codium';
		case 'Cursor':
			return 'cursor';
		default:
			return 'code';
	}
}
