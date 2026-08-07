import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { pluralize } from '@gitlens/utils/string.js';
import type {
	AutoRebaseSummary,
	AutoRebaseSummaryStep,
	ResolvedFileSummary,
	UndoAutoRebaseResult,
} from '../../../../plus/graph/graphService.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import {
	confidenceLevel,
	manualResolutionDisplay,
	measureReasoningOverflow,
	renderConfidence,
	renderConsulted,
	renderReasoning,
	resolveDisplayStyles,
	strategyDisplay,
} from './resolveDisplay.js';
import { SheetWrapper } from './sheetWrapper.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/overlays/detail-sheet.js';
import '../../../shared/components/overlays/popover-confirm.js';
import '../../../shared/components/overlays/tooltip.js';

export interface RebaseSummaryViewDiffDetail {
	step: number;
	filePath: string;
}

/**
 * Body content for the "Automatic Rebase" summary sheet — the end-of-run review of every conflict
 * an automatic rebase resolved, grouped by the step (commit) where it paused, with per-file
 * strategy/confidence/reasoning rows and before/after diffs, plus the validated Undo.
 *
 * Owns its `gl-detail-sheet` (selection-decoupled, like the compare and conflict sheets) and its
 * own fetch/undo lifecycle — the panel injects {@link GlRebaseSummarySheet.getSummary} and
 * {@link GlRebaseSummarySheet.undoRebase} to wrap its service calls. Emits (bubbles + composed):
 * - `rebase-summary-view-diff` {step, filePath} — open that file's resolved-vs-conflicted diff
 * - `gl-detail-sheet-close` — re-emitted by the inner sheet on dismiss, and on a successful undo
 */
