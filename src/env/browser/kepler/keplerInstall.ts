// Browser-side stub for `@env/kepler/keplerInstall`. vscode.dev has no filesystem to probe for a
// desktop app, so Kepler always reads as not installed in browser builds.

import type { KeplerChannel } from '../../../plus/kepler/keplerService.js';

/** Browser stub — a desktop Kepler install is never detectable in browser builds. Always returns false. */
export function isKeplerInstalled(_channel: KeplerChannel): boolean {
	return false;
}
