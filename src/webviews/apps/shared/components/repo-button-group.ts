import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
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
				grid-template-columns: minmax(0, 1fr);
				min-width: 1.4rem;
			}

			/* With a single icon the host should size to its content — no reserved space
			   beyond the base min-width — otherwise the collapsed state shows dead space
			   to the right of the icon. */
			:host([icons]) {
				grid-template-columns: auto minmax(0, 1fr);
			}

			/* Multi-icon needs explicit reservation so the layout doesn't jump as icons
			   appear/disappear. */
			:host([icons='2']) {
				grid-template-columns: auto auto minmax(0, 1fr);
				min-width: 3.6rem;
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

			.popover-status-icon {
				margin-top: -3px;
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
			:host([expandable]:not(:hover, :focus-within)) .truncated-button {
				min-width: 0;
				max-width: 0;
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
				min-width: auto !important;
				max-width: none !important;
			}
		`,
		pickerIconStyles,
	];

	@property({ type: Boolean })
	connectIcon = true;

	@property({ type: Boolean })
	disabled = false;

	@property({ type: Boolean })
	icon = true;

	@property({ type: Object })
	repository?: RepositoryShape;

	@property({ type: Boolean })
	hasMultipleRepositories?: boolean = false;

	@property({ type: Object })
	source?: Source;

	@property({ type: Boolean, reflect: true })
	expandable = false;

	@property({ type: Number, reflect: true })
	get icons() {
		if (this.repository?.provider === undefined) return undefined;

		let count = 0;
		if (this.icon) {
			count++;
		}
		if (this.connectIcon && this.repository.provider.integration?.connected === false) {
			count++;
		}

		if (count === 0) {
			return undefined;
		}
		return count;
	}

	private get displayName(): string {
		return this.repository?.name ?? 'none selected';
	}

	override render() {
		const hideLabel = this.icon && !this.hasMultipleRepositories;
		return html`
			${this.renderProviderIcon()}
			${hideLabel
				? nothing
				: html`<gl-button
						class="truncated-button"
						part="label"
						appearance="toolbar"
						?disabled=${this.disabled}
						@click=${(event: MouseEvent) =>
							this.emit('gl-click', {
								event: event,
								part: 'label',
								repository: this.repository!,
							})}
					>
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
				<span slot="content">
					Open Repository on ${provider.name}
					<hr />
					<span>
						<code-icon class="popover-status-icon" icon="gl-repository" aria-hidden="true"></code-icon>
						${this.displayName}
					</span>
					${when(
						connectedIntegration,
						() => html`
							<br />
							<span>
								<code-icon class="popover-status-icon" icon="check" aria-hidden="true"></code-icon>
								Connected to ${provider.name}
							</span>
						`,
						() => {
							if (connectedIntegration !== false) return nothing;

							return html`
								<br />
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
							`;
						},
					)}
				</span>
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
