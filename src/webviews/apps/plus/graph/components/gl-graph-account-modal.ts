import { SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { GraphWalkthroughProgress, WalkthroughProgress } from '../../../../../constants.walkthroughs.js';
import { createCommandLink } from '../../../../../system/commands.js';
import type { GlDialog } from '../../../shared/components/overlays/dialog.js';
import { focusableBaseStyles } from '../../../shared/components/styles/lit/a11y.css.js';
import { boxSizingBase, scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import type { OnboardingState } from '../../../shared/contexts/onboarding.js';
import { onboardingContext } from '../../../shared/contexts/onboarding.js';
import { ruleStyles } from '../../shared/components/vscode.css.js';
import { graphStateContext } from '../context.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/hooks-banner.js';
import '../../../shared/components/mcp-banner.js';
import '../../../shared/components/overlays/dialog.js';
import '../../../shared/components/progress-ring.js';
import '../../shared/components/account-chip.js';
import '../../shared/components/integrations-panel.js';
import '../../shared/components/ai-panel.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-account-modal': GlGraphAccountModal;
	}
}

/** Sections of the modal that an opener can request focus on (e.g. the walkthrough pill or a rollup chip). */
export type AccountModalSection = 'account' | 'walkthrough' | 'ai' | 'integrations';

/** Detail of the `gl-show-account-modal` event dispatched by the header pills. */
export type ShowAccountModalEventDetail = { focus?: AccountModalSection };

/**
 * The account modal — a full-Graph overlay opened by the header account/walkthrough pills. Hosts the
 * account panel, walkthrough progress, the Integrations and AI panels, and banners. Built on `gl-dialog`
 * (native `<dialog>` top-layer modal, so it overlays the entire Graph regardless of stacking context).
 * Reuses the shared account chip in `display="panel"` mode, and the shared Integrations/AI panels.
 *
 * `open` is controlled by `gl-graph-app`; native/backdrop dismissal is surfaced via `gl-account-modal-close`.
 */
