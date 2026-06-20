import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import { pluralize } from '@gitlens/utils/string.js';
import type {
	ConflictResolutionStrategy,
	ResolvedFileSummary,
	ResolveFileError,
	ResolveSkippedFile,
} from '../../../../plus/graph/graphService.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import { renderErrorState, renderLoadingState } from './shared-panel-templates.js';
import { panelErrorStyles, panelHostStyles, panelLoadingStyles } from './shared-panel.css.js';
import '../../../shared/components/ai-input.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '../../../shared/components/overlays/tooltip.js';

export type ResolveModeStatus = 'idle' | 'loading' | 'ready' | 'error' | 'applying';

export interface ResolveViewDiffDetail {
	filePath: string;
}

export interface ResolveOpenFileDetail {
	filePath: string;
}

/** Friendly label + icon for each conflict-tools resolution strategy. `skipped` is a warning —
 *  the file was intentionally left conflicted and still needs manual attention. */
const strategyDisplay: Record<ConflictResolutionStrategy, { label: string; icon: string; warn?: boolean }> = {
	ai: { label: 'merged', icon: 'git-merge' },
	'take-ours': { label: 'kept current', icon: 'arrow-left' },
	'take-theirs': { label: 'took incoming', icon: 'arrow-right' },
	deleted: { label: 'deleted', icon: 'trash' },
	skipped: { label: 'needs review', icon: 'warning', warn: true },
};

/**
 * AI conflict-resolution mode panel for the graph WIP details. A third AI mode alongside compose
 * and review — but simpler: no scope picker (it operates on the paused op's conflicted files) and
 * no Back/Resume (apply is terminal). States: `idle` (the conflicted-file list + a Resolve button),
 * `loading` (streamed progress), `ready` (per-file resolutions + Apply/Discard), `applying`
 * (uncancellable overlay), and `error`.
 */
@customElement('gl-details-resolve-mode-panel')
export class GlDetailsResolveModePanel extends LitElement {
	static override styles = [
		panelHostStyles,
		panelLoadingStyles,
		panelErrorStyles,
		css`
			.resolve-panel {
				display: flex;
				flex: 1;
				flex-direction: column;
				min-height: 0;
			}

			.resolve-intro {
				margin: var(--gl-space-8) var(--gl-space-12) var(--gl-space-4);
				color: var(--vscode-descriptionForeground);
			}

			.resolve-files {
				padding: 0;
				margin: var(--gl-space-4) 0;
				overflow-y: auto;
				list-style: none;
			}

			.resolve-file {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-2);
				padding: 0.5rem 1.2rem;
				border-top: 1px solid var(--vscode-panel-border);
			}

			.resolve-file__head {
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
			}

			.resolve-file__path {
				flex: 1;
				overflow: hidden;
				text-overflow: ellipsis;
				font-weight: 600;
				white-space: nowrap;
			}

			/* Idle-state file link — opens the conflicted working-tree file. Mirrors the review
	   panel's .review-area__file-link affordance (hover background + path underline). */
			.resolve-file__link {
				display: flex;
				flex: 1;
				gap: var(--gl-space-4);
				align-items: center;
				min-width: 0;
				padding: var(--gl-space-2) var(--gl-space-4);
				margin: -0.2rem -0.4rem;
				font-family: inherit;
				font-size: inherit;
				color: var(--vscode-textLink-foreground);
				text-align: left;
				cursor: pointer;
				background: transparent;
				border: none;
				border-radius: var(--gl-radius-xs);
			}

			.resolve-file__link:hover {
				background: var(--vscode-list-hoverBackground);
			}

			/* Underline only the path text on hover — without this scope, the rule applies to the
	   whole button and the icon picks up a stray underline at its baseline. */
			.resolve-file__link:hover .resolve-file__path {
				text-decoration: underline;
			}

			.resolve-file__link code-icon {
				flex: none;
				color: var(--vscode-foreground);
				opacity: 0.7;
			}

			.resolve-file__badge {
				display: inline-flex;
				flex: none;
				gap: 0.3rem;
				align-items: center;
				padding: 0.1rem 0.5rem;
				font-size: var(--gl-font-sm);
				color: var(--vscode-badge-foreground);
				background: var(--vscode-badge-background);
				border-radius: var(--gl-radius-sm);
			}

			.resolve-file__badge--warn {
				color: var(--vscode-inputValidation-warningForeground, var(--vscode-badge-foreground));
				background: var(--vscode-inputValidation-warningBackground, var(--vscode-badge-background));
			}

			.resolve-file__reasoning {
				margin: 0;
				color: var(--vscode-descriptionForeground);
				white-space: pre-wrap;
			}

			.resolve-file__error {
				color: var(--vscode-errorForeground);
			}

			.resolve-footer {
				display: flex;
				flex: none;
				gap: var(--gl-space-6);
				justify-content: flex-end;
				padding: var(--gl-space-6) var(--gl-space-12);
				border-top: 1px solid var(--vscode-panel-border);
			}

			.resolve-actions {
				display: flex;
				flex: none;
				flex-direction: column;
				gap: var(--gl-space-4);
				padding: var(--gl-space-6) var(--gl-space-12);
			}

			.resolve-loading-actions {
				display: flex;
				justify-content: center;
				padding: var(--gl-space-4);
			}

			/* Per-row feedback input, indented under its file. */
			.resolve-file__feedback {
				display: block;
				margin-top: var(--gl-space-4);
			}

			/* Whole-run "Refine" input between the results list and the footer. */
			.resolve-refine {
				display: block;
				flex: none;
				margin: var(--gl-space-4) var(--gl-space-12);
			}
		`,
	];

