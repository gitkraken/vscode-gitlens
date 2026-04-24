import { registerIconLibrary } from '@shoelace-style/shoelace/dist/utilities/icon-library.js';

/**
 * Shoelace's built-in `system` icon library resolves icons to `data:image/svg+xml,...` URLs
 * which `<sl-icon>` then fetches via `fetch(url, { mode: 'cors' })`. VS Code webviews block
 * these fetches under the default CSP, spamming the console.
 *
 * GitLens uses `<code-icon>` (codicons) for all UI iconography. Where a Shoelace component
 * exposes a slot for its internal icon (e.g. `sl-select[slot="expand-icon"]`), we slot a
 * `<code-icon>` directly. Where it does not (e.g. `sl-option`'s `checked-icon` part), the
 * icon is hidden via CSS in the consumer's stylesheet.
 *
 * Registering an empty-resolver `system` library makes `sl-icon` set its SVG to null without
 * any fetch — eliminating the CSP errors without shipping unused Bootstrap-icon SVGs.
 */
let registered = false;
function register(): void {
	if (registered) return;
	registered = true;
	registerIconLibrary('system', { resolver: () => '' });
}

register();
