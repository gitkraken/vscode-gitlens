import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Preferences } from '../../../../plus/graph/detailsProtocol.js';
import type { ConflictDetails, ConflictDetailsCommit, ConflictDetailsSide } from '../../../../rpc/services/types.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import type { CommitRowData } from './gl-commit-row.js';
import './gl-commit-row-item.js';
import '../../../shared/components/branch-name.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/commit-sha.js';
import '../../../shared/components/overlays/detail-sheet.js';
import '../../../shared/components/overlays/tooltip.js';
import '../../../shared/components/split-panel/split-panel.js';

export type ConflictSheetSide = 'current' | 'incoming';

export interface ConflictSheetSideEventDetail {
	side: ConflictSheetSide;
}
export interface ConflictSheetCommitEventDetail {
	sha: string;
}

/** Width (px) at/above which the two sides sit side-by-side; below it they stack. 46rem @ 1rem=10px. */
const sideBySideMinWidth = 460;

/**
 * Body content for the graph WIP "Conflict Details" sheet — a two-sided (current/incoming) view of a
 * conflicted file's per-side commit history, analogous to the tree-view `MergeConflictChangesNode`.
 * Owns its `gl-detail-sheet`; line-level resolution is delegated to VS Code (Open File / merge editor).
 *
 * The two sides live in a resizable `gl-split-panel` — side-by-side when wide, stacked when narrow (the
 * sheet measures its own width). Each side scrolls independently, so paging one side's history doesn't
 * move the other, and the split lets the user give a side more room (especially useful when stacked).
 *
 * Emits (bubbles + composed; the host maps these to repository actions using its file context):
 * - `conflict-open-changes` {side} — open the merge-base→side cumulative diff
 * - `conflict-stage` {side} — resolve the file by taking that side
 * - `conflict-open-commit` {sha} — open that commit's diff for the file
 * - `conflict-open-file` — open the conflicted working file
 * - `conflict-resolve-ai` — start the AI conflict resolution focused on this file
 * - `gl-detail-sheet-close` — re-emitted by the inner sheet on dismiss
 */
@customElement('gl-wip-conflict-sheet')
export class GlWipConflictSheet extends LitElement {
	static override styles = [
		scrollableBase,
		css`
			:host {
				display: block;
			}

			/* Border-box so the split-panel's height:100% on the slotted pane INCLUDES our padding —
	   otherwise the pane is taller than its grid cell and bleeds past the divider. */
			* {
				box-sizing: border-box;
			}

			.title {
				display: inline-flex;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;
			}

			.title code-icon {
				flex-shrink: 0;
				color: var(--vscode-editorWarning-foreground);
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
			}

			.sides {
				flex: 1 1 auto;
				min-height: 0;

				/* Thin (1px) divider so the splitter reads as a subtle hairline rather than a 4px gap;
				   the 8px grab hit-area is unchanged. */
				--gl-split-panel-divider-width: var(--gl-border-width);
			}

			/* Subtle hairline matching the sheet's own --vscode-widget-border edges (gl-detail-sheet
			   header/footer). The divider's own :hover/:active states still recolor it on grab. */
			.sides::part(divider) {
				background-color: var(--vscode-widget-border, var(--color-foreground--25));
			}

			.state {
				padding-block: var(--gl-space-20);
				padding-inline: var(--gl-space-16);
				color: var(--vscode-descriptionForeground);
				text-align: center;
			}

			.side-pane {
				display: flex;
				flex-direction: column;
				min-width: 0;
				min-height: 0;
				padding-block-start: var(--gl-space-12);

				/* Clip any sub-pixel remainder so content never paints into the divider track. */
				overflow: hidden;
			}

			.side__head {
				display: flex;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;
				padding-inline: var(--gl-space-12);
			}

			.side__icon {
				flex-shrink: 0;
				color: var(--vscode-descriptionForeground);
			}

			.side__name {
				flex-shrink: 0;
				font-weight: 600;
				color: var(--vscode-foreground);
			}

			.side__ref {
				min-width: 0;
			}

			.side__actions {
				display: flex;
				flex-shrink: 0;
				gap: var(--gl-space-2);
				align-items: center;
				margin-inline-start: auto;
			}

			.side__scroll {
				flex: 1 1 auto;
				min-height: 0;
				padding-block: var(--gl-space-6) var(--gl-space-12);
				padding-inline: var(--gl-space-12);
				overflow: hidden auto;

				/* Per-side scrollbar fade: reuse scrollableBase's thumb mechanic (transparent thumb whose
		   inset border inherits this element's border-color), but key visibility to THIS side's
		   pane — not the host — so hovering one side never reveals the other's scrollbar. */
				border-color: transparent;
				transition: border-color 1s linear;
			}

			.side-pane:hover .side__scroll,
			.side-pane:focus-within .side__scroll {
				border-color: var(--vscode-scrollbarSlider-background);
				transition: none;
			}

			.commits {
				padding: 0;
				margin: 0;
				list-style: none;
			}
		`,
	];