	@property({ attribute: 'status' }) status: ResolveModeStatus = 'idle';
	@property() errorMessage?: string;
	@property({ type: Array }) resolutions?: readonly ResolvedFileSummary[];
	@property({ type: Array }) errors?: readonly ResolveFileError[];
	@property({ type: Array }) skipped?: readonly ResolveSkippedFile[];
	@property({ type: Array }) conflictedFiles?: readonly GitFileChangeShape[];
	/** Scopes the run to these conflicted files (per-file/multi-select entry); undefined = all. */
	@property({ type: Array }) focusedPaths?: readonly string[];
	@property() progressMessage?: string;
	@property({ type: Object }) aiModel?: AiModelInfo;
	/** Paths currently being re-resolved with feedback — drives the per-row busy state. */
	@property({ type: Object }) retryingFiles?: ReadonlySet<string>;
	/** The whole-run prompt, recalled into the "Refine" input (ArrowUp). */
	@property() lastPrompt?: string;

	/** Rows whose per-file feedback input is expanded. Panel-local UI state. */
	@state() private _expandedRetry = new Set<string>();

	override render(): unknown {
		return html`<div class="resolve-panel">${this.renderContent()}</div>`;
	}

	private renderContent(): unknown {
		switch (this.status) {
			case 'loading':
				return this.renderLoading();
			case 'applying':
				return renderLoadingState('Applying resolutions…');
			case 'error':
				return renderErrorState(
					this.errorMessage,
					'An error occurred while resolving conflicts.',
					'resolve-error-retry',
					'resolve-error-back',
				);
			case 'ready':
				return this.renderReady();
			default:
				return this.renderIdle();
		}
	}

	private renderLoading(): unknown {
		return html`
			${renderLoadingState(this.progressMessage ?? 'Resolving conflicts…')}
			<div class="resolve-loading-actions">
				<gl-button appearance="secondary" @click=${() => this.emit('resolve-cancel')}>Cancel</gl-button>
			</div>
		`;
	}

