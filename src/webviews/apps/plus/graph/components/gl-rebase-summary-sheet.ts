import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { pluralize } from '@gitlens/utils/string.js';
import type {
	AutoRebaseSummary,
	AutoRebaseSummaryStep,
	ResolvedFileSummary,
} from '../../../../plus/graph/graphService.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import { confidenceLevel, renderConfidence, resolveDisplayStyles, strategyDisplay } from './resolveDisplay.js';
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
 * Owns its `gl-detail-sheet` (selection-decoupled, like the compare and conflict sheets). Data is
 * fetched by the details panel; this component is presentational and emits (bubbles + composed):
 * - `rebase-summary-view-diff` {step, filePath} — open that file's resolved-vs-conflicted diff
 * - `rebase-summary-undo` — the user confirmed the inline undo
 * - `gl-detail-sheet-close` — re-emitted by the inner sheet on dismiss
 */
@customElement('gl-rebase-summary-sheet')
export class GlRebaseSummarySheet extends LitElement {
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

			.step__head {
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
				background: var(--vscode-sideBar-background, var(--vscode-editor-background));
				border: none;
				border-bottom: var(--gl-border-width) solid var(--vscode-widget-border, transparent);
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

			.files {
				display: flex;
				flex-direction: column;
				gap: var(--gl-space-8);
				margin: 0;
				padding: var(--gl-space-8) var(--gl-space-16);
				list-style: none;
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

			.resolve-file__reason-toggle {
				display: inline-flex;
				gap: var(--gl-space-4);
				align-items: center;
				padding: 0;
				font-size: var(--gl-font-sm);
				color: var(--vscode-textLink-foreground);
				cursor: pointer;
				background: none;
				border: none;
			}

			.resolve-file__reasoning {
				margin: var(--gl-space-4) 0 0;
				padding-inline-start: var(--gl-space-16);
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

	@property({ type: Object })
	summary?: AutoRebaseSummary;

	@property({ type: Boolean })
	loading = false;

	@property({ type: String })
	error?: string;

	/** An undo RPC is in flight — disables the footer actions. */
	@property({ type: Boolean })
	undoing = false;

	/** Error from a failed/refused undo — shown as a banner; the Undo button disables. */
	@property({ type: String, attribute: 'undo-error' })
	undoError?: string;

	@state()
	private _collapsedSteps = new Set<number>();

	@state()
	private _openReasons = new Set<string>();

	override render(): unknown {
		return html`<gl-detail-sheet aria-label="Automatic rebase summary" close-label="Close">
			<span slot="title" class="title">
				<code-icon icon="gl-merge"></code-icon>
				<span class="title__name">Automatic Rebase Summary</span>
			</span>
			<div class="body scrollable">${this.renderContent()}</div>
			${this.renderFooter()}
		</gl-detail-sheet>`;
	}

	private renderContent(): unknown {
		if (this.loading) return html`<div class="state">Loading rebase summary…</div>`;
		if (this.error) return html`<div class="state">${this.error}</div>`;

		const summary = this.summary;
		if (summary == null) return nothing;

		const fileCount = summary.steps.reduce((sum, s) => sum + s.files.length, 0);
		return html`${this.renderOverview(summary, fileCount)}
		${summary.steps.length === 0
			? html`<div class="state">No conflicts were encountered — every commit applied cleanly.</div>`
			: html`<div class="steps">${summary.steps.map(step => this.renderStep(step))}</div>`}`;
	}

	private renderOverview(summary: AutoRebaseSummary, fileCount: number): unknown {
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
				${summary.upstream
					? html`<span>onto</span><gl-branch-name .name=${summary.upstream}></gl-branch-name>`
					: nothing}
			</div>
			<div class="overview__counts">
				Rebase
				${outcomeLabel}${summary.steps.length > 0
					? html` · ${pluralize('conflicted file', fileCount)} resolved across
						${pluralize('step', summary.steps.length)}`
					: nothing}
			</div>
			${summary.autostash === 'left-in-stash'
				? html`<div class="banner">
						<code-icon icon="warning" size="12"></code-icon>
						<span
							>Your uncommitted changes conflicted when re-applied after the rebase — they are safe in the
							stash, and the working tree still shows the conflicted application.</span
						>
					</div>`
				: nothing}
			${this.undoError
				? html`<div class="banner banner--error">
						<code-icon icon="error" size="12"></code-icon><span>${this.undoError}</span>
					</div>`
				: nothing}
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
				aria-expanded=${!collapsed}
				@click=${() => this.toggleStep(step.step)}
			>
				<code-icon icon=${collapsed ? 'chevron-right' : 'chevron-down'} size="12"></code-icon>
				<span class="step__body">
					<span class="step__primary">
						<span class="step__label">Conflict in Step ${step.step} of ${step.totalSteps}</span>
						${step.kind === 'empty-skipped'
							? html`<gl-tooltip content="The resolution made this commit empty, so it was skipped">
									<span class="step__skipped">commit skipped</span>
								</gl-tooltip>`
							: step.kind === 'manual'
								? html`<gl-tooltip
										content="Automation couldn't resolve this step — you resolved it manually"
									>
										<span class="step__manual">resolved manually</span>
									</gl-tooltip>`
								: nothing}
					</span>
					<span class="step__secondary">
						${step.commit.sha ? html`<gl-commit-sha .sha=${step.commit.sha}></gl-commit-sha>` : nothing}
						<span class="step__message" title=${step.commit.message ?? ''}>${messageLine}</span>
					</span>
				</span>
				<span class="step__count">${pluralize('conflicted file', step.files.length)}</span>
			</button>
			${collapsed
				? nothing
				: html`<ul class="files">
						${step.files.map(f => this.renderFile(step.step, f))}
					</ul>`}`;
	}

	private renderFile(step: number, file: ResolvedFileSummary): unknown {
		const display = strategyDisplay[file.strategy];
		const reasonKey = `${step}:${file.filePath}`;
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
				${renderConfidence(confidenceLevel(file.confidence))}
				${file.virtualRef != null
					? html`<gl-button
							appearance="toolbar"
							aria-label="View resolved changes for ${file.filePath}"
							@click=${() => this.emitViewDiff(step, file.filePath)}
						>
							<code-icon icon="diff"></code-icon>
						</gl-button>`
					: nothing}
			</div>
			${file.reasoning
				? html`<button
							type="button"
							class="resolve-file__reason-toggle"
							aria-expanded=${reasonOpen}
							@click=${() => this.toggleReason(reasonKey)}
						>
							<code-icon icon=${reasonOpen ? 'chevron-down' : 'chevron-right'} size="10"></code-icon>Why
							this resolution
						</button>
						${reasonOpen ? html`<p class="resolve-file__reasoning">${file.reasoning}</p>` : nothing}`
				: nothing}
		</li>`;
	}

	private renderFooter(): unknown {
		const summary = this.summary;
		if (summary == null || this.loading || this.error) return nothing;

		// `undoError` intentionally doesn't disable the button — a refusal surfaces in the overview
		// banner and can be retried by reopening the popover. `undoing` disables it during the RPC.
		const undoDisabled = !summary.undoable || this.undoing;
		const label = this.undoing ? 'Undoing…' : 'Undo Rebase';

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
		this.dispatchEvent(new CustomEvent('rebase-summary-undo', { bubbles: true, composed: true }));
	};

	private onKeep = (): void => {
		this.dispatchEvent(new CustomEvent('gl-detail-sheet-close', { bubbles: true, composed: true }));
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-rebase-summary-sheet': GlRebaseSummarySheet;
	}
}
