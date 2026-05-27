import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { AgentSessionPhase } from '@gitlens/agents/types.js';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import type { Preferences } from '../../../../commitDetails/protocol.js';
import type { OpenMultipleChangesArgs } from '../../actions/file.js';
import { renderCommitStatsIcons } from '../commit/commit-stats.js';
import type { TreeItemAction, TreeItemBase } from './base.js';
import type { FileGroup } from './file-tree-utils.js';
import type { FileChangeListItemDetail, FileItem } from './gl-file-tree-pane.js';
import './gl-file-tree-pane.js';
import '../button.js';
import '../code-icon.js';

type Files = Mutable<FileItem[]>;

@customElement('gl-wip-tree-pane')
export class GlWipTreePane extends LitElement {
	static override styles = css`
		/* Establish the named container on this host so the @container query below resolves
		   in the same shadow scope as the rule (cross-shadow container lookup is spotty). */
		:host {
			flex: 1 1 0%;
			display: flex;
			container-type: inline-size;
			container-name: gl-wip-tree-pane;
		}

		/* Pin the button to a stable height in both expanded and collapsed states so the
		   header doesn't jump vertically when the label hides. Uses px (not rem) to be
		   immune to root-font-size differences across webview themes. 28px covers the
		   natural icon+text height (~27.5px) so collapsed and expanded match. */
		gl-button {
			min-height: 28px;
		}

		/* Collapse the Stash label to icon-only when the pane runs out of room.
		   display:none cleanly removes the slotted flex item so the button's internal gap
		   collapses too — true icon-only, no half-clipped text. The custom properties get
		   set on gl-file-tree-pane (a descendant of the gl-wip-tree-pane container, since
		   :host IS the container and so isn't matched by @container rules) and inherit
		   into its shadow so the surrounding action gaps collapse too. The button's
		   tooltip="Stash Changes" keeps it accessible when the label is hidden. */
		@container gl-wip-tree-pane (max-width: 340px) {
			.stash-label {
				display: none !important;
			}
			gl-file-tree-pane {
				--gl-header-actions-gap: 0;
				--gl-leading-action-trailing-gap: 0;
			}
		}

		.subtitle-stats {
			opacity: 1;
		}
	`;

	@property({ type: Array })
	files?: readonly FileItem[];

	@property({ type: Object })
	stats?: GitCommitStats;

	@property({ type: Boolean })
	collapsable = true;

	@property({ type: Boolean, attribute: 'show-file-icons' })
	showFileIcons = false;

	@property({ attribute: false })
	fileActions?: TreeItemAction[] | ((file: FileItem, options?: Partial<TreeItemBase>) => TreeItemAction[]);

	@property({ attribute: false })
	fileContext?: (file: FileItem) => string | undefined;

	@property({ attribute: false })
	folderContext?: (folder: { name: string; relativePath: string; repoPath?: string }) => string | undefined;

	@property({ attribute: 'empty-text' })
	emptyText = 'No Files';

