import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { env, platform } from 'node:process';
import { getKeplerInstallPaths } from '../../../plus/kepler/keplerProviders.js';
import type { KeplerChannel } from '../../../plus/kepler/keplerService.js';

/** Returns true if the given channel's Kepler app is installed on disk. Node-side implementation. */
export function isKeplerInstalled(channel: KeplerChannel): boolean {
	const paths = getKeplerInstallPaths(channel, platform, {
		home: homedir(),
		localAppData: env.LOCALAPPDATA,
	});
	return paths.some(p => existsSync(p));
}