	@property({ type: Object })
	details?: ConflictDetails;

	@property({ type: Boolean })
	loading = false;

	@property({ type: Boolean })
	error = false;

	/** Basename of the conflicted file, for the sheet title. */
	@property({ type: String, attribute: 'file-name' })
	fileName = '';

	/** Whether AI is available — gates the header "Resolve Conflict with AI" action. */
	@property({ type: Boolean, attribute: 'ai-enabled' })
	aiEnabled = false;

	@property({ type: Object })
	preferences?: Preferences;

	/** Split orientation — flipped by width (side-by-side when wide, stacked when narrow). */
	@state()
	private _orientation: 'horizontal' | 'vertical' = 'horizontal';

	/** Split position (start panel %), user-adjustable via the divider. */
	@state()
	private _position = 50;

	private _resizeObserver?: ResizeObserver;

	override firstUpdated(): void {
		const body = this.shadowRoot?.querySelector('.body');
		if (body == null) return;

		this._resizeObserver = new ResizeObserver(entries => {
			const width = entries[0]?.contentRect.width ?? 0;
			if (width === 0) return;

			const next = width >= sideBySideMinWidth ? 'horizontal' : 'vertical';
			if (next !== this._orientation) {
				this._orientation = next;
			}
		});
		this._resizeObserver.observe(body);
	}

	override disconnectedCallback(): void {
		this._resizeObserver?.disconnect();
		this._resizeObserver = undefined;
		super.disconnectedCallback?.();
	}

	override render(): unknown {
		return html`<gl-detail-sheet aria-label="Conflict details" close-label="Close">
			<span slot="title" class="title">
				<code-icon icon="warning"></code-icon>
				<span class="title__name">Conflict · ${this.fileName}</span>
			</span>
			${this.aiEnabled
				? html`<gl-action-chip
						slot="actions"
						icon="sparkle"
						label="Resolve Conflict with AI (Preview)"
						overlay="tooltip"
						@click=${this.onResolveAi}
						><span>Resolve Conflicts</span></gl-action-chip
					>`
				: nothing}
			<gl-action-chip
				slot="actions"
				icon="go-to-file"
				label="Open File"
				overlay="tooltip"
				@click=${this.onOpenFile}
			></gl-action-chip>
			<div class="body">${this.renderContent()}</div>
		</gl-detail-sheet>`;
	}

	private renderContent(): unknown {
		if (this.loading) return html`<div class="state">Loading conflict details…</div>`;
		if (this.error) return html`<div class="state">Unable to load conflict details.</div>`;

		const details = this.details;
		if (details == null) return nothing;

		return html`<gl-split-panel
			class="sides"
			orientation=${this._orientation}
			.position=${this._position}
			@gl-split-panel-change=${this.onSplitChange}
		>
			${this.renderSide('current', 'gl-diff-left', 'Current', details.current, details.canStageCurrent, details)}
			${this.renderSide(
				'incoming',
				'gl-diff-right',
				'Incoming',
				details.incoming,
				details.canStageIncoming,
				details,
			)}
		</gl-split-panel>`;
	}

