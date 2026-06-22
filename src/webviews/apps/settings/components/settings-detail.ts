import { consume } from '@lit/context';
import { SignalWatcher } from '@lit-labs/signals';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { createCommandLink } from '../../../../system/commands.js';
import { linkify } from '../../shared/components/linkify.js';
import { boxSizingBase, linkBase, scrollableBase } from '../../shared/components/styles/lit/base.css.js';
import type { SettingsActions } from '../actions.js';
import type { SettingDescriptor, SettingsCategory } from '../model.js';
import { evaluateStateExpression } from '../model.js';
import type { SettingsState } from '../state.js';
import { settingsStateContext } from '../state.js';
import './setting-control.js';
import './settings-preview.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/feature-badge.js';
import '../../shared/components/icons/icon-cube.js';
import '../../shared/components/switch/switch.js';

export const tagName = 'gl-settings-detail';

/**
 * The right pane: selected category header (with master switch), docked live
 * preview, and the category's controls.
 */
@customElement(tagName)
export class GlSettingsDetail extends SignalWatcher(LitElement) {
	static override styles = [
		boxSizingBase,
		linkBase,
		scrollableBase,
		css`
			:host {
				display: block;
				overflow-y: auto;
			}

			.header {
				padding: 2rem 2.6rem 1.6rem;
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.header__row {
				display: flex;
				gap: var(--gl-space-12);
				align-items: center;
			}

			.header__icon {
				--gl-icon-cube-size: 2rem;

				flex: none;
			}

			.header__text {
				flex: 1;
				min-width: 0;
			}

			.header__title {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				margin: 0;
				font-size: 1.6rem;
				font-weight: 600;
				color: var(--color-foreground);
			}

			.header__hint {
				margin: var(--gl-space-2) 0 0;
				font-size: 1.2rem;
				color: var(--color-foreground--65);
			}

			.header__tip {
				display: flex;
				gap: 0.7rem;
				align-items: center;
				margin: var(--gl-space-12) 0 0;
				font-size: 1.15rem;
				color: var(--color-foreground--65);
			}

			.header__tip code-icon {
				color: var(--gl-chip-scoped-color, var(--vscode-charts-yellow));
			}

			.preview {
				padding: 1.6rem 2.6rem;
				background-color: color-mix(in srgb, var(--vscode-sideBar-background) 60%, transparent);
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.preview__label {
				margin: 0 0 var(--gl-space-8);
				font-size: 1.05rem;
				font-weight: 400;
				color: var(--color-foreground--50);
				text-transform: uppercase;
				letter-spacing: 0.06em;
			}

			.controls {
				display: flex;
				flex-direction: column;
				gap: 1.8rem;
				max-width: 64rem;
				padding: 2rem 2.6rem 2.4rem;
			}

			.no-results {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
				align-items: flex-start;
				max-width: 64rem;
				padding: 3.2rem 2.6rem;
				color: var(--color-foreground--65);
			}

			.no-results__title {
				display: flex;
				gap: 0.7rem;
				align-items: center;
				margin: 0;
				font-size: 1.4rem;
				font-weight: 600;
				color: var(--color-foreground);
			}

			.no-results p {
				margin: 0;
				font-size: 1.2rem;
			}

			.footer {
				display: flex;
				gap: 0.7rem;
				align-items: center;
				padding-top: var(--gl-space-16);
				margin: 0 2.6rem 2.4rem;
				font-size: 1.15rem;
				color: var(--color-foreground--65);
				border-top: var(--gl-border-width) solid var(--vscode-widget-border, var(--color-foreground--25));
			}

			.footer code {
				font-family: var(--vscode-editor-font-family);
				font-size: 1.05rem;
				color: var(--gl-chip-filtered-text-color, var(--color-link-foreground));
			}
		`,
	];

	@consume({ context: settingsStateContext })
	private _state!: SettingsState;

	@property({ attribute: false })
	actions?: SettingsActions;