	private renderIdle(): unknown {
		const focused = this.focusedPaths != null && this.focusedPaths.length > 0 ? this.focusedPaths : undefined;
		const files =
			focused != null ? this.conflictedFiles?.filter(f => focused.includes(f.path)) : this.conflictedFiles;
		const count = files?.length ?? 0;

		return html`
			<p class="resolve-intro">
				${focused?.length === 1
					? html`Resolve the conflict in <strong>${focused[0]}</strong> with AI.`
					: html`Resolve ${focused != null ? 'the selected' : ''} ${pluralize('conflicted file', count)} with
						AI. You'll be able to review each resolution before applying.`}
			</p>
			${count > 0
				? html`<ul class="resolve-files" aria-label="Conflicted files">
						${repeat(
							files!,
							f => f.path,
							f =>
								html`<li class="resolve-file">
									<div class="resolve-file__head">
										<button
											class="resolve-file__link"
											title="Open file"
											aria-label="Open ${f.path}"
											@click=${() => this.emit('resolve-open-file', { filePath: f.path })}
										>
											<code-icon icon="git-merge"></code-icon>
											<span class="resolve-file__path">${f.path}</span>
										</button>
									</div>
								</li>`,
						)}
					</ul>`
				: nothing}
			<div class="resolve-actions">
				<gl-ai-input
					multiline
					active
					rows="2"
					button-label=${focused?.length === 1 ? 'Resolve File with AI' : 'Resolve Conflicts with AI'}
					busy-label="Resolving conflicts…"
					event-name="resolve-run"
					placeholder='Optional guidance — e.g. "prefer incoming for generated files"'
					?disabled=${count === 0}
					.value=${this.lastPrompt}
				>
					<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
				</gl-ai-input>
			</div>
		`;
	}

	private renderReady(): unknown {
		const resolutions = this.resolutions ?? [];
		const errors = this.errors ?? [];
		const skipped = this.skipped ?? [];
		const applicable = resolutions.filter(r => r.strategy !== 'skipped').length;

		return html`
			<ul class="resolve-files" aria-label="Resolved files">
				${repeat(
					resolutions,
					r => r.filePath,
					r => this.renderResolution(r),
				)}
				${repeat(
					skipped,
					s => s.filePath,
					s => this.renderSkipped(s),
				)}
				${repeat(
					errors,
					e => e.filePath,
					e => this.renderError(e),
				)}
			</ul>
			<gl-ai-input
				class="resolve-refine"
				multiline
				rows="2"
				button-label="Refine"
				busy-label="Re-resolving…"
				event-name="resolve-refine"
				placeholder='Refine all — e.g. "prefer incoming for generated files"'
				.recall=${this.lastPrompt}
			>
				<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
			</gl-ai-input>
			<div class="resolve-footer">
				<gl-button appearance="secondary" @click=${() => this.emit('resolve-discard')}>Discard</gl-button>
				<gl-button ?disabled=${applicable === 0} @click=${() => this.emit('resolve-apply-all')}>
					Apply ${applicable > 0 ? pluralize('resolution', applicable) : 'all'}
				</gl-button>
			</div>
		`;
	}

	private renderResolution(r: ResolvedFileSummary): unknown {
		const display = strategyDisplay[r.strategy];
		const canViewDiff = r.virtualRef != null;
		const retrying = this.retryingFiles?.has(r.filePath) ?? false;
		const expanded = this._expandedRetry.has(r.filePath);
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<span
					class="resolve-file__badge ${display.warn ? 'resolve-file__badge--warn' : ''}"
					title="Resolution strategy"
				>
					<code-icon icon=${display.icon} size="11"></code-icon>${display.label}
				</span>
				<span class="resolve-file__path">${r.filePath}</span>
				${canViewDiff
					? html`<gl-tooltip content="View resolved changes">
							<gl-button
								appearance="toolbar"
								aria-label="View diff for ${r.filePath}"
								@click=${() => this.emit('resolve-view-diff', { filePath: r.filePath })}
							>
								<code-icon icon="diff"></code-icon>
							</gl-button>
						</gl-tooltip>`
					: nothing}
				<gl-tooltip content=${retrying ? 'Re-resolving…' : 'Retry with feedback'}>
					<gl-button
						appearance="toolbar"
						aria-label=${retrying ? `Re-resolving ${r.filePath}…` : `Retry ${r.filePath} with feedback`}
						aria-expanded=${expanded}
						?disabled=${retrying}
						@click=${() => this.toggleRetry(r.filePath)}
					>
						<code-icon
							icon=${retrying ? 'loading' : 'feedback'}
							modifier=${retrying ? 'spin' : ''}
						></code-icon>
					</gl-button>
				</gl-tooltip>
			</div>
			${r.reasoning ? html`<p class="resolve-file__reasoning">${r.reasoning}</p>` : nothing}
			${expanded
				? html`<gl-ai-input
						class="resolve-file__feedback"
						multiline
						rows="2"
						button-label="Retry"
						busy-label="Re-resolving…"
						event-name="resolve-row-retry"
						placeholder='What was wrong? e.g. "keep the new import, drop the old one"'
						.busy=${retrying}
						@resolve-row-retry=${(e: CustomEvent<{ prompt?: string }>) => this.onRowRetry(r.filePath, e)}
					></gl-ai-input>`
				: nothing}
		</li>`;
	}

	private toggleRetry(filePath: string): void {
		const next = new Set(this._expandedRetry);
		if (next.has(filePath)) {
			next.delete(filePath);
		} else {
			next.add(filePath);
		}
		this._expandedRetry = next;
	}

	/** Re-emit the row's `gl-ai-input` submit as `resolve-retry-file` carrying the file path (the
	 *  input only knows the prompt). Stop the inner event so it doesn't reach the host directly. */
	private onRowRetry(filePath: string, e: CustomEvent<{ prompt?: string }>): void {
		e.stopPropagation();
		const prompt = e.detail?.prompt;
		if (!prompt) return;

		// Collapse the feedback input on submit — while the retry is in flight, the row's feedback
		// toggle shows a spinner instead.
		const next = new Set(this._expandedRetry);
		next.delete(filePath);
		this._expandedRetry = next;

		this.emit('resolve-retry-file', { filePath: filePath, prompt: prompt });
	}

	/** A still-conflicted file the resolver couldn't auto-resolve (no parseable markers — binary,
	 *  unsupported type, …). Not a failure and not retryable: it needs manual resolution. */
	private renderSkipped(s: ResolveSkippedFile): unknown {
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<span class="resolve-file__badge resolve-file__badge--warn" title="Needs manual resolution">
					<code-icon icon="warning" size="11"></code-icon>needs review
				</span>
				<span class="resolve-file__path">${s.filePath}</span>
			</div>
			<p class="resolve-file__reasoning">${s.message}</p>
		</li>`;
	}

	private renderError(e: ResolveFileError): unknown {
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<code-icon class="resolve-file__error" icon="error"></code-icon>
				<span class="resolve-file__path">${e.filePath}</span>
			</div>
			<p class="resolve-file__reasoning resolve-file__error">${e.message}</p>
		</li>`;
	}

	private emit(name: string, detail?: unknown): void {
		this.dispatchEvent(new CustomEvent(name, { detail: detail, bubbles: true, composed: true }));
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-details-resolve-mode-panel': GlDetailsResolveModePanel;
	}
}
