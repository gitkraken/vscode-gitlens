import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import { classifyConflictAction, getConflictKindLabel } from '@gitlens/git/utils/conflictResolution.utils.js';
import { pluralize } from '@gitlens/utils/string.js';
import type {
	ConflictResolutionStrategy,
	ConflictSide,
	ResolvedFileSummary,
	ResolveFileError,
	ResolveSkippedFile,
} from '../../../../plus/graph/graphService.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import type { TreeItemCheckedDetail } from '../../../shared/components/tree/base.js';
import type { FileChangeListItemDetail } from '../../../shared/components/tree/gl-file-tree-pane.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { renderErrorState, renderLoadingState } from './shared-panel-templates.js';
import { panelErrorStyles, panelHostStyles, panelLoadingStageStyles, panelLoadingStyles } from './shared-panel.css.js';
import { prunePathsToFiles } from './aiExclusion.js';
import '../../../shared/components/ai-input.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/gl-ai-model-chip.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/panes/pane-group.js';
import '../../../shared/components/tree/gl-file-tree-pane.js';
import './gl-converging-loading-animation.js';

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
 * and review — like compose, it curates a checkable file set (here the paused op's conflicted
 * files) rather than a commit scope, and has no Back/Resume (apply is terminal). States: `idle`
 * (a checkable tree of the conflicted files + a Resolve button), `loading` (streamed progress),
 * `ready` (per-file resolutions + Apply/Discard), `applying` (uncancellable overlay), and `error`.
 */