	// Scroll intent captured in willUpdate (reading signals in updated() would
	// re-subscribe outside the tracked render cycle) and applied in updated()
	private _pendingCategoryId?: string;
	private _pendingHighlight?: string;
	private _renderedCategoryId?: string;
	private _renderedHighlight?: string;

	private get category(): SettingsCategory {
		return this._state.selectedCategory.get();
	}

	override willUpdate(): void {
		// Scroll intent captured here (same signals render reads); applied in
		// updated() once the controls exist in the DOM. The anchor nonce makes
		// re-requesting the same deep link re-scroll.
		this._pendingCategoryId = this.category.id;
		const highlighted = this._state.highlightedKeys.get();
		const anchorNonce = this._state.anchorKey.get()?.nonce ?? 0;
		this._pendingHighlight = highlighted.length ? `${anchorNonce}|${highlighted.join()}` : undefined;
	}

	override updated(): void {
		const categoryChanged = this._renderedCategoryId !== this._pendingCategoryId;
		const highlightChanged = this._renderedHighlight !== this._pendingHighlight;
		this._renderedCategoryId = this._pendingCategoryId;
		this._renderedHighlight = this._pendingHighlight;

		if (this._pendingHighlight != null) {
			// Surface the first match — search promises to *surface* settings, and
			// in long categories the highlight can otherwise sit below the fold
			if (categoryChanged || highlightChanged) {
				const target = [...this.renderRoot.querySelectorAll('gl-setting-control')].find(c => c.highlighted);
				if (target != null) {
					// Wait a frame so the child controls have rendered and have real heights
					requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
				} else if (categoryChanged) {
					// Master-key / panel-key matches have no control to scroll to —
					// show the header (with the master switch) instead of a stale offset
					this.scrollTop = 0;
				}
			}
		} else if (categoryChanged) {
			// Don't inherit the previous category's scroll offset
			this.scrollTop = 0;
		}
	}

	private get masterOn(): boolean {
		const master = this.category.master;
		if (master == null) return true;

		if (master.type === 'custom') {
			return this._state.customSettings.get()[master.key] ?? false;
		}
		return Boolean(this._state.getSettingValue<unknown>(master.key));
	}

	/** Org-disabled AI forces the feature off — the master switch must not offer a toggle with no effect. */
	private get masterDisabledByOrg(): boolean {
		return this.category.controls.some(c => c.kind === 'ai') && this._state.aiState.get()?.orgEnabled === false;
	}

	/**
	 * Whether a matched control should render highlighted (and so force-reveal
	 * itself if `visibleWhen`-hidden). Some settings are deliberately authored
	 * as duplicate-key descriptor pairs with complementary `visibleWhen` (e.g.
	 * `hovers.currentLine.over`) — when a match has a naturally-visible
	 * variant, its hidden duplicates must stay hidden or both would render.
	 */
	private isHighlighted(d: SettingDescriptor, highlighted: ReadonlySet<string>): boolean {
		if (!('key' in d) || !highlighted.has(d.key)) return false;
		if (this.isNaturallyVisible(d)) return true;

		// Hidden match: force-reveal only when no visible variant of the key exists
		return !this.category.controls.some(
			c => c !== d && 'key' in c && c.key === d.key && this.isNaturallyVisible(c),
		);
	}

	private isNaturallyVisible(d: SettingDescriptor): boolean {
		return d.visibleWhen == null || evaluateStateExpression(d.visibleWhen, p => this._state.getSettingValue(p));
	}

