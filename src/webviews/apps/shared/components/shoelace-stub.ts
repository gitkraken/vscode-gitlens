import { registerIconLibrary } from '@awesome.me/webawesome/dist/components/icon/library.js';

/**
 * Web Awesome's built-in `default` and `system` icon libraries resolve icons to URLs which
 * `<wa-icon>` then fetches. VS Code webviews block these fetches under the default CSP,
 * spamming the console.
 *
 * GitLens uses `<code-icon>` (codicons) for all UI iconography. Where a Web Awesome component
 * exposes a slot for its internal icon (e.g. `wa-select[slot="expand-icon"]`), we slot a
 * `<code-icon>` directly. Where it does not, the icon is hidden via CSS in the consumer's
 * stylesheet.
 *
 * Registering empty-resolver `default` and `system` libraries makes `wa-icon` resolve to
 * empty content without any fetch — eliminating the CSP errors without shipping unused SVGs.
 */
let registered = false;
function register(): void {
	if (registered) return;

	registered = true;
	registerIconLibrary('default', { resolver: () => '' });
	registerIconLibrary('system', { resolver: () => '' });
}

register();