@customElement('gl-details-resolve-mode-panel')
export class GlDetailsResolveModePanel extends LitElement {
	static override styles = [
		panelHostStyles,
		panelLoadingStyles,
		panelLoadingStageStyles,
		panelErrorStyles,
		scrollableBase,
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
				flex: 1;
				min-height: 0;
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
				border-top: var(--gl-border-width) solid var(--vscode-panel-border);
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

			/* Idle-state checkable conflict tree — fills the space between the intro and the run input. */
			.resolve-tree {
				display: flex;
				flex: 1;
				flex-direction: column;
				min-height: 0;
				overflow: hidden;
			}

			/* The pane group is a flex child with no intrinsic grow — without this it stays at content
			   height and the inner gl-file-tree-pane (flex:1; min-height:0; overflow:hidden) collapses its
			   tree to ~0 and clips every row. Mirrors the .scope-files__tree webview-pane-group rule in
			   shared-panel.css.ts (compose's file curation). */
			.resolve-tree webview-pane-group {
				flex: 1;
				min-height: 0;
				overflow: hidden;
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

			/* Manual take-side fallback actions on a skipped/errored row. */
			.resolve-file__actions {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-4);
				margin-top: var(--gl-space-2);
			}

			.resolve-footer {
				display: flex;
				flex: none;
				gap: var(--gl-space-6);
				padding: var(--gl-space-6) var(--gl-space-12);
				border-top: var(--gl-border-width) solid var(--vscode-panel-border);
			}

			/* Apply fills the row (primary, full-width treatment) with Discard inline on the right. */
			.resolve-apply {
				flex: 1;
				min-width: 0;
			}

			/* The per-row "Retry with feedback" button is a toggle — show the standard active-toggle
			   background while its feedback input is open (keyed off the existing aria-expanded). */
			.resolve-file__head gl-button[aria-expanded='true'] {
				--button-background: var(--vscode-inputOption-activeBackground);
				--button-foreground: var(--vscode-inputOption-activeForeground);
				--button-border: var(--vscode-inputOption-activeBorder);
			}

			.resolve-actions {
				display: flex;
				flex: none;
				flex-direction: column;
				gap: var(--gl-space-4);
				padding: var(--gl-space-6) var(--gl-space-12);
			}

			/* Match compose/review loading spacing: breathing room above + below the Cancel button. */
			.resolve-cancel {
				align-self: center;
				margin-top: var(--gl-space-10);
				margin-bottom: var(--gl-space-12);
			}

			/* Per-row feedback input, indented under its file. */
			.resolve-file__feedback {
				display: block;
				margin-top: var(--gl-space-4);
			}

			/* Bottom whole-run refine input — mirrors the composer's active AI-input treatment
			   (gradient border via the active attr) plus its centered, width-constrained layout
			   from the .review-action-input rule in shared-panel.css.ts. */
			.review-action-input {
				flex: none;
				width: calc(100% - var(--gl-panel-padding-left, 1.2rem) - var(--gl-panel-padding-right, 1.2rem));
				max-width: var(--gl-max-input);
				margin: 0.6rem auto 0.8rem;
			}
		`,
	];

	@property({ attribute: 'status' }) status: ResolveModeStatus = 'idle';
	@property() errorMessage?: string;
	@property({ type: Array }) resolutions?: readonly ResolvedFileSummary[];
	@property({ type: Array }) errors?: readonly ResolveFileError[];
	@property({ type: Array }) skipped?: readonly ResolveSkippedFile[];
	@property({ type: Array }) conflictedFiles?: readonly GitFileChangeShape[];
	/** Drives the per-conflict DEFAULT checked state (per-file/multi-select entry defaults just these
	 *  on; undefined = all on). The live run scope is the user-editable {@link includedFiles}, NOT this. */
	@property({ type: Array }) focusedPaths?: readonly string[];
	@property() progressMessage?: string;
	@property({ type: Object }) aiModel?: AiModelInfo;
	/** Engaged anchor's repo path — part of the seed identity so following selection to another WIP
	 *  anchor reseeds (the panel element is reused across anchor switches, not re-mounted). */
	@property() repoPath?: string;
	/** Persisted file-tree layout preference, threaded to the idle `gl-file-tree-pane`. */
	@property() fileLayout: ViewFilesLayout = 'auto';
	/** Paths currently being re-resolved with feedback — drives the per-row busy state. */
	@property({ type: Object }) retryingFiles?: ReadonlySet<string>;
	/** Paths currently being manually resolved via a take-side fallback — drives the per-row busy state. */
	@property({ type: Object }) stagingFiles?: ReadonlySet<string>;
	/** The whole-run prompt, recalled into the "Refine" input (ArrowUp). */
	@property() lastPrompt?: string;

	/** Rows whose per-file feedback input is expanded. Panel-local UI state. */
	@state() private _expandedRetry = new Set<string>();
	/** User check/uncheck DELTAS against the per-anchor default (resolve-all → all checked; focused
	 *  entry → just the focused paths). The effective checked set is DERIVED from the current conflicts
	 *  plus these deltas (see {@link includedFiles}/{@link isChecked}), so it always reflects the live
	 *  conflicts — a conflict resolved away drops out, a new one appears under the default — with no
	 *  stale stored set to reconcile. Reset when the anchor/focus identity changes. */
	@state() private _userChecked = new Set<string>();
	@state() private _userUnchecked = new Set<string>();
	/** Anchor+focus identity the deltas belong to. The panel element is REUSED when following selection
	 *  to another WIP anchor (hide→restore collapses to one render), so deltas must reset on identity
	 *  change here rather than relying on a fresh instance; `repoPath` is in the key so two resolve-all
	 *  anchors don't share key 'all' and leak deltas. */
	private _seedKey: string | undefined;

	/** The live checked set, read by the host's `resolve-run` handler to scope the run. Derived from
	 *  the CURRENT conflicts so it never includes a path that is no longer conflicted. */
	get includedFiles(): ReadonlySet<string> {
		const checked = new Set<string>();
		for (const f of this.conflictedFiles ?? []) {
			if (this.isChecked(f.path)) {
				checked.add(f.path);
			}
		}
		return checked;
	}

	/** Default-checked state for a conflict: resolve-all entry checks everything; a focused entry
	 *  (single/multi-file) checks only its paths. */
	private isCheckedByDefault(path: string): boolean {
		return this.focusedPaths == null || this.focusedPaths.length === 0 || this.focusedPaths.includes(path);
	}

	/** Effective checked state = the default, overridden by the user's explicit check/uncheck delta. */
	private isChecked(path: string): boolean {
		if (this._userChecked.has(path)) return true;
		if (this._userUnchecked.has(path)) return false;
		return this.isCheckedByDefault(path);
	}

	override willUpdate(changedProperties: Map<string, unknown>): void {
		// Reset the user deltas when the anchor/focus identity changes (fresh entry, or following
		// selection to another WIP). Gated to the identity inputs so the sort+join isn't recomputed on
		// unrelated reactive updates (progressMessage, retryingFiles, …).
		if (changedProperties.has('focusedPaths') || changedProperties.has('repoPath')) {
			const focusKey = this.focusedPaths != null ? `focus:${[...this.focusedPaths].sort().join('\n')}` : 'all';
			const seedKey = `${this.repoPath ?? ''}|${focusKey}`;
			if (this._seedKey !== seedKey) {
				this._seedKey = seedKey;
				this._userChecked = new Set();
				this._userUnchecked = new Set();
				return;
			}
		}

		// Drop deltas for paths no longer conflicted so a stale uncheck can't resurrect to suppress a
		// path that drops then re-conflicts in the same session (and the sets don't grow unbounded).
		// `prunePathsToFiles` skips the transient empty/undefined `conflictedFiles` during refetch.
		if (changedProperties.has('conflictedFiles')) {
			const checked = prunePathsToFiles(this._userChecked, this.conflictedFiles);
			if (checked != null) {
				this._userChecked = checked;
			}
			const unchecked = prunePathsToFiles(this._userUnchecked, this.conflictedFiles);
			if (unchecked != null) {
				this._userUnchecked = unchecked;
			}
		}
	}

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
		// Converging-streams animation sits behind the spinner + progress + cancel as decoration;
		// it self-disables under prefers-reduced-motion.
		return html`
			<div class="panel-loading-stage">
				<gl-converging-loading-animation class="panel-loading-stage__anim"></gl-converging-loading-animation>
				<div class="panel-loading-stage__foreground">
					${renderLoadingState(this.progressMessage ?? 'Resolving conflicts…')}
					<gl-button
						class="resolve-cancel"
						appearance="secondary"
						@click=${() => this.emit('resolve-cancel')}
					>
						Cancel
					</gl-button>
				</div>
			</div>
		`;
	}

	private renderIdle(): unknown {
		const files = this.conflictedFiles ?? [];

		// Only checked files carry a state entry; the rest default to unchecked.
		let checkedCount = 0;
		const checkableStates = new Map<string, { state?: 'checked' }>();
		for (const f of files) {
			if (this.isChecked(f.path)) {
				checkableStates.set(f.path, { state: 'checked' });
				checkedCount++;
			}
		}

		return html`
			<p class="resolve-intro">
				Choose the conflicts to resolve with AI, then review each resolution before applying.
			</p>
			<div class="resolve-tree">
				<webview-pane-group flexible>
					<gl-file-tree-pane
						.files=${files}
						?checkable=${true}
						?multi-selectable=${true}
						?show-file-icons=${true}
						.collapsable=${false}
						.filesLayout=${{ layout: this.fileLayout }}
						.checkableStates=${checkableStates}
						selection-action="file-open"
						check-verb="Resolve"
						uncheck-verb="Skip"
						empty-text="No conflicted files"
						@file-checked=${this.onFileChecked}
						@gl-check-all=${this.onToggleCheckAll}
						@file-open=${(e: CustomEvent<FileChangeListItemDetail>) =>
							this.emit('resolve-open-file', { filePath: e.detail.path })}
					></gl-file-tree-pane>
				</webview-pane-group>
			</div>
			<div class="resolve-actions">
				<gl-ai-input
					multiline
					active
					rows="2"
					button-label="Resolve"
					busy-label="Resolving conflicts…"
					event-name="resolve-run"
					placeholder='Optional guidance — e.g. "prefer incoming for generated files"'
					?disabled=${checkedCount === 0}
					.value=${this.lastPrompt}
				>
					<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
				</gl-ai-input>
			</div>
		`;
	}

	/** Toggle a single conflicted file in/out of the resolve set. */
	private onFileChecked(e: CustomEvent<TreeItemCheckedDetail>): void {
		if (!e.detail.context) return;

		const [file] = e.detail.context as unknown as GitFileChangeShape[];
		if (!file) return;

		const checked = new Set(this._userChecked);
		const unchecked = new Set(this._userUnchecked);
		this.applyChecked(file.path, e.detail.checked, checked, unchecked);
		this._userChecked = checked;
		this._userUnchecked = unchecked;
	}

	/** Check/uncheck-all from the tree header — applies to all conflicted paths (the resolve tree has
	 *  no search box, so `gl-check-all` carries every conflict, not a filtered subset). */
	private onToggleCheckAll(e: CustomEvent<{ checked: boolean; paths: readonly string[] }>): void {
		const checked = new Set(this._userChecked);
		const unchecked = new Set(this._userUnchecked);
		for (const path of e.detail.paths) {
			this.applyChecked(path, e.detail.checked, checked, unchecked);
		}
		this._userChecked = checked;
		this._userUnchecked = unchecked;
	}

	/** Record `path`'s new checked state as a delta from its default — clearing the delta when the
	 *  state matches the default so the sets stay minimal and keep tracking future default changes. */
	private applyChecked(path: string, checked: boolean, userChecked: Set<string>, userUnchecked: Set<string>): void {
		userChecked.delete(path);
		userUnchecked.delete(path);
		if (checked !== this.isCheckedByDefault(path)) {
			(checked ? userChecked : userUnchecked).add(path);
		}
	}

	private renderReady(): unknown {
		const resolutions = this.resolutions ?? [];
		const errors = this.errors ?? [];
		const skipped = this.skipped ?? [];
		const applicable = resolutions.filter(r => r.strategy !== 'skipped').length;

		return html`
			<ul class="resolve-files scrollable" aria-label="Resolved files">
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
			<div class="resolve-footer">
				<gl-button
					class="resolve-apply"
					full
					?disabled=${applicable === 0}
					@click=${() => this.emit('resolve-apply-all')}
				>
					Apply ${applicable > 0 ? pluralize('Resolution', applicable) : 'all'}
				</gl-button>
				<gl-button appearance="secondary" @click=${() => this.emit('resolve-discard')}>Discard</gl-button>
			</div>
			<gl-ai-input
				class="review-action-input"
				multiline
				active
				rows="2"
				button-label="Refine"
				busy-label="Re-resolving…"
				event-name="resolve-refine"
				placeholder='Refine all — e.g. "prefer incoming for generated files"'
				.recall=${this.lastPrompt}
			>
				<gl-ai-model-chip slot="footer" .model=${this.aiModel}></gl-ai-model-chip>
			</gl-ai-input>
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
						active
						rows="1"
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
	 *  symlink, mode, rename, …). Not retryable with AI, but the user can take a side manually. */
	private renderSkipped(s: ResolveSkippedFile): unknown {
		const badge = s.kind != null ? getConflictKindLabel(s.kind, s.renameOf).label : 'needs review';
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<span class="resolve-file__badge resolve-file__badge--warn" title="Needs manual resolution">
					<code-icon icon="warning" size="11"></code-icon>${badge}
				</span>
				<span class="resolve-file__path">${s.filePath}</span>
			</div>
			<p class="resolve-file__reasoning">${s.message}</p>
			${this.renderFallbackActions(s)}
		</li>`;
	}

	/** A file the AI resolver errored on. Offer the same manual take-side fallback so the user isn't
	 *  dead-ended — taking a side doesn't depend on the AI succeeding. When the conflict type is known
	 *  (binary/symlink/rename/…), label it so a non-text conflict doesn't read as a generic failure. */
	private renderError(e: ResolveFileError): unknown {
		const kindLabel = e.kind != null ? getConflictKindLabel(e.kind, e.renameOf).label : undefined;
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<code-icon class="resolve-file__error" icon="error"></code-icon>
				${kindLabel != null
					? html`<span class="resolve-file__badge resolve-file__badge--warn" title="Conflict type"
							><code-icon icon="warning" size="11"></code-icon>${kindLabel}</span
						>`
					: nothing}
				<span class="resolve-file__path">${e.filePath}</span>
			</div>
			<p class="resolve-file__reasoning resolve-file__error">${e.message}</p>
			${this.renderFallbackActions(e)}
		</li>`;
	}