@customElement('gl-rebase-summary-sheet')
export class GlRebaseSummarySheet extends SheetWrapper(LitElement) {
	static override styles = [
		scrollableBase,
		resolveDisplayStyles,
		css`
			:host {
				display: block;
			}

			* {
				box-sizing: border-box;
			}

			.title {
				display: inline-flex;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;
			}

			.title__name {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.body {
				display: flex;
				flex: 1 1 auto;
				flex-direction: column;
				min-height: 0;
				overflow-y: auto;
			}

			.state {
				padding-block: var(--gl-space-20);
				padding-inline: var(--gl-space-16);
				color: var(--vscode-descriptionForeground);
				text-align: center;
			}

			.overview {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-4);
				padding-block: var(--gl-space-12);
				padding-inline: var(--gl-space-16);
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, transparent);
			}

			.overview__line {
				display: flex;
				flex-wrap: wrap;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;
			}

			.overview__counts {
				color: var(--vscode-descriptionForeground);
			}

			.banner {
				display: flex;
				gap: var(--gl-space-6);
				align-items: baseline;
				margin-block-start: var(--gl-space-4);
				padding: var(--gl-space-6) var(--gl-space-8);
				color: var(--vscode-inputValidation-warningForeground, inherit);
				background: var(--vscode-inputValidation-warningBackground, transparent);
				border: var(--gl-border-width) solid var(--vscode-inputValidation-warningBorder, transparent);
				border-radius: var(--gl-radius-sm);
			}

			.banner--error {
				color: var(--vscode-inputValidation-errorForeground, var(--vscode-errorForeground));
				background: var(--vscode-inputValidation-errorBackground, transparent);
				border-color: var(--vscode-inputValidation-errorBorder, transparent);
			}

			.steps {
				display: flex;
				flex: 1 1 auto;
				flex-direction: column;
				padding-block-end: var(--gl-space-12);
			}

			/* The header has to read as a band that owns the rows beneath it. It can't tint itself with
			   the sideBar-background (the sheet body's own surface) or with the
			   sideBarSectionHeader-background (identical to it in the default themes) — either way the
			   band and its rows paint the same color and the steps blur into one wash. Deriving the tint
			   from the foreground contrasts against whatever surface the host provides. */
			.step__head {
				--step-accent: color-mix(in srgb, var(--vscode-descriptionForeground) 60%, transparent);

				position: sticky;
				top: 0;
				z-index: 1;
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				width: 100%;
				padding-block: var(--gl-space-6);
				padding-inline: var(--gl-space-16);
				font: inherit;
				color: inherit;
				text-align: start;
				cursor: pointer;
				background: color-mix(
					in srgb,
					var(--vscode-foreground) 8%,
					var(--vscode-sideBar-background, var(--vscode-editor-background))
				);
				border: none;
				border-block: var(--gl-border-width) solid var(--vscode-widget-border, transparent);
				/* Outcome accent down the band's edge — the same signal as the header's badge, but
				   scannable while the rows are what's actually being read. */
				box-shadow: inset 0.3rem 0 0 0 var(--step-accent);
			}

			/* The overview closes with its own border, so the first band doesn't need a top rule too. */
			.steps > .step__head:first-child {
				border-block-start: none;
			}

			.step__head[data-kind='empty-skipped'] {
				--step-accent: var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
			}

			.step__head[data-kind='manual'] {
				--step-accent: var(--vscode-textLink-foreground);
			}

			/* Two-line header: label + badge on top, commit sha + message beneath. */
			.step__body {
				display: flex;
				flex: 1;
				flex-direction: column;
				gap: var(--gl-space-2);
				min-width: 0;
			}

			.step__primary,
			.step__secondary {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;
			}

			.step__label {
				flex: none;
				font-weight: 600;
			}

			.step__message {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				color: var(--vscode-descriptionForeground);
				font-size: var(--gl-font-sm);
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			.step__count {
				flex: none;
				color: var(--vscode-descriptionForeground);
				font-size: var(--gl-font-sm);
			}

			.step__skipped {
				flex: none;
				color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground));
				font-size: var(--gl-font-sm);
				font-variant: all-small-caps;
			}

			.step__manual {
				flex: none;
				color: var(--vscode-descriptionForeground);
				font-size: var(--gl-font-sm);
				font-variant: all-small-caps;
			}

			/* Indent the rows behind a rail so they read as belonging to the band above, and close the
			   group with trailing space — a boundary alone still left adjacent steps ambiguous about
			   which header owned which rows. */
			.files {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				margin-block: 0 var(--gl-space-12);
				margin-inline: var(--gl-space-24) 0;
				padding-block: var(--gl-space-8);
				padding-inline: var(--gl-space-12) var(--gl-space-16);
				list-style: none;
				border-inline-start: 0.2rem solid
					color-mix(in srgb, var(--vscode-descriptionForeground) 45%, transparent);
			}

			.resolve-file__head {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;
			}

			/* Matches the resolve panel's row anatomy — left-packed path with trailing ellipsis. */
			.resolve-file__path {
				flex: 1;
				min-width: 0;
				overflow: hidden;
				font-weight: 600;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			/* Reasoning is indented to hang under the file row's badge; the indent lives on the wrapper so
			   the "see more" button lines up with the text rather than the row. */
			.resolve-file__reason {
				margin-top: var(--gl-space-4);
				padding-inline-start: var(--gl-space-16);
			}

			.resolve-file__reasoning {
				margin: 0;
				color: var(--vscode-descriptionForeground);
				white-space: pre-wrap;
			}

			.footer {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				justify-content: flex-end;
				width: 100%;
			}
		`,
	];

	/** The session to summarize — driven by the parent. Triggers {@link fetchSummary} on change. */
	@property({ type: String, attribute: 'repo-path' })
	repoPath = '';

	/** Injected fetcher — the parent binds this to wrap its own service call and await service
	 *  readiness. Throwing (or resolving `undefined`) surfaces as {@link _error}. */
	@property({ attribute: false })
	getSummary?: (repoPath: string) => Promise<AutoRebaseSummary | undefined>;

	/** Injected undo — the parent binds this to wrap its own service call. Preserves
	 *  `undoAutoRebase`'s success/error contract; this component decides how to react. */
	@property({ attribute: false })
	undoRebase?: (repoPath: string, sessionId: string) => Promise<UndoAutoRebaseResult>;

