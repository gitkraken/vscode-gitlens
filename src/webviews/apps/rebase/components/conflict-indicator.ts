import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ConflictDetectionResult } from '@gitlens/git/models/mergeConflicts.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { SubscriptionState } from '../../../../constants.subscription.js';
import { elementBase, scrollableBase } from '../../shared/components/styles/lit/base.css.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/overlays/popover.js';
import '../../plus/shared/components/feature-gate-plus-state.js';

export type RebaseConflictIndicatorStatus = 'loading' | 'clean' | 'conflicts' | 'error' | 'upgrade';

@customElement('gl-rebase-conflict-indicator')
export class GlRebaseConflictIndicator extends LitElement {
	static override styles = [
		elementBase,
		scrollableBase,
		css`
			:host {
				display: inline-block;
			}

			gl-popover {
				--max-width: 80vw;
			}

			.indicator {
				position: relative;
				display: inline-flex;
				align-items: center;
				gap: 0.6rem;
				cursor: pointer;
			}

			/* Compact mode (icon only) */
			:host([compact]) .indicator {
				gap: 0;
			}

			:host([compact]) .indicator__content {
				display: none;
			}

			/* Button mode (full) */
			:host(:not([compact])) .indicator {
				padding: 0.4rem 0.8rem;
				border-radius: 0.3rem;
				background-color: var(--vscode-button-secondaryBackground);
				border: 1px solid var(--vscode-button-secondaryBorder, transparent);
				font-size: 1.2rem;
			}

			.indicator__icon {
				flex: none;
				font-size: 1.6rem;
			}

			.indicator__content {
				flex: 1;
				min-width: 0;
				white-space: nowrap;
				font-weight: 500;
			}

			/* Clean state - green */
			.indicator--clean {
				background-color: color-mix(in srgb, var(--vscode-testing-iconPassed) 18%, transparent) !important;
				border: 1px solid color-mix(in srgb, var(--vscode-testing-iconPassed) 50%, transparent) !important;
				color: var(--vscode-foreground);
			}

			.indicator--clean .indicator__icon {
				color: var(--vscode-testing-iconPassed);
			}

			/* Conflict state - warning/orange */
			.indicator--conflict {
				background-color: color-mix(
					in srgb,
					var(--vscode-editorWarning-foreground) 18%,
					transparent
				) !important;
				border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground) 50%, transparent) !important;
				color: var(--vscode-foreground);
			}

			.indicator--conflict .indicator__icon {
				color: var(--vscode-editorWarning-foreground);
			}

			.indicator--upgrade .indicator__icon {
				color: var(--vscode-foreground);
				opacity: 0.6;
			}

			.indicator--stale {
				opacity: 0.6;
			}

			/* Error state - muted warning */
			.indicator--error {
				background-color: color-mix(
					in srgb,
					var(--vscode-editorWarning-foreground) 12%,
					transparent
				) !important;
				border: 1px solid color-mix(in srgb, var(--vscode-editorWarning-foreground) 30%, transparent) !important;
				color: var(--vscode-foreground);
				opacity: 0.8;
			}

			.indicator--error .indicator__icon {
				color: var(--vscode-editorWarning-foreground);
				opacity: 0.7;
			}

			/* Popover content styles */
			.popover {
				padding: 1.2rem;
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
			}

			.popover__title {
				font-weight: 600;
				margin: 0;
			}

			.popover__message {
				margin: 0;
			}

			.popover__message--warning {
				color: var(--vscode-editorWarning-foreground);
				font-weight: 500;
			}

			.popover__files {
				margin: 0;
				padding: 0.4rem 0.8rem;
				list-style: none;
				max-height: 20rem;
				overflow-y: auto;
				background: var(--vscode-sideBar-background);
			}

			.popover__file {
				padding: 0.4rem 0;
				font-family: var(--vscode-editor-font-family);
				font-size: 1.1rem;
			}

			gl-feature-gate-plus-state {
				display: block;
				margin-inline: 0.5rem;
				margin-block: -0.5rem;
			}
		`,
	];

	@property({ type: String })
	status: RebaseConflictIndicatorStatus = 'loading';

	@property({ attribute: false })
	result?: ConflictDetectionResult;

	@property({ attribute: false })
	subscriptionState?: SubscriptionState;

	@property({ type: Boolean })
	compact = false;

	@property({ type: Boolean })
	stale = false;

	/** True while a re-check is in flight. Swaps the state icon for a spinner so the box keeps its colored shell. */
	@property({ type: Boolean })
	checking = false;

	override render(): unknown {
		switch (this.status) {
			case 'loading':
				return this.renderLoading();
			case 'upgrade':
				return this.renderUpgrade();
			case 'error':
				return this.renderError();
			case 'conflicts':
				return this.renderConflicts();
			case 'clean':
			default:
				return this.renderClean();
		}
	}

	private renderLoading() {
		return html`
			<div class="indicator indicator--loading">
				<code-icon class="indicator__icon" icon="loading" modifier="spin" size="16"></code-icon>
				${this.compact ? nothing : html`<span class="indicator__content">Detecting Conflicts</span>`}
			</div>
		`;
	}

	private renderStateIcon(icon: string): unknown {
		return this.checking
			? html`<code-icon class="indicator__icon" icon="loading" modifier="spin" size="16"></code-icon>`
			: html`<code-icon class="indicator__icon" icon="${icon}" size="16"></code-icon>`;
	}