	private renderSide(
		side: ConflictSheetSide,
		icon: string,
		label: string,
		data: ConflictDetailsSide,
		canStage: boolean,
		details: ConflictDetails,
	): unknown {
		return html`<div slot=${side === 'current' ? 'start' : 'end'} class="side-pane">
			<header class="side__head">
				<code-icon class="side__icon" icon=${icon}></code-icon>
				<span class="side__name">${label}</span>
				<gl-tooltip class="side__ref" content=${data.refName}>${this.renderRefPill(data)}</gl-tooltip>
				<div class="side__actions">
					<gl-action-chip
						icon="diff-multiple"
						label="Open ${label} Changes"
						overlay="tooltip"
						@click=${() => this.emitSide('conflict-open-changes', side)}
					></gl-action-chip>
					${canStage
						? html`<gl-action-chip
								icon="check"
								label="Stage ${label} Changes"
								overlay="tooltip"
								@click=${() => this.emitSide('conflict-stage', side)}
							></gl-action-chip>`
						: nothing}
				</div>
			</header>
			<div class="side__scroll">${this.renderCommits(data, details.hasMergeBase)}</div>
		</div>`;
	}

	private renderRefPill(data: ConflictDetailsSide): unknown {
		return data.refKind === 'branch'
			? html`<gl-branch-name appearance="pill" .name=${data.refName} .size=${12} truncate></gl-branch-name>`
			: html`<gl-commit-sha appearance="pill" .sha=${data.refName} .size=${12}></gl-commit-sha>`;
	}

	private renderCommits(data: ConflictDetailsSide, hasMergeBase: boolean): unknown {
		if (!hasMergeBase) {
			return html`<div class="state">No merge base — commit history unavailable.</div>`;
		}
		if (data.commits.length === 0) {
			return html`<div class="state">No commits changed this file on this side.</div>`;
		}

		return html`<ul class="commits">
			${data.commits.map(
				c =>
					html`<li>
						<gl-commit-row-item
							placement="top"
							.commit=${this.toRow(c)}
							.preferences=${this.preferences}
							label="Open Changes for Commit ${c.shortSha}"
							@gl-commit-row-item-select=${() => this.emitCommit(c.sha)}
						></gl-commit-row-item>
					</li>`,
			)}
		</ul>`;
	}

	private toRow(c: ConflictDetailsCommit): CommitRowData {
		return {
			sha: c.sha,
			shortSha: c.shortSha,
			message: c.message,
			author: c.author,
			authorEmail: c.authorEmail,
			avatarUrl: c.avatarUrl,
			committerAvatarUrl: c.committerAvatarUrl,
			committerName: c.committerName,
			committerEmail: c.committerEmail,
			committerDate: c.committerDate != null ? new Date(c.committerDate).toISOString() : undefined,
			date: new Date(c.date).toISOString(),
		};
	}

	private onSplitChange = (e: CustomEvent<{ position: number }>): void => {
		this._position = e.detail.position;
	};

	private emitSide(type: 'conflict-open-changes' | 'conflict-stage', side: ConflictSheetSide): void {
		this.dispatchEvent(
			new CustomEvent<ConflictSheetSideEventDetail>(type, {
				detail: { side: side },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private emitCommit(sha: string): void {
		this.dispatchEvent(
			new CustomEvent<ConflictSheetCommitEventDetail>('conflict-open-commit', {
				detail: { sha: sha },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onOpenFile = (): void => {
		this.dispatchEvent(new CustomEvent('conflict-open-file', { bubbles: true, composed: true }));
	};

	private onResolveAi = (): void => {
		this.dispatchEvent(new CustomEvent('conflict-resolve-ai', { bubbles: true, composed: true }));
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-conflict-sheet': GlWipConflictSheet;
	}
}