	@state() private _summary?: AutoRebaseSummary;
	@state() private _loading = false;
	@state() private _error?: string;
	/** An undo RPC is in flight — disables the footer actions. */
	@state() private _undoing = false;
	/** Error from a failed/refused undo — shown as a banner; the Undo button disables. */
	@state() private _undoError?: string;

	/** Read-only — lets the panel resolve a step/file to its `virtualRef` for View Changes without
	 *  duplicating the fetched summary in its own state. */
	get summary(): AutoRebaseSummary | undefined {
		return this._summary;
	}

	@state()
	private _collapsedSteps = new Set<number>();

	@state()
	private _openReasons = new Set<string>();

	/** Rows whose clamped reasoning is taller than the clamp, so a "see more" is worth offering.
	 *  Measured from the DOM after each render — see {@link measureReasoningOverflow}. */
	@state()
	private _overflowingReasons = new Set<string>();

	override render(): unknown {
		return html`<gl-detail-sheet esc-managed aria-label="Automatic rebase summary" close-label="Close">
			<span slot="title" class="title">
				<code-icon icon="gl-merge"></code-icon>
				<span class="title__name">Automatic Rebase Summary</span>
			</span>
			<div class="body scrollable">${this.renderContent()}</div>
			${this.renderFooter()}
		</gl-detail-sheet>`;
	}

	override willUpdate(changed: PropertyValues<this>): void {
		if (changed.has('repoPath') && this.repoPath) {
			void this.fetchSummary(this.repoPath);
		}
	}

	override updated(changed: PropertyValues<this>): void {
		// The refusal banner lives at the top of the body, which can be scrolled well past it (the
		// sheet is only as tall as the details pane) — the user would confirm a destructive action and
		// see nothing change. `nearest` keeps the correction to the body instead of realigning every
		// scroll ancestor.
		// Cast because `keyof` excludes private members, but private @state fields still land in the
		// change map — same reason rebase.ts casts for `_conflictFilesLayout`.
		if (changed.has('_undoError' as keyof GlRebaseSummarySheet) && this._undoError) {
			this.renderRoot.querySelector('.banner--error')?.scrollIntoView({ block: 'nearest' });
		}

		// Whether a reasoning block is actually clipped can only be known from the laid-out DOM, so the
		// "see more" affordance is decided here rather than from the text. Returns undefined when nothing
		// changed, which keeps this from looping (the assignment re-renders).
		const overflowing = measureReasoningOverflow(this.renderRoot, this._overflowingReasons);
		if (overflowing != null) {
			this._overflowingReasons = overflowing;
		}
	}

	private async fetchSummary(repoPath: string): Promise<void> {
		this._loading = true;
		this._error = undefined;
		this._summary = undefined;
		this._undoError = undefined;

		let summary: AutoRebaseSummary | undefined;
		let error: string | undefined;
		try {
			summary = await this.getSummary?.(repoPath);
			if (summary == null) {
				error = 'No automatic rebase summary is available.';
			}
		} catch (ex) {
			error = ex instanceof Error ? ex.message : 'Unable to load the rebase summary.';
		}

		if (this.repoPath !== repoPath) return; // superseded by a newer open mid-flight

		this._loading = false;
		this._error = error;
		this._summary = summary;
	}

	private renderContent(): unknown {
		if (this._loading) return html`<div class="state">Loading rebase summary…</div>`;
		if (this._error) return html`<div class="state">${this._error}</div>`;

		const summary = this.summary;
		if (summary == null) return nothing;

		const fileCount = summary.steps.reduce((sum, s) => sum + s.files.length, 0);
		return html`${this.renderOverview(summary, fileCount)}
		${
			summary.steps.length === 0
				? html`<div class="state">No conflicts were encountered — every commit applied cleanly.</div>`
				: html`<div class="steps">${summary.steps.map(step => this.renderStep(step))}</div>`
		}`;
	}