	private renderError() {
		const errorMessage = this.result?.status === 'error' ? this.result.message : 'Unable to detect conflicts';

		if (this.compact) {
			return html`
				<gl-popover placement="top" trigger="hover click focus" hoist>
					<div slot="anchor" class="indicator indicator--error" tabindex="0">
						${this.renderStateIcon('error')}
					</div>
					<div slot="content">
						<div class="popover">
							<p class="popover__title">Conflict Detection Unavailable</p>
							<p class="popover__message">${errorMessage}</p>
						</div>
					</div>
				</gl-popover>
			`;
		}

		return html`
			<gl-popover placement="bottom" trigger="hover click focus" hoist>
				<div slot="anchor" class="indicator indicator--error" tabindex="0">
					${this.renderStateIcon('error')}
					<span class="indicator__content">Conflict Detection Unavailable</span>
				</div>
				<div slot="content">
					<div class="popover">
						<p class="popover__title">Conflict Detection Unavailable</p>
						<p class="popover__message">${errorMessage}</p>
					</div>
				</div>
			</gl-popover>
		`;
	}

	private renderClean() {
		const staleClass = this.stale ? 'indicator--stale' : '';

		if (this.compact) {
			return html`
				<gl-popover placement="top" trigger="hover click focus" hoist>
					<div slot="anchor" class="indicator indicator--clean ${staleClass}" tabindex="0">
						${this.renderStateIcon('pass')}
					</div>
					<div slot="content">
						<div class="popover">
							<p class="popover__title">No Conflicts Detected</p>
							<p class="popover__message">This rebase should complete without conflicts.</p>
							${this.stale
								? html`<p class="popover__message popover__message--warning">
										Detection may be stale. Rebase plan was modified after conflict check.
									</p>`
								: nothing}
						</div>
					</div>
				</gl-popover>
			`;
		}

		return html`
			<gl-popover placement="bottom" trigger="hover click focus" hoist>
				<div slot="anchor" class="indicator indicator--clean ${staleClass}" tabindex="0">
					${this.renderStateIcon('pass')}
					<span class="indicator__content"
						>${this.checking ? 'Detecting Conflicts' : 'No Conflicts Detected'}</span
					>
				</div>
				<div slot="content">
					<div class="popover">
						<p class="popover__title">No Conflicts Detected</p>
						<p class="popover__message">This rebase should complete without conflicts.</p>
						${this.stale
							? html`<p class="popover__message popover__message--warning">
									Detection may be stale. Rebase plan was modified after conflict check.
								</p>`
							: nothing}
					</div>
				</div>
			</gl-popover>
		`;
	}

	private renderConflicts() {
		if (this.result?.status !== 'conflicts') return nothing;

		const staleClass = this.stale ? 'indicator--stale' : '';
		const files = this.result.conflict.files;
		const conflictCount = files.length;

		if (this.compact) {
			return html`
				<gl-popover placement="top" trigger="hover click focus" hoist>
					<div slot="anchor" class="indicator indicator--conflict ${staleClass}" tabindex="0">
						${this.renderStateIcon('warning')}
					</div>
					<div slot="content">
						<div class="popover">
							<p class="popover__title">Potential Conflicts Detected</p>
							<p class="popover__message">
								This rebase will cause conflicts in ${pluralize('file', conflictCount)}:
							</p>
							<ul class="popover__files scrollable">
								${files.map(file => html`<li class="popover__file">${file.path}</li>`)}
							</ul>
							${this.stale
								? html`<p class="popover__message popover__message--warning">
										Detection may be stale. Rebase plan was modified after conflict check.
									</p>`
								: nothing}
						</div>
					</div>
				</gl-popover>
			`;
		}

		return html`
			<gl-popover placement="bottom" trigger="hover click focus" hoist>
				<div slot="anchor" class="indicator indicator--conflict ${staleClass}" tabindex="0">
					${this.renderStateIcon('warning')}
					<span class="indicator__content"
						>${this.checking
							? 'Detecting Conflicts'
							: html`${conflictCount} Conflict${conflictCount === 1 ? '' : 's'} Detected`}</span
					>
				</div>
				<div slot="content">
					<div class="popover">
						<p class="popover__title">Potential Conflicts Detected</p>
						<p class="popover__message">
							This rebase will cause conflicts in ${pluralize('file', conflictCount)}:
						</p>
						<ul class="popover__files scrollable">
							${files.map(file => html`<li class="popover__file">${file.path}</li>`)}
						</ul>
						${this.stale
							? html`<p class="popover__message popover__message--warning">
									Detection may be stale. Rebase plan was modified after conflict check.
								</p>`
							: nothing}
					</div>
				</div>
			</gl-popover>
		`;
	}

	private renderUpgrade() {
		const placement = this.compact ? 'top' : 'bottom';

		return html`
			<gl-popover placement="${placement}" trigger="hover click focus" hoist>
				<div slot="anchor" class="indicator indicator--upgrade" tabindex="0">
					<code-icon class="indicator__icon" icon="lock" size="16"></code-icon>
					${this.compact ? nothing : html`<span class="indicator__content">Conflict Detection (Pro)</span>`}
				</div>
				<gl-feature-gate-plus-state
					slot="content"
					appearance="default"
					featureRestriction="all"
					.source=${{ source: 'rebaseEditor', detail: 'conflict-detection' } as const}
					.state=${this.subscriptionState}
				>
					<p slot="feature">
						Detect potential conflicts before starting your rebase and take action to resolve them.
					</p>
				</gl-feature-gate-plus-state>
			</gl-popover>
		`;
	}
}