	@property({ type: Object, attribute: 'search-context' })
	searchContext?: GitCommitSearchContext;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ type: Boolean })
	checkable = false;

	@property({ attribute: false })
	checkableStates?: Map<string, { state?: 'checked' | 'mixed'; disabled?: boolean; disabledReason?: string }>;

	@property({ attribute: false })
	checkableStateDefault?: { state?: 'checked' | 'mixed'; disabled?: boolean; disabledReason?: string };

	@property({ attribute: false })
	multiDiff?: { repoPath: string; lhs: string; rhs: string; wip?: boolean; title?: string };

	/** Opt-in for the bulk "Stage Current/Incoming for All Conflicts" toolbar buttons.
	 * Off by default — only the graph WIP panel wires the resolve-all events and only enables
	 * this when the paused operation is a rebase (the host bulk resolver bails otherwise),
	 * so leaving it false keeps the buttons hidden in the inspect view and during merge/
	 * cherry-pick/revert pauses where clicks would silently no-op. */
	@property({ type: Boolean, attribute: 'bulk-conflict-actions' })
	bulkConflictActions = false;

	/** Repo-relative normalized paths the connected agent(s) are actively editing, mapped to the
	 *  agent's phase. Pass-through to `gl-file-tree-pane`. */
	@property({ attribute: false })
	agentTouchedFiles?: ReadonlyMap<string, AgentSessionPhase>;

	/**
	 * Controlled-when-bound: parent-supplied visibility of the file-tree search box. Forwarded
	 * to `gl-file-tree-pane`. Hosts that leave it undefined get the uncontrolled default.
	 */
	@property({ attribute: 'show-search-box', type: Boolean })
	showSearchBox?: boolean;

	/** Controlled-when-bound: parent-supplied search-box filter mode (`true` = filter, `false` = highlight). */
	@property({ type: Boolean, attribute: 'search-box-filter' })
	searchBoxFilter?: boolean;

	private _effectiveFiles: Files = [];
	private _effectiveStates?: Map<
		string,
		{ state?: 'checked' | 'mixed'; disabled?: boolean; disabledReason?: string }
	>;
	private _grouping?: { getGroup: (file: FileItem) => string; groups: FileGroup[] };
	private _wrappedActions:
		| TreeItemAction[]
		| ((file: FileItem, options?: Partial<TreeItemBase>) => TreeItemAction[])
		| undefined;
	/** Paths with both staged and unstaged hunks. Computed in checkbox mode during dedup; kept on
	 *  the instance so the dispatch overrides for `file-compare-wip` (alt-click) and
	 *  `file-compare-wip-staged` (inline button) can recognize the deduped row as mixed. */
	private _mixedPaths: Set<string> = new Set();

	override willUpdate(changedProperties: PropertyValues): void {
		if (
			!changedProperties.has('files') &&
			!changedProperties.has('checkable') &&
			!changedProperties.has('checkableStates') &&
			!changedProperties.has('checkableStateDefault') &&
			!changedProperties.has('fileActions')
		) {
			return;
		}

		const files = (this.files as Files) ?? [];

		let effectiveFiles: Files;
		let effectiveStates: Map<string, { state?: 'checked' | 'mixed'; disabled?: boolean }> | undefined;
		let grouping: { getGroup: (file: FileItem) => string; groups: FileGroup[] } | undefined;
		let mixedPaths: Set<string> = new Set();

		if (this.checkable) {
			// In checkbox mode, deduplicate files and compute mixed states
			const dedup = this.deduplicateFiles(files);
			const deduped = dedup.deduped;
			mixedPaths = dedup.mixedPaths;
			effectiveFiles = deduped;

			// Merge computed mixed states into caller-provided checkableStates
			if (mixedPaths.size > 0 || this.checkableStates) {
				effectiveStates = new Map(this.checkableStates);
				for (const path of mixedPaths) {
					const existing = effectiveStates.get(path);
					effectiveStates.set(path, { ...existing, state: 'mixed' });
				}
			} else {
				effectiveStates = this.checkableStates;
			}

			// Default: staged files are checked
			if (!this.checkableStateDefault) {
				// Build states from staging when no explicit states provided
				for (const f of deduped) {
					if (!effectiveStates?.has(f.path) && !mixedPaths.has(f.path)) {
						effectiveStates ??= new Map();
						if (f.staged) {
							effectiveStates.set(f.path, { state: 'checked' });
						}
					}
				}
			}
		} else {
			// Non-checkbox mode: group conflicts above staged/unstaged so unresolved files
			// surface at the top.
			effectiveFiles = files;
			effectiveStates = this.checkableStates;
			grouping = {
				getGroup: (file: FileItem) =>
					isConflictStatus(file.status) ? 'conflicts' : file.staged ? 'staged' : 'unstaged',
				groups: [
					{ key: 'conflicts', label: 'Conflicts', actions: [] },
					{ key: 'staged', label: 'Staged Changes', actions: this.getStagedActions() },
					{ key: 'unstaged', label: 'Unstaged Changes', actions: this.getUnstagedActions() },
				],
			};
		}

		// When a file appears in BOTH staged and unstaged, downstream action callbacks need to
		// know so they can offer Stage AND Unstage actions instead of one inferred from the
		// canonical (unstaged) FileItem we kept during dedup.
		const callerActions = this.fileActions;
		this._wrappedActions =
			typeof callerActions === 'function'
				? (file, options) => callerActions(file, { ...(options ?? {}), mixed: mixedPaths.has(file.path) })
				: callerActions;

		this._effectiveFiles = effectiveFiles;
		this._effectiveStates = effectiveStates;
		this._grouping = grouping;
		this._mixedPaths = mixedPaths;
	}

	override render() {
		const files = (this.files as Files) ?? [];
		const multiDiff = this.multiDiff;
		const buttons: ('layout' | 'search' | 'multi-diff')[] | undefined = multiDiff
			? ['layout', 'search', 'multi-diff']
			: undefined;

		return html`<gl-file-tree-pane
			.files=${this._effectiveFiles}
			.collapsable=${this.collapsable}
			?show-file-icons=${this.showFileIcons}
			.searchContext=${this.searchContext}
			.fileActions=${this._wrappedActions}
			.fileContext=${this.fileContext}
			.folderContext=${this.folderContext}
			.filesLayout=${this.preferences?.files}
			.showIndentGuides=${this.preferences?.indentGuides}
			.grouping=${this._grouping}
			?checkable=${this.checkable}
			.checkableStates=${this._effectiveStates}
			.checkableStateDefault=${this.checkableStateDefault}
			.agentTouchedFiles=${this.agentTouchedFiles}
			.buttons=${buttons}
			.showSearchBox=${this.showSearchBox}
			.searchBoxFilter=${this.searchBoxFilter}
			empty-text=${this.emptyText}
			selection-badge-label="Staged"
			selection-action="file-compare-wip"
			check-verb="Stage"
			uncheck-verb="Unstage"
			@gl-check-all=${this.onCheckAll}
			@file-compare-wip=${this.onFileCompareWip}
			@file-compare-wip-staged=${this.onFileCompareWipStaged}
			@gl-file-tree-pane-open-multi-diff=${multiDiff ? () => this.onOpenMultiDiff(multiDiff) : null}
		>
			<span class="subtitle-stats" slot="subtitle">${this.renderStats()}</span>
			${this.renderConflictBulkActions(files)}
			${files.length > 0
				? html`<gl-button
						slot="leading-actions"
						appearance="toolbar"
						tooltip="Stash Changes"
						@click=${this.onStashSave}
					>
						<code-icon icon="gl-stash-save" slot="prefix"></code-icon>
						<span class="stash-label">Stash</span>
					</gl-button>`
				: nothing}
			<slot name="before-tree" slot="before-tree"></slot>
		</gl-file-tree-pane>`;
	}

	private renderConflictBulkActions(files: Files) {
		if (!this.bulkConflictActions || !files.some(f => isConflictStatus(f.status))) return nothing;

		return html`<gl-button
				slot="leading-actions"
				appearance="toolbar"
				density="compact"
				tooltip="Stage Current for All Conflicts"
				aria-label="Stage Current for All Conflicts"
				@click=${this.onResolveAllCurrent}
			>
				<code-icon icon="gl-accept-all-left"></code-icon>
			</gl-button>
			<gl-button
				slot="leading-actions"
				appearance="toolbar"
				density="compact"
				tooltip="Stage Incoming for All Conflicts"
				aria-label="Stage Incoming for All Conflicts"
				@click=${this.onResolveAllIncoming}
			>
				<code-icon icon="gl-accept-all-right"></code-icon>
			</gl-button>`;
	}

	private onResolveAllCurrent = () => {
		this.dispatchEvent(new CustomEvent('resolve-all-current', { bubbles: true, composed: true }));
	};

	private onResolveAllIncoming = () => {
		this.dispatchEvent(new CustomEvent('resolve-all-incoming', { bubbles: true, composed: true }));
	};

	private onStashSave() {
		this.dispatchEvent(new CustomEvent('stash-save', { bubbles: true, composed: true }));
	}

	// TODO: Button hidden — bulk discard-unstaged is punted until multiselect lands in trees
	// See https://github.com/gitkraken/vscode-gitlens/pull/5207#pullrequestreview-4286302741
	private onDiscardUnstaged() {
		this.dispatchEvent(new CustomEvent('discard-unstaged', { bubbles: true, composed: true }));
	}

	private onOpenMultiDiff(refs: { repoPath: string; lhs: string; rhs: string; wip?: boolean; title?: string }): void {
		const files = this.files;
		if (!files?.length) return;

		this.dispatchEvent(
			new CustomEvent('open-multiple-changes', {
				detail: {
					files: files,
					repoPath: refs.repoPath,
					lhs: refs.lhs,
					rhs: refs.rhs,
					wip: refs.wip,
					title: refs.title,
				} satisfies OpenMultipleChangesArgs,
				bubbles: true,
				composed: true,
			}),
		);
	}

	private renderStats() {
		return renderCommitStatsIcons(this.stats) ?? nothing;
	}

	private deduplicateFiles(files: Files): { deduped: Files; mixedPaths: Set<string> } {
		const deduped: Files = [];
		const mixedPaths = new Set<string>();
		const seen = new Map<string, number>();

		for (const f of files) {
			const idx = seen.get(f.path);
			if (idx != null) {
				mixedPaths.add(f.path);
				// Keep the unstaged version as canonical so single-row mixed files expose
				// `staged: false` — matching the `unstaged > staged > committed` precedence
				// applied by the AI-compose path (see `anchorRank` in graphWebview.ts).
				// Inline tree actions still see `options.mixed === true` (wrapped above) and
				// offer both Stage and Unstage; this only fixes the right-click menu, which
				// keys off `webviewItem` derived from `file.staged`.
				if (!f.staged && deduped[idx].staged) {
					deduped[idx] = f;
				}
			} else {
				seen.set(f.path, deduped.length);
				deduped.push(f);
			}
		}

		return { deduped: deduped, mixedPaths: mixedPaths };
	}

	private getStagedActions(): TreeItemAction[] {
		return [
			{
				icon: 'gl-cloud-patch-share',
				label: 'Share Staged Changes',
				action: 'staged-create-patch',
			},
		];
	}

	private getUnstagedActions(): TreeItemAction[] {
		return [
			{
				icon: 'gl-cloud-patch-share',
				label: 'Share Unstaged Changes',
				action: 'unstaged-create-patch',
			},
		];
	}

	private onCheckAll(e: CustomEvent<{ checked: boolean }>): void {
		e.stopPropagation();

		this.dispatchEvent(
			new CustomEvent(e.detail.checked ? 'stage-all' : 'unstage-all', {
				bubbles: true,
				composed: true,
			}),
		);
	}

	/**
	 * Forks the default WIP row click so:
	 *  - Conflicted rows fall back to `file-open` (the conflict markers are easier to deal with in
	 *    the file itself than in a diff).
	 *  - Mixed rows with Alt held flip the dispatched event to the staged-portion diff
	 *    (HEAD ↔ index) — independent of the natural staged flag carried by the deduped canonical
	 *    row, which always points at the unstaged portion. The `viewColumn` is cleared so Alt
	 *    means "open staged" and *not* the global "open in side editor" — the user is choosing one
	 *    semantic over the other for this surface.
	 *  - All other rows fall through untouched so the host's `file-compare-wip` handler resolves
	 *    them via the file's natural `staged` flag.
	 */
	private onFileCompareWip = (e: CustomEvent<FileChangeListItemDetail>): void => {
		const detail = e.detail;
		if (isConflictStatus(detail.status)) {
			e.stopPropagation();
			this.dispatchEvent(new CustomEvent('file-open', { detail: detail, bubbles: true, composed: true }));
			return;
		}

		if (detail.altKey && this._mixedPaths.has(detail.path)) {
			e.stopPropagation();
			this.dispatchFileCompareWipStaged(detail, { clearViewColumn: true });
		}
	};

	/** Bridge the inline "Open Staged Changes" button (`file-compare-wip-staged`) into the host's
	 *  `file-compare-wip` listener with `staged: true` overridden so the diff resolves to staged ↔
	 *  HEAD regardless of the row's canonical staged flag (unstaged for deduped mixed rows).
	 *  `viewColumn` is preserved so Alt+click on the button keeps its standard "open in side
	 *  editor" meaning — the button already encodes the "open staged" intent. */
	private onFileCompareWipStaged = (e: CustomEvent<FileChangeListItemDetail>): void => {
		e.stopPropagation();
		this.dispatchFileCompareWipStaged(e.detail);
	};

	private dispatchFileCompareWipStaged(
		detail: FileChangeListItemDetail,
		options?: { clearViewColumn?: boolean },
	): void {
		const showOptions =
			detail.showOptions != null && options?.clearViewColumn
				? { ...detail.showOptions, viewColumn: undefined }
				: detail.showOptions;
		this.dispatchEvent(
			new CustomEvent('file-compare-wip', {
				detail: { ...detail, staged: true, showOptions: showOptions } satisfies FileChangeListItemDetail,
				bubbles: true,
				composed: true,
			}),
		);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-tree-pane': GlWipTreePane;
	}
}
