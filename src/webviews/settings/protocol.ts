import type { WebviewState } from '../protocol.js';

/**
 * Bootstrap state for the Settings webview — metadata only.
 * All data is fetched via RPC (see ./settingsService.ts).
 */
export type State = WebviewState<'gitlens.settings'>;