	private renderOverview(summary: AutoRebaseSummary, fileCount: number): unknown {
		const emptiedCount = summary.steps.reduce((n, s) => (s.kind === 'empty-skipped' ? n + 1 : n), 0);
		const outcomeLabel =
			summary.outcome === 'completed'
				? 'completed'
				: summary.outcome === 'undone'
					? 'undone'
					: summary.outcome === 'escalated'
						? 'stopped for review'
						: summary.outcome;
		return html`<div class="overview">
			<div class="overview__line">
				${summary.branch ? html`<gl-branch-name .name=${summary.branch}></gl-branch-name>` : nothing}
				${
					summary.upstream
						? html`<span>onto</span><gl-branch-name .name=${summary.upstream}></gl-branch-name>`
						: nothing
				}
			</div>
			<div class="overview__counts">
				Rebase
				${outcomeLabel}${
					summary.steps.length > 0
						? html` · ${pluralize('conflicted file', fileCount)} resolved across
							${pluralize('step', summary.steps.length)}`
						: nothing
				}${
					// Steps git dropped for being empty aren't commits on the branch — the counts above would
					// otherwise read as "every step landed".
					emptiedCount > 0 ? html` · ${pluralize('commit', emptiedCount)} skipped as empty` : nothing
				}
			</div>
			${
				summary.autostash === 'left-in-stash'
					? html`<div class="banner">
							<code-icon icon="warning" size="12"></code-icon>
							<span
								>Your uncommitted changes conflicted when re-applied after the rebase — they are safe in
								the stash, and the working tree still shows the conflicted application.</span
							>
						</div>`
					: nothing
			}
			${
				this._undoError
					? html`<div class="banner banner--error">
							<code-icon icon="error" size="12"></code-icon><span>${this._undoError}</span>
						</div>`
					: nothing
			}
		</div>`;
	}

	private renderStep(step: AutoRebaseSummaryStep): unknown {
		const collapsed = this._collapsedSteps.has(step.step);
		// The stored rebase message includes git's appended "# Conflicts:" comment block — show
		// only the summary line; the full message stays on the tooltip.
		const messageLine = (step.commit.message ?? '').split('\n', 1)[0];
		return html`<button
				type="button"
				class="step__head"
				data-kind=${step.kind}
				aria-expanded=${!collapsed}
				@click=${() => this.toggleStep(step.step)}
			>
				<code-icon icon=${collapsed ? 'chevron-right' : 'chevron-down'} size="12"></code-icon>
				<span class="step__body">
					<span class="step__primary">
						<span class="step__label">Conflict in Step ${step.step} of ${step.totalSteps}</span>
						${
							step.kind === 'empty-skipped'
								? html`<gl-tooltip content="The resolution made this commit empty, so it was skipped">
										<span class="step__skipped">commit skipped</span>
									</gl-tooltip>`
								: step.kind === 'manual'
									? html`<gl-tooltip
											content="Automation couldn't resolve this step — you resolved it manually"
										>
											<span class="step__manual">resolved manually</span>
										</gl-tooltip>`
									: nothing
						}
					</span>
					<span class="step__secondary">
						${step.commit.sha ? html`<gl-commit-sha .sha=${step.commit.sha}></gl-commit-sha>` : nothing}
						<span class="step__message" title=${step.commit.message ?? ''}>${messageLine}</span>
					</span>
				</span>
				<span class="step__count">${pluralize('conflicted file', step.files.length)}</span>
			</button>
			${
				collapsed
					? nothing
					: html`<ul class="files">
							${step.files.map(f => this.renderFile(step, f))}
						</ul>`
			}`;
	}

