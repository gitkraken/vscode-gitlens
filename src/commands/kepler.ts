import { urls } from '../constants.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { GlCommandBase } from './commandBase.js';

// The surface-agnostic "Get Kepler" CTA, used by the Settings and Graph sidebar banners.
//
// Named `getKepler`, not `openKepler`: this opens Kepler's *product page* in a browser, it does not
// open Kepler itself. `gitlens.openKepler` (and the matching `kepler/opened` event) are deliberately
// left free for deep linking into an installed Kepler, which is the semantic a reader expects from
// "open" and which we expect to add.
//
// Distinct from `WelcomeOpenKeplerCommand` (`./welcome.js`), which is welcome-page-specific and
// reports through that page's own `welcome/action` event.

@command()
export class GetKeplerCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.getKepler');
	}

	execute(src?: Source): void {
		this.container.telemetry.sendEvent('kepler/productPage/opened', undefined, src);
		void openUrl(urls.kepler);
	}
}
