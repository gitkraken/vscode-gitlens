import { css, html, LitElement } from 'lit';
import { customElement, query } from 'lit/decorators.js';
import { elementBase, linkBase } from '../../../shared/components/styles/lit/base.css.js';
import type { GlAccountChip } from './account-chip.js';
import './account-chip.js';
import './integrations-chip.js';

/**
 * The account + integrations bar: the user's account chip (avatar + subscription tier)
 * on the left and the integrations status chip on the right.
 *
 * Extracted from `<gl-home-header>` so it can be reused across webviews (e.g. the Graph
 * view). Consumes the shared `subscriptionContext`, `integrationsContext`, and `aiContext`
 * — the host must provide those for the chips to render live state.
 */
@customElement('gl-account-bar')
export class GlAccountBar extends LitElement {
	static override styles = [
		elementBase,
		linkBase,
		css`
			:host {
				display: block;
			}

			.container {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				justify-content: space-between;
				color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
			}

			.container:focus,
			.container:focus-within {
				outline: none;
			}

			.group {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
			}
		`,
	];

	@query('gl-account-chip')
	private accountChip!: GlAccountChip;

	override render(): unknown {
		return html`<div class="container" tabindex="-1">
			<span class="group"><gl-account-chip></gl-account-chip></span>
			<gl-integrations-chip></gl-integrations-chip>
		</div>`;
	}

	show(): void {
		// `show()` may be called before the first render completes, so guard the queried chip.
		this.accountChip?.show();
	}
}
