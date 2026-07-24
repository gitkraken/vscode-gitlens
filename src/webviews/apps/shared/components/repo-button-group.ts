import { css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { when } from 'lit/directives/when.js';
import type { ConnectRemoteProviderCommandArgs } from '../../../../commands/remoteProviders.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { RepositoryShape } from '../../../../git/models/repositoryShape.js';
import { createCommandLink } from '../../../../system/commands.js';
import { linkStyles, ruleStyles } from '../../plus/shared/components/vscode.css.js';
import { GlElement } from './element.js';
import { pickerIconStyles, refButtonBaseStyles, truncatedButtonStyles } from './ref.css.js';
import './button.js';
import './code-icon.js';
import './overlays/popover.js';
import './indicators/indicator.js';

export interface RepoButtonGroupClickEvent {
	event: MouseEvent;
	part: 'connect-icon' | 'icon' | 'label';
	repository: RepositoryShape;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-repo-button-group': GlRepoButtonGroup;
	}

	interface GlobalEventHandlersEventMap {
		'gl-click': CustomEvent<RepoButtonGroupClickEvent>;
	}
}

@customElement('gl-repo-button-group')
export class GlRepoButtonGroup extends GlElement {
	static override styles = [
		linkStyles,
		ruleStyles,
		refButtonBaseStyles,
		truncatedButtonStyles,
		css`
			:host {
				display: grid;
				align-items: center;
			}

			/* Single-repo (no label rendered): grid sizes exactly to the icons.
	   max-content cols keep each icon column at full content width —
	   auto cols can collapse under flex shrink pressure, hiding icons
	   behind one another. Explicit min-width: max-content prevents the
	   host itself from shrinking past the icons under flex pressure
	   (which otherwise lets the trailing chevron separator overlap). */
			:host(:not([multi-repo])) {
				grid-template-columns: max-content max-content;
				min-width: max-content;
			}

			:host(:not([multi-repo], [icon])) {
				grid-template-columns: minmax(0, 1fr);
				min-width: 0;
			}

			/* Multi-repo: include a flexible label column that can shrink
		   so the label ellipses naturally while preserving enough room for
		   the fallback repo icon + chevron compact state. */
			:host([multi-repo]) {
				--compact-width: 0px;

				position: relative;
				grid-template-columns: max-content max-content minmax(var(--compact-width), 1fr);
				min-width: min-content;
			}

			:host([multi-repo]:not([icon])) {
				grid-template-columns: minmax(var(--compact-width), 1fr);
			}

			[part='label'] {
				grid-row: 1;
				grid-column: 3;
				min-width: 0;
			}

			:host(:not([icon])) [part='label'] {
				grid-column: 1;
			}

			.truncated-button__sizer {
				visibility: hidden;
				grid-row: 1;
				grid-column: 3;
				min-width: 0;
				padding-inline: var(--gl-space-4);
				overflow-wrap: anywhere;
				pointer-events: none;
			}

			:host(:not([icon])) .truncated-button__sizer {
				grid-column: 1;
			}

			.truncated-button__compact-sizer {
				--button-gap: 0.2rem;

				position: absolute;
				inset-inline-start: 0;
				top: 0;
				visibility: hidden;
				width: max-content;
				min-width: max-content;
				pointer-events: none;
			}

			.truncated-button__label {
				display: block;
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.truncated-button--icon-fallback .truncated-button__label {
				display: none;
			}

			.truncated-button--icon-fallback {
				--button-gap: 0.2rem;

				min-width: max-content;
			}

			:host([multi-repo]) .truncated-button {
				width: 100%;
				min-width: 0;
			}

			:host(:not([icon])) .truncated-button {
				width: 100%;
			}

			.truncated-button .picker-icon,
			.truncated-button__compact-sizer .picker-icon {
				margin-right: 0;
			}

			.truncated-button .picker-icon::before,
			.truncated-button__compact-sizer .picker-icon::before {
				margin-left: 0;
			}

			.indicator-dot {
				--gl-indicator-color: green;
				--gl-indicator-size: 0.4rem;

				margin-left: -0.2rem;
			}

			gl-popover,
			[part='provider-icon'] {
				flex-shrink: 0;
			}

			/* Tighten the icon buttons themselves — they sit adjacent in the grid
	   and we don't want extra horizontal padding bloating the group's
	   trailing edge near the chevron separator. */
			[part='provider-icon'],
			[part='connect-icon'] {
				--button-padding: 0.2rem;
			}

			.popover-status-icon {
				margin-top: -3px;
			}

			/* Stack the provider popover's lines as a column with breathing room
	   between them (instead of relying on <br> / inline-flow which gives
	   too-tight visual spacing). */
			.provider-popover {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-6);
			}

			.provider-popover hr {
				margin: 0;
			}

			.provider-popover__line {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
			}

			.connect-icon {
				color: var(--titlebar-fg);
			}

			/* :host([expandable]) .truncated-button {
		transition: max-width 0.3s cubic-bezier(0.25, 1, 0.5, 1);
	} */

			:host([expandable]:not(:hover, :focus-within)) .truncated-button .picker-icon::before {
				visibility: hidden;
			}

			:host([expandable]:not(:hover, :focus-within)) .truncated-button .repo-icon-fallback {
				visibility: hidden;
			}

			:host([expandable]:not(:hover, :focus-within)) .truncated-button {
				min-width: 0 !important;
				max-width: 0;
			}

			:host([multi-repo][expandable]:not(:hover, :focus-within)) {
				grid-template-columns: max-content max-content minmax(0, 0fr);
			}

			:host([multi-repo][expandable]:not([icon], :hover, :focus-within)) {
				grid-template-columns: minmax(0, 0fr);
			}

			/* When the surrounding gl-breadcrumb-item is hovered or focused, expand the
	   truncated-button as if the gl-repo-button-group itself were hovered. This
	   lets users hover anywhere in the breadcrumb-item (e.g., the chevron
	   separator) to reveal the repo name. !important is required because the
	   collapse rule above (with :host attribute + :not) has higher specificity
	   than :host-context. */
			:host-context(gl-breadcrumb-item:hover) .truncated-button .picker-icon::before,
			:host-context(gl-breadcrumb-item:focus-within) .truncated-button .picker-icon::before {
				visibility: visible !important;
			}

			:host-context(gl-breadcrumb-item:hover) .truncated-button,
			:host-context(gl-breadcrumb-item:focus-within) .truncated-button {
				min-width: 0 !important;
				max-width: none !important;
			}

			:host-context(gl-breadcrumb-item:hover),
			:host-context(gl-breadcrumb-item:focus-within) {
				grid-template-columns: max-content max-content minmax(var(--compact-width), 1fr);
			}
		`,
		pickerIconStyles,
	];