	/** Manual take-side actions for a skipped/errored row, gated by which sides have content to take.
	 *  Renders nothing when the file is no longer conflicted (no status) or no side can be taken. */
	private renderFallbackActions(file: ResolveSkippedFile | ResolveFileError): unknown {
		const status = file.conflictStatus;
		if (status == null) {
			return html`<p class="resolve-file__reasoning">This file is no longer conflicted.</p>`;
		}

		const staging = this.stagingFiles?.has(file.filePath) ?? false;
		// For delete-modify / rename-delete (UD/DU), one stageable side resolves to a delete rather than
		// keeping content — label that button "Delete file" so the action isn't surprising.
		const sideLabel = (side: 'current' | 'incoming') =>
			classifyConflictAction(status, side) === 'delete'
				? 'Delete file'
				: side === 'current'
					? 'Take current'
					: 'Take incoming';

		const buttons: unknown[] = [];
		if (file.canStageCurrent) {
			buttons.push(this.renderTakeSideButton(file.filePath, 'current', sideLabel('current'), staging));
		}
		if (file.canStageIncoming) {
			buttons.push(this.renderTakeSideButton(file.filePath, 'incoming', sideLabel('incoming'), staging));
		}
		// both-deleted (DD): neither side has content — the only resolution is to confirm the deletion.
		if (!file.canStageCurrent && !file.canStageIncoming && file.kind === 'both-deleted') {
			buttons.push(this.renderTakeSideButton(file.filePath, 'delete', 'Delete file', staging));
		}
		if (buttons.length === 0) return nothing;

		return html`<div class="resolve-file__actions">${buttons}</div>`;
	}

	private renderTakeSideButton(filePath: string, side: ConflictSide, label: string, staging: boolean): unknown {
		return html`<gl-button
			appearance="secondary"
			density="compact"
			aria-label="${label} for ${filePath}"
			?disabled=${staging}
			@click=${() => this.emit('resolve-take-side', { filePath: filePath, side: side })}
		>
			${staging ? html`<code-icon icon="loading" modifier="spin"></code-icon>` : nothing}${label}
		</gl-button>`;
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