	override render(): unknown {
		// When a search matches nothing, the rail shows its empty state — keep the
		// detail pane in sync rather than leaving a stale, fully-rendered category.
		const query = this._state.query.get().trim();
		if (query && this._state.searchResults.get().length === 0) {
			const target =
				query.includes(' ') || query.toLowerCase().startsWith('gitlens.') ? query : `gitlens.${query}`;
			return html`<section class="no-results" aria-labelledby="no-results-title">
				<h2 class="no-results__title" id="no-results-title">
					<code-icon icon="search" aria-hidden="true"></code-icon>
					No settings match “${query}”
				</h2>
				<p>Check your spelling, or try a setting name like <code>gitlens.currentLine.format</code>.</p>
				<p>
					You can also
					<a href="command:workbench.action.openSettings?${encodeURIComponent(JSON.stringify(target))}"
						>open the Settings UI</a
					>
					to search every GitLens setting.
				</p>
			</section>`;
		}

		const category = this.category;
		const masterOn = this.masterOn;
		const masterDisabledByOrg = this.masterDisabledByOrg;
		const highlighted = new Set(this._state.highlightedKeys.get());

		return html`
			<section aria-labelledby="category-title">
				<div class="header">
					<div class="header__row">
						<gl-icon-cube class="header__icon" icon=${category.icon} aria-hidden="true"></gl-icon-cube>
						<div class="header__text">
							<h2 class="header__title" id="category-title">
								${category.name}
								${category.pro
									? html`<gl-feature-badge
											.source=${{ source: 'settings', detail: 'header' } as const}
											.subscription=${this._state.subscription.get()}
										></gl-feature-badge>`
									: nothing}
							</h2>
							<p class="header__hint">${linkify(category.hint)}</p>
						</div>
						${category.master != null
							? html`<gl-switch
									size="large"
									.checked=${masterOn && !masterDisabledByOrg}
									?disabled=${masterDisabledByOrg}
									label="Enable ${category.name}"
									title=${ifDefined(
										masterDisabledByOrg
											? 'AI features have been disabled by your GitKraken admin.'
											: undefined,
									)}
									@gl-change-value=${(e: Event) => {
										void this.actions?.applyCheck(
											category.master!,
											(e.target as HTMLElement & { checked: boolean }).checked,
										);
									}}
								></gl-switch>`
							: nothing}
					</div>
					${category.command != null
						? html`<p class="header__tip">
								<code-icon icon="bell" aria-hidden="true"></code-icon>
								<span
									>Tip — run
									<a href=${createCommandLink(category.command.command)}>${category.command.label}</a>
									to override this for the current window.</span
								>
							</p>`
						: nothing}
				</div>

				${category.preview != null
					? html`<div class="preview" role="region" aria-label="Live preview">
							<h3 class="preview__label">Live preview</h3>
							<gl-settings-preview
								kind=${category.preview}
								.actions=${this.actions}
							></gl-settings-preview>
						</div>`
					: nothing}

				<div class="controls">
					${category.controls.map(
						descriptor =>
							html`<gl-setting-control
								.descriptor=${descriptor}
								.actions=${this.actions}
								.highlighted=${this.isHighlighted(descriptor, highlighted)}
							></gl-setting-control>`,
					)}
				</div>

				<p class="footer">
					<code-icon icon="gear" aria-hidden="true"></code-icon>
					<span
						>For more options, open the
						<a
							href="command:workbench.action.openSettings?${encodeURIComponent(
								JSON.stringify(this.settingsSearch.split(' or ')[0]),
							)}"
							>Settings UI</a
						>
						and search for <code>${this.settingsSearch}</code></span
					>
					${category.learnMoreUrl != null
						? html`<a href=${category.learnMoreUrl} aria-label="Learn more about ${category.name}"
								>Learn more</a
							>`
						: nothing}
				</p>
			</section>
		`;
	}

	private get settingsSearch(): string {
		const category = this.category;
		if (category.settingsSearch != null) return category.settingsSearch;

		const first = category.controls.find(c => c.kind !== 'info' && c.kind !== 'autolinks');
		const key = category.master?.key ?? (first != null && 'key' in first ? first.key : category.id);
		return `gitlens.${key.split('.')[0]}`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		[tagName]: GlSettingsDetail;
	}
}