@customElement('gl-graph-account-modal')
export class GlGraphAccountModal extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		focusableBaseStyles,
		scrollableBase,
		ruleStyles,
		css`
			:host {
				display: contents;
			}

			.account-modal::part(base) {
				width: min(98vw, 130rem);
				min-width: auto;
				max-width: none;
				max-height: 96vh;
				padding: 0;
			}

			.layout {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				max-height: 96vh;
			}

			.header {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				justify-content: space-between;
				padding: var(--gl-space-12) var(--gl-space-16) 0;

				h2 {
					display: flex;
					gap: var(--gl-space-8);
					align-items: center;
					margin: 0;
					font-size: 1.5rem;
					font-weight: 600;
				}
			}

			/* Constrained by the flexed dialog so overflow engages here, below the pinned header */
			.scroller {
				flex: 1 1 auto;
				min-height: 0;
				padding: 0 var(--gl-space-16) var(--gl-space-12);
				container-type: inline-size;
				overflow: auto;
			}

			.container {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-16);
			}

			.statuses {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-16);
			}

			.section {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
			}

			/* Pointable sections anchor an absolutely-positioned pulse overlay */
			.section--account,
			.section--walkthrough,
			.section--integrations,
			.section--ai {
				position: relative;
			}

			/* Matches the chips' .header__title (chipStyles.ts) so all panel headings read as one system */
			.section__title {
				margin: 0;
				font-size: 1.5rem;
				font-weight: 600;
				line-height: 1.7;
			}

			.walkthrough {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				padding: var(--gl-space-8);
				font-size: var(--gl-font-md);
				color: inherit;
				text-decoration: none;
				cursor: pointer;
				background-color: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
				border-radius: var(--gl-radius-sm);
			}

			.walkthrough:hover,
			.walkthrough:focus-visible {
				background-color: var(--vscode-toolbar-hoverBackground);
			}

			code-icon[icon='circle-large'] {
				color: var(--color-foreground--50);
			}

			code-icon[icon='pass'] {
				color: #0d0;
			}

			/* With room to spread out: announcements span a full row on top, then the account +
			   walkthrough, integrations, and AI columns sit side by side */
			@container (min-width: 78.6rem) {
				.container {
					display: grid;
					grid-template:
						'news news news' auto
						'statuses ai integrations' 1fr
						/ 1fr 1fr 1fr;
					gap: var(--gl-space-16) var(--gl-space-24);
					align-items: start;
				}

				.section--news {
					grid-area: news;
				}

				.statuses {
					grid-area: statuses;
				}

				.section--integrations {
					grid-area: integrations;
				}

				.section--ai {
					grid-area: ai;
				}
			}

			/* Focus-ring pulse overlay that flashes over a pointed section (see point()) */
			.pulse {
				position: absolute;
				inset: calc(-1 * var(--gl-space-8));
				z-index: 1;
				pointer-events: none;
				background: color-mix(in srgb, var(--vscode-focusBorder) 9%, transparent);
				border: 1px solid var(--vscode-focusBorder);
				border-radius: var(--gl-radius-md);
				opacity: 0;
			}

			.pulse--active {
				animation: gl-point 1150ms ease-out both;
			}

			@keyframes gl-point {
				0% {
					opacity: 0;
					transform: scale(0.99);
				}

				20% {
					opacity: 1;
					transform: scale(1);
				}

				55% {
					opacity: 1;
				}

				100% {
					opacity: 0;
				}
			}

			@media (prefers-reduced-motion: reduce) {
				.pulse--active {
					animation-duration: 1ms;
				}
			}
		`,
	];

	@property({ type: Boolean, reflect: true })
	open = false;

	/** Section to move focus to when the modal opens (set by the opener, e.g. the walkthrough pill). */
	@property({ attribute: false })
	focusSection?: AccountModalSection;

	@consume({ context: onboardingContext, subscribe: true })
	private _onboarding?: OnboardingState;

	@consume({ context: graphStateContext, subscribe: true })
	private _graphState?: typeof graphStateContext.__context__;

	@query('gl-dialog')
	private _dialog?: GlDialog;

	/** The setup section currently being pointed at (scrolled to + pulsing), or null. */
	@state()
	private _pointAt: AccountModalSection | null = null;

	show(): void {
		this.open = true;
	}

	protected override updated(changedProperties: PropertyValues): void {
		super.updated(changedProperties);

		if (changedProperties.has('open') && this.open && this.focusSection != null) {
			void this.focusRequestedSection(this.focusSection);
		}
	}

	private async focusRequestedSection(section: AccountModalSection): Promise<void> {
		// null first so a repeat click on the same card restarts the animation
		this._pointAt = null;

		// `showModal()` runs during gl-dialog's own update; wait for it or the content isn't focusable yet
		await this._dialog?.updateComplete;
		this._pointAt = section;

		// The walkthrough is a single interactive control, so focus it directly; the AI/Integrations
		// sections are regions made focusable via tabindex=-1 (see render), so focus lands on the whole section.
		const selector = section === 'walkthrough' ? '.walkthrough' : `.section--${section}`;
		const target = this.shadowRoot?.querySelector<HTMLElement>(selector);
		if (target == null) return;

		target.scrollIntoView({ block: 'nearest' });
		target.focus();
	}

	private close = (): void => {
		if (!this.open) return;

		this.open = false;
		this.dispatchEvent(new CustomEvent('gl-account-modal-close', { bubbles: true, composed: true }));
	};

	override render(): unknown {
		const banner = this.renderAnnouncementsBanner();

		return html`<gl-dialog
			class="account-modal"
			modal
			closedby="any"
			?open=${this.open}
			@gl-dialog-close=${this.close}
		>
			<div class="layout">
				<header class="header">
					<h2><code-icon icon="account"></code-icon> Account</h2>
					<gl-button appearance="toolbar" tooltip="Close" @click=${this.close}>
						<code-icon icon="close"></code-icon
					></gl-button>
				</header>

				<div class="scroller scrollable">
					<div class="container">
						${
							banner != null
								? html`<section class="section section--news">
										<h3 class="section__title">Announcements</h3>
										${banner}
									</section>`
								: nothing
						}

						<div class="statuses">
							<section class="section section--account">
								${this.renderPulse('account')}
								<gl-account-chip display="panel"></gl-account-chip>
							</section>

							${this.renderWalkthrough()}
						</div>

						<section class="section section--ai" tabindex="-1">
							${this.renderPulse('ai')}
							<gl-ai-panel></gl-ai-panel>
						</section>

						<section class="section section--integrations" tabindex="-1">
							${this.renderPulse('integrations')}
							<gl-integrations-panel></gl-integrations-panel>
						</section>
					</div>
				</div>
			</div>
		</gl-dialog>`;
	}

	private renderWalkthrough(): unknown {
		const main = this._onboarding?.walkthroughProgress.get();
		const graph = this._onboarding?.graphWalkthroughProgress.get();
		if (main == null && graph == null) return nothing;

		return html`<section class="section section--walkthrough">
			${this.renderPulse('walkthrough')}
			<h3 class="section__title">Walkthroughs</h3>
			${this.renderWalkthroughEntry('GitLens Walkthrough', main, undefined)}
			${this.renderWalkthroughEntry('Graph Walkthrough', graph, { mode: 'graph' })}
		</section>`;
	}

	// Compressed to the progress ring + name + count, mirroring the gl-graph-account-indicator rollup
	private renderWalkthroughEntry(
		title: string,
		progress: WalkthroughProgress | GraphWalkthroughProgress | undefined,
		welcomeArgs: { mode: 'graph' } | undefined,
	): unknown {
		if (progress == null) return nothing;

		return html`<a
			class="walkthrough"
			href=${createCommandLink('gitlens.showWelcomeView', welcomeArgs)}
			aria-label="Open the ${title}"
		>
			<gl-progress-ring
				count-placement="sr-only"
				.value=${progress.doneCount}
				.max=${progress.allCount}
			></gl-progress-ring>
			<span>${title} ${progress.doneCount}/${progress.allCount}</span>
		</a>`;
	}

	private renderPulse(target: AccountModalSection): unknown {
		return html`<div class="pulse${this._pointAt === target ? ' pulse--active' : ''}" aria-hidden="true"></div>`;
	}

	/** The same MCP-or-Hooks banner slot the Home view renders: MCP until dismissed (as the
	 *  "bundled" variant when MCP auto-registers), then Hooks. */
	private renderAnnouncementsBanner(): unknown | undefined {
		const state = this._graphState;
		if (state == null) return undefined;

		if (!(state.mcpBannerCollapsed ?? true)) {
			return html`<gl-mcp-banner
				source="graph"
				layout="responsive"
				.canAutoRegister=${state.mcpCanAutoRegister ?? false}
				.canInstallClaudeHook=${state.canInstallClaudeHook ?? false}
			></gl-mcp-banner>`;
		}

		if ((state.canInstallClaudeHook ?? false) && !(state.hooksBannerCollapsed ?? true)) {
			return html`<gl-hooks-banner source="graph" layout="responsive"></gl-hooks-banner>`;
		}

		return undefined;
	}
}
