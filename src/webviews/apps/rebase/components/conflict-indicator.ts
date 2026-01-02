import { consume } from '@lit/context';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ConflictDetectionResult } from '../../../../git/models/mergeConflicts.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../../plus/gk/utils/subscription.utils.js';
import { pluralize } from '../../../../system/string.js';
import type { State } from '../../../rebase/protocol.js';
import { GetPotentialConflictsRequest } from '../../../rebase/protocol.js';
import { elementBase, scrollableBase } from '../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import type { HostIpc } from '../../shared/ipc.js';
import { stateContext } from '../context.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/overlays/popover.js';
import '../../plus/shared/components/feature-gate-plus-state.js';

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

	@consume({ context: ipcContext })
	private _ipc!: HostIpc;

	@consume({ context: stateContext, subscribe: true })
	@state()
	private _state!: State;

	@property({ type: String })
	branch?: string;

	@property({ type: String })
	onto?: string;

	@property({ type: Boolean })
	compact = false;

	@property({ type: Boolean })
	stale = false;

	@state()
	private _conflicts?: ConflictDetectionResult;

	@state()
	private _loading = false;

	@state()
	private _loaded = false;

	/** Public getter for loading state */
	get isLoading(): boolean {
		return this._loading;
	}

	/** Public getter for conflicts */
	get hasConflicts(): boolean {
		return this._conflicts?.status === 'conflicts' && this._conflicts.conflict.files.length > 0;
	}

	/** Public getter for all SHAs of commits that will cause conflicts */
	get conflictingShas(): string[] | undefined {
		return this._conflicts?.status === 'conflicts' ? this._conflicts.conflict.shas : undefined;
	}

	override connectedCallback(): void {
		super.connectedCallback?.();
		void this.fetchConflicts();
	}

	override willUpdate(changedProperties: Map<PropertyKey, unknown>): void {
		super.willUpdate(changedProperties);

		// If subscription state changed and user is now Pro, fetch conflicts
		if (changedProperties.has('_state')) {
			const oldState = changedProperties.get('_state') as State | undefined;
			const oldIsPro = isSubscriptionTrialOrPaidFromState(oldState?.subscription?.state);
			const newIsPro = isSubscriptionTrialOrPaidFromState(this._state?.subscription?.state);

			// User just upgraded to Pro - fetch conflicts
			if (!oldIsPro && newIsPro && !this._loaded && !this._loading) {
				void this.fetchConflicts();
			}
		}
	}

	private async fetchConflicts(): Promise<void> {
		if (!this.onto || this._loading || this._loaded) {
			return;
		}

		// Get commit SHAs from the rebase entries
		const commits = this._state?.entries?.map(e => e.sha).filter((sha): sha is string => sha != null);
		if (!commits?.length) {
			return;
		}

		this._loading = true;
		this.dispatchStateChange();
		this.requestUpdate();

		try {
			const rsp = await this._ipc.sendRequest(GetPotentialConflictsRequest, {
				onto: this.onto,
				commits: commits,
				stopOnFirstConflict: false,
			});
			this._conflicts = rsp.conflicts;
			this._loaded = true;
		} catch (error) {
			console.error('Failed to fetch potential conflicts:', error);
			this._loaded = true;
		} finally {
			this._loading = false;
			this.dispatchStateChange();
			this.requestUpdate();
		}
	}

	/** Dispatch event to notify parent of state changes */
	private dispatchStateChange(): void {
		this.dispatchEvent(
			new CustomEvent('conflict-state-change', {
				bubbles: true,
				composed: true,
				detail: {
					isLoading: this._loading,
					hasConflicts: this.hasConflicts,
					conflictingShas: this.conflictingShas,
				},
			}),
		);
	}

	override render() {
		if (this._loading) {
			return this.renderLoading();
		}

		const isPro = isSubscriptionTrialOrPaidFromState(this._state?.subscription?.state);

		// Show upgrade prompt for non-Pro users
		if (!isPro) {
			return this.renderUpgrade();
		}

		// Show error state if conflict detection failed
		if (this._conflicts?.status === 'error') {
			return this.renderError();
		}

		// Show results for Pro users
		if (this._conflicts?.status !== 'conflicts') {
			return this.renderClean();
		}

		return this.renderConflicts();
	}

	private renderLoading() {
		return html`
			<div class="indicator indicator--loading">
				<code-icon class="indicator__icon" icon="loading~spin" size="16"></code-icon>
				${this.compact ? nothing : html`<span class="indicator__content">Checking for conflicts...</span>`}
			</div>
		`;
	}

	private renderError() {
		const errorMessage =
			this._conflicts?.status === 'error' ? this._conflicts.message : 'Unable to detect conflicts';

		if (this.compact) {
			return html`
				<gl-popover placement="top" trigger="hover click focus" hoist>
					<div slot="anchor" class="indicator indicator--error" tabindex="0">
						<code-icon class="indicator__icon" icon="error" size="16"></code-icon>
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
					<code-icon class="indicator__icon" icon="error" size="16"></code-icon>
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
						<code-icon class="indicator__icon" icon="pass" size="16"></code-icon>
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
					<code-icon class="indicator__icon" icon="pass" size="16"></code-icon>
					<span class="indicator__content"
						>${this.stale ? 'No Conflicts Detected (may be stale)' : 'No Conflicts Detected'}</span
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
		if (this._conflicts?.status !== 'conflicts') return nothing;

		const staleClass = this.stale ? 'indicator--stale' : '';
		const files = this._conflicts.conflict.files;
		const conflictCount = files.length;

		if (this.compact) {
			return html`
				<gl-popover placement="top" trigger="hover click focus" hoist>
					<div slot="anchor" class="indicator indicator--conflict ${staleClass}" tabindex="0">
						<code-icon class="indicator__icon" icon="warning" size="16"></code-icon>
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
					<code-icon class="indicator__icon" icon="warning" size="16"></code-icon>
					<span class="indicator__content"
						>${conflictCount} Conflict${conflictCount === 1 ? '' : 's'}
						Detected${this.stale ? ' (may be stale)' : ''}</span
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
					.state=${this._state?.subscription?.state}
				>
					<p slot="feature">
						Detect potential conflicts before starting your rebase and take action to resolve them.
					</p>
				</gl-feature-gate-plus-state>
			</gl-popover>
		`;
	}
}