	private renderFile(step: AutoRebaseSummaryStep, file: ResolvedFileSummary): unknown {
		// The user resolved this step's files after automation escalated, so the record's strategy and
		// its synthesized confidence describe the AI's abandoned attempt, not the applied resolution —
		// badge the human outcome and drop the confidence pips rather than credit the AI for it.
		const manual = step.kind === 'manual';
		const display = manual ? manualResolutionDisplay : strategyDisplay[file.strategy];
		const reasonKey = `${step.step}:${file.filePath}`;
		const reasonOpen = this._openReasons.has(reasonKey);
		return html`<li class="resolve-file">
			<div class="resolve-file__head">
				<span
					class="resolve-file__badge ${display.warn ? 'resolve-file__badge--warn' : ''}"
					title="Resolution strategy"
				>
					<code-icon icon=${display.icon} size="11"></code-icon
					><span class="resolve-file__badge-text">${display.label}</span>
				</span>
				<span class="resolve-file__path" title=${file.filePath}>${file.filePath}</span>
				${manual ? nothing : renderConfidence(confidenceLevel(file.confidence))}
				${
					file.virtualRef != null
						? html`<gl-button
								appearance="toolbar"
								aria-label="View resolved changes for ${file.filePath}"
								@click=${() => this.emitViewDiff(step.step, file.filePath)}
							>
								<code-icon icon="diff"></code-icon>
							</gl-button>`
						: nothing
				}
			</div>
			${renderReasoning(reasonKey, file.reasoning, {
				expanded: reasonOpen,
				overflowing: this._overflowingReasons.has(reasonKey),
				filePath: file.filePath,
				onToggle: () => this.toggleReason(reasonKey),
			})}
			${renderConsulted(file.consulted, file.filePath)}
		</li>`;
	}

	private renderFooter(): unknown {
		const summary = this.summary;
		if (summary == null || this._loading || this._error) return nothing;

		// `undoError` intentionally doesn't disable the button — a refusal surfaces in the overview
		// banner and can be retried by reopening the popover. `undoing` disables it during the RPC.
		const undoDisabled = !summary.undoable || this._undoing;
		const label = this._undoing ? 'Undoing…' : 'Undo Rebase';

		let undo;
		if (summary.undoable) {
			const message = `Reset ${summary.branch ?? 'the branch'} to ${summary.preRebaseSha.slice(
				0,
				7,
			)}? Commits created by the rebase will be discarded.${
				summary.undoWillStash ? ' Your working changes will be stashed first.' : ''
			}`;
			undo = html`<gl-popover-confirm
				heading="Undo Rebase"
				message=${message}
				confirm="Undo"
				@gl-confirm=${this.onConfirmUndo}
			>
				<gl-button slot="anchor" appearance="secondary" ?disabled=${undoDisabled}>${label}</gl-button>
			</gl-popover-confirm>`;
		} else {
			const button = html`<gl-button appearance="secondary" ?disabled=${undoDisabled}>${label}</gl-button>`;
			undo =
				summary.undoRefusal != null
					? html`<gl-tooltip content=${summary.undoRefusal}>${button}</gl-tooltip>`
					: button;
		}

		return html`<div slot="footer" class="footer">
			${undo}
			<gl-button @click=${this.onKeep}>OK</gl-button>
		</div>`;
	}

	private toggleStep(step: number): void {
		const next = new Set(this._collapsedSteps);
		if (next.has(step)) {
			next.delete(step);
		} else {
			next.add(step);
		}
		this._collapsedSteps = next;
	}

	private toggleReason(key: string): void {
		const next = new Set(this._openReasons);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		this._openReasons = next;
	}

	private emitViewDiff(step: number, filePath: string): void {
		this.dispatchEvent(
			new CustomEvent<RebaseSummaryViewDiffDetail>('rebase-summary-view-diff', {
				detail: { step: step, filePath: filePath },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onConfirmUndo = (): void => {
		void this.undo();
	};

	private async undo(): Promise<void> {
		const summary = this._summary;
		if (summary == null || this._undoing || this.undoRebase == null) return;

		this._undoing = true;
		this._undoError = undefined;

		let error: string | undefined;
		try {
			const result = await this.undoRebase(this.repoPath, summary.sessionId);
			if ('error' in result) {
				error = result.error.message;
			}
		} catch {
			error = 'Unable to undo the rebase.';
		}

		if (this._summary !== summary) return; // superseded by a newer open mid-flight

		if (error == null) {
			// Success closes the sheet — the graph refreshes via the repo change the reset fires.
			this.onKeep();
			return;
		}

		this._undoing = false;
		this._undoError = error;
	}

	private onKeep = (): void => {
		this.dispatchEvent(new CustomEvent('gl-detail-sheet-close', { bubbles: true, composed: true }));
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-rebase-summary-sheet': GlRebaseSummarySheet;
	}
}
