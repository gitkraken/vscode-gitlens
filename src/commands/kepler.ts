import { urls } from '../constants.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { GlCommandBase } from './commandBase.js';

// The surface-agnostic "Get Kepler" CTA, used by the Settings and Graph sidebar banners.
//
// Named `openProductPage`, not `openKepler`: this opens Kepler's *product page* in a browser, it
// does not open Kepler itself. The `gitlens.kepler.*` namespace is for deep linking into an
// installed Kepler (`gitlens.kepler.startReview`, `.newTask`, …) — a separate, larger command
// surface than the single-command `gitlens.openKepler` this used to reserve for that purpose.
//
// Distinct from `WelcomeOpenKeplerCommand` (`./welcome.js`), which is welcome-page-specific and
// reports through that page's own `welcome/action` event.

@command()
export class KeplerOpenProductPageCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.kepler.openProductPage');
	}

	execute(src?: Source): void {
		this.container.telemetry.sendEvent('kepler/productPage/opened', undefined, src);
		void openUrl(urls.kepler);
	}
}