	@state() private _truncated = false;

	@query('.truncated-button')
	labelButtonEl?: HTMLElement;

	@query('.truncated-button__compact-sizer')
	compactSizerEl?: HTMLElement;

	@query('.truncated-button__compact-sizer .repo-icon-fallback')
	fallbackIconSizerEl?: HTMLElement;

	private resizeObserver: ResizeObserver;
	private observedLabelButtonEl?: HTMLElement;

	constructor() {
		super();
		this.resizeObserver = new ResizeObserver(() => this.updateTruncated());
	}

	override disconnectedCallback() {
		super.disconnectedCallback?.();
		this.resizeObserver.disconnect();
		this.observedLabelButtonEl = undefined;
	}

	override firstUpdated(): void {
		this.observeLabelButton();
		this.updateTruncated();
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);
		if (
			changedProperties.has('repository') ||
			changedProperties.has('hasMultipleRepositories') ||
			changedProperties.has('icon')
		) {
			this.observeLabelButton();
			this.updateTruncated();
		}
	}

	private observeLabelButton(): void {
		const el = this.labelButtonEl;
		if (this.observedLabelButtonEl === el) return;

		this.resizeObserver.disconnect();
		this.observedLabelButtonEl = el;
		if (el != null) {
			this.resizeObserver.observe(el);
		}
	}

	private updateTruncated(): void {
		if (!this.hasMultipleRepositories) {
			this.style.removeProperty('--compact-width');
			if (this._truncated) {
				this._truncated = false;
			}
			return;
		}

		const el = this.labelButtonEl;
		if (el == null) return;

		const compactWidth = this.compactSizerEl?.getBoundingClientRect().width ?? 0;
		if (compactWidth === 0) return;

		const fallbackIconWidth = this.fallbackIconSizerEl?.getBoundingClientRect().width ?? compactWidth;

		const compactWidthStyle = `${compactWidth}px`;
		if (this.style.getPropertyValue('--compact-width') !== compactWidthStyle) {
			this.style.setProperty('--compact-width', compactWidthStyle);
		}

		let truncated: boolean;
		if (this._truncated) {
			truncated = el.getBoundingClientRect().width <= compactWidth + fallbackIconWidth;
		} else {
			// Only show the fallback repo icon if the visible label slot has collapsed
			// to roughly icon-sized space. Measuring the slotted text element itself is
			// unreliable here because the clipping happens inside gl-button's shadow DOM.
			// This prevents the icon from popping in immediately when the text is just
			// slightly ellipsized.
			const labelSlot = el.shadowRoot?.querySelector<HTMLElement>('slot.label');
			const fallbackThreshold = this.icon ? fallbackIconWidth : compactWidth;
			truncated =
				(labelSlot?.getBoundingClientRect().width ?? el.getBoundingClientRect().width) <= fallbackThreshold;
		}

		if (truncated !== this._truncated) {
			this._truncated = truncated;
		}
	}

	@property({ type: Boolean })
	connectIcon = true;

	@property({ type: Boolean })
	disabled = false;

	@property({ type: Boolean, reflect: true })
	icon = true;

	@property({ type: Object })
	repository?: RepositoryShape;

	@property({ type: Boolean, reflect: true, attribute: 'multi-repo' })
	hasMultipleRepositories?: boolean = false;

	@property({ type: Object })
	source?: Source;

	@property({ type: Boolean, reflect: true })
	expandable = false;

	private get displayName(): string {
		return this.repository?.name ?? 'none selected';
	}

	override render() {
		const hideLabel = this.icon && !this.hasMultipleRepositories;
		const showRepoIconFallback = this.icon && this._truncated && this.hasMultipleRepositories;

		return html`
			${this.renderProviderIcon()}
			${this.hasMultipleRepositories
				? html`<span class="truncated-button__sizer" aria-hidden="true">${this.displayName}</span>
						<gl-button
							class="truncated-button__compact-sizer"
							appearance="toolbar"
							aria-hidden="true"
							?disabled=${true}
						>
							${this.icon
								? html`<code-icon
										slot="prefix"
										class="repo-icon-fallback"
										icon="gl-repository"
										aria-hidden="true"
									></code-icon>`
								: nothing}
							<code-icon
								slot="suffix"
								class="picker-icon"
								icon="chevron-down"
								aria-hidden="true"
							></code-icon>
						</gl-button>`
				: nothing}
			${hideLabel
				? nothing
				: html`<gl-button
						class=${showRepoIconFallback
							? 'truncated-button truncated-button--icon-fallback'
							: 'truncated-button'}
						part="label"
						appearance="toolbar"
						?disabled=${this.disabled}
						truncate
						@click=${(event: MouseEvent) =>
							this.emit('gl-click', {
								event: event,
								part: 'label',
								repository: this.repository!,
							})}
					>
						${showRepoIconFallback
							? html`<code-icon
									slot="prefix"
									class="repo-icon-fallback"
									icon="gl-repository"
									aria-hidden="true"
								></code-icon>`
							: nothing}
						<span class="truncated-button__label">${this.displayName}</span>
						${this.hasMultipleRepositories
							? html`<code-icon
									slot="suffix"
									class="picker-icon"
									icon="chevron-down"
									aria-hidden="true"
								></code-icon>`
							: nothing}
						<slot name="tooltip" slot="tooltip">${this.displayName}</slot>
					</gl-button>`}
		`;
	}

	private renderProviderIcon() {
		if (!this.icon) return nothing;

		const { repository: repo } = this;
		if (!repo?.provider) {
			return html`
				<gl-button part="provider-icon" appearance="toolbar" ?disabled=${true}>
					<code-icon icon="gl-repository" aria-hidden="true"></code-icon>
				</gl-button>
			`;
		}

		const { provider } = repo;
		const connectedIntegration = provider.integration?.connected;

		return html`<gl-popover placement="bottom" trigger="hover click focus">
				<gl-button
					slot="anchor"
					part="provider-icon"
					appearance="toolbar"
					href=${ifDefined(provider.url)}
					aria-label=${`Open Repository on ${provider.name}`}
					@click=${(e: MouseEvent) =>
						this.emit('gl-click', {
							event: e,
							part: 'icon',
							repository: this.repository!,
						})}
				>
					<code-icon
						icon=${provider.icon === 'cloud' ? 'cloud' : `gl-provider-${provider.icon}`}
						aria-hidden="true"
					></code-icon>
					${when(connectedIntegration, () => html`<gl-indicator class="indicator-dot"></gl-indicator>`)}
				</gl-button>
				<div slot="content" class="provider-popover">
					<div class="provider-popover__title">Open Repository on ${provider.name}</div>
					<hr />
					<div class="provider-popover__line">
						<code-icon class="popover-status-icon" icon="gl-repository" aria-hidden="true"></code-icon>
						${this.displayName}
					</div>
					${when(
						connectedIntegration,
						() => html`
							<div class="provider-popover__line">
								<code-icon class="popover-status-icon" icon="check" aria-hidden="true"></code-icon>
								Connected to ${provider.name}
							</div>
						`,
						() => {
							if (connectedIntegration !== false) return nothing;

							return html`
								<div class="provider-popover__line">
									<code-icon class="popover-status-icon" icon="plug" aria-hidden="true"></code-icon>
									<a
										href=${createCommandLink<ConnectRemoteProviderCommandArgs>(
											'gitlens.connectRemoteProvider',
											{ repoPath: repo.path, remote: provider.bestRemoteName },
										)}
									>
										Connect to ${repo.provider!.name}
									</a>
									<span>&mdash; not connected</span>
								</div>
							`;
						},
					)}
				</div>
			</gl-popover>
			${this.renderConnectIcon()}`;
	}

	private renderConnectIcon() {
		if (!this.connectIcon) return nothing;

		const { repository: repo } = this;
		if (!repo?.provider) return nothing;

		const { provider } = repo;
		if (provider.integration?.connected !== false) return nothing;

		return html`
			<gl-button
				part="connect-icon"
				appearance="toolbar"
				href=${createCommandLink<ConnectRemoteProviderCommandArgs>('gitlens.connectRemoteProvider', {
					repoPath: repo.path,
					remote: provider.bestRemoteName,
				})}
			>
				<code-icon class="connect-icon" icon="plug"></code-icon>
				<span slot="tooltip">
					Connect to ${provider.name}
					<hr />
					View pull requests and issues in Home, Commit Graph, Launchpad, autolinks, and more
				</span>
			</gl-button>
		`;
	}
}
