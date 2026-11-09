// Browser-side stub for `@env/kepler/keplerInstall`. vscode.dev has no filesystem to probe for, or
// install, a desktop app, so Kepler always reads as not installed and can never be installed.

import type { KeplerInstallOptions, KeplerRelease, KeplerReleaseTarget } from '../../../plus/kepler/keplerRelease.js';
import { KeplerInstallError } from '../../../plus/kepler/keplerRelease.js';
import type { KeplerChannel } from '../../../plus/kepler/keplerService.js';

/** Browser stub — a desktop Kepler install is never detectable in browser builds. Always returns false. */
export function isKeplerInstalled(_channel: KeplerChannel): boolean {
	return false;
}

/** Browser stub — there is no registry to read on the web. Always returns undefined. */
export function findKeplerRegistryInstallLocation(_channel: KeplerChannel): Promise<string | undefined> {
	return Promise.resolve(undefined);
}

/** Browser stub — there is no Launch Services to ask on the web. Always returns undefined. */
export function findKeplerLaunchServicesInstallLocation(_channel: KeplerChannel): Promise<string | undefined> {
	return Promise.resolve(undefined);
}

/** Browser stub — nothing is installable on the web. Always returns undefined. */
export function getKeplerReleaseTargetForHost(): KeplerReleaseTarget | undefined {
	return undefined;
}

/** Browser stub — never called, since Install Kepler is not offered on the web. Always rejects. */
export function getKeplerRelease(_target: KeplerReleaseTarget): Promise<KeplerRelease> {
	return Promise.reject(new KeplerInstallError('unsupported', 'Kepler cannot be installed on the web'));
}

/** Browser stub — never called, since Install Kepler is not offered on the web. Always rejects. */
export function installKepler(_release: KeplerRelease, _options?: KeplerInstallOptions): Promise<string> {
	return Promise.reject(new KeplerInstallError('unsupported', 'Kepler cannot be installed on the web'));
}
