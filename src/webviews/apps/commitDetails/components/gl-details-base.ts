import type { CSSResultGroup, TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { property } from 'lit/decorators.js';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { FileShowOptions, Preferences, State } from '../../../commitDetails/protocol.js';
import type { OpenMultipleChangesArgs } from '../../shared/actions/file.js';
import { renderCommitStatsIcons } from '../../shared/components/commit/commit-stats.js';
import { ContextMenuProxyController } from '../../shared/controllers/context-menu-proxy.js';
import type { TreeItemAction, TreeItemBase } from '../../shared/components/tree/base.js';
import { detailsBaseStyles } from './gl-details-base.css.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/tree/gl-file-tree-pane.js';

type Files = Mutable<NonNullable<NonNullable<State['commit']>['files']>>;
export type File = Files[0];
type Mode = 'commit' | 'stash' | 'wip';

export interface FileChangeListItemDetail extends File {
	showOptions?: FileShowOptions;
	/** Present when a `batch` inline action fires on a multi-selection — the full selected set so the
	 * consumer can act once (e.g. one combined discard confirm) instead of per-file. */
	files?: readonly GitFileChangeShape[];
}

export class GlDetailsBase extends LitElement {
	static override styles: CSSResultGroup = detailsBaseStyles;

	// Bridges the file tree's `data-vscode-context` (set on `gl-tree-item` rows, deep in shadow DOM)
	// to this light-DOM host so VS Code's native context menu can read it. Shared by all subclasses
	// (commit + WIP panels) so neither needs a bespoke contextmenu handler.
	private readonly _contextMenuProxy = new ContextMenuProxyController(this);

	@property({ reflect: true })
	variant: 'standalone' | 'embedded' = 'standalone';

	@property({ type: Array })
	files?: Files;

	/** Opt-in native multi-select for the changed-files tree. Forwarded to `gl-file-tree-pane`. */
	@property({ type: Boolean, attribute: 'multi-selectable' })
	multiSelectable = false;

	@property({ type: Boolean })
	isUncommitted = false;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ type: Object })
	orgSettings?: State['orgSettings'];

	@property({ type: Object })
	searchContext?: State['searchContext'];

	@property({ type: Boolean, attribute: 'file-icons' })
	fileIcons = false;

	@property({ type: Boolean, attribute: 'files-collapsable' })
	filesCollapsable = true;

	@property({ type: Boolean })
	hasAccount = false;

	@property({ type: Boolean })
	hasIntegrationsConnected = false;

	@property({ attribute: 'empty-text' })
	emptyText? = 'No Files';

	/**
	 * Controlled-when-bound: parent-supplied visibility of the file-tree search box. Forwarded
	 * to `gl-file-tree-pane`. Hosts that don't set it (e.g. the standalone inspect view) leave
	 * the pane in its uncontrolled default.
	 */
	@property({ type: Boolean, attribute: 'show-search-box' })
	showSearchBox?: boolean;

	/** Controlled-when-bound: parent-supplied search-box filter mode (`true` = filter, `false` = highlight). */
	@property({ type: Boolean, attribute: 'search-box-filter' })
	searchBoxFilter?: boolean;

	protected _getFileActions = (file: File, opts?: Partial<TreeItemBase>) => this.getFileActions(file, opts);
	protected _getFileContext = (file: File) => this.getFileContext(file);
	protected _getFolderContext = (folder: { name: string; relativePath: string; repoPath?: string }) =>
		this.getFolderContext(folder);
	protected _onFileChecked = (e: CustomEvent) => this.onFileChecked(e);

	protected renderChangedFiles(
		_mode: Mode,
		options?: {
			stats?: import('@gitlens/git/models/commit.js').GitCommitStats;
			multiDiff?: { repoPath: string; lhs: string; rhs: string; wip?: boolean; title?: string };
			loading?: boolean;
		},
	): TemplateResult<1> {
		const multiDiff = options?.multiDiff;
		const buttons: ('layout' | 'search' | 'multi-diff')[] | undefined = multiDiff
			? ['layout', 'search', 'multi-diff']
			: undefined;

		// Cold-cache transition: when the embedded panel has been handed a "lite" commit shell
		// (files == null) while a full fetch is in flight, suppress the empty-text and render
		// a spinner in the before-tree slot — same pattern as gl-details-compare-mode-panel —
		// so users don't read "No Files" as a final answer during the brief load.
		const isLoadingEmpty = options?.loading === true && !this.files?.length;

		return html`
			<gl-file-tree-pane
				.files=${this.files}
				.filesLayout=${this.preferences?.files}
				.showIndentGuides=${this.preferences?.indentGuides}
				.collapsable=${this.filesCollapsable}
				?show-file-icons=${this.fileIcons}
				.fileActions=${this._getFileActions}
				.fileContext=${this._getFileContext}
				.folderContext=${this._getFolderContext}
				.searchContext=${this.searchContext}
				.buttons=${buttons}
				?multi-selectable=${this.multiSelectable}
				.showSearchBox=${this.showSearchBox}
				.searchBoxFilter=${this.searchBoxFilter}
				empty-text=${isLoadingEmpty ? '' : (this.emptyText ?? 'No Files')}
				@file-checked=${this._onFileChecked}
				@gl-file-tree-pane-open-multi-diff=${multiDiff ? () => this.onOpenMultiDiff(multiDiff) : null}
				@gl-file-tree-pane-open-selected-changes=${multiDiff
					? (e: CustomEvent<{ files: readonly GitFileChangeShape[] }>) =>
							this.onOpenSelectedChanges(e, multiDiff)
					: null}
			>
				${options?.stats
					? html`<span class="commit-stats-subtitle" slot="subtitle"
							>${this.renderCommitStats(options.stats)}</span
						>`
					: nothing}
				${isLoadingEmpty
					? html`<div slot="before-tree" class="files-loading" aria-busy="true">
							<code-icon icon="loading" modifier="spin"></code-icon>
							<span>Loading…</span>
						</div>`
					: nothing}
				${this.renderChangedFilesSlottedContent()}
			</gl-file-tree-pane>
		`;
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

	private onOpenSelectedChanges(
		e: CustomEvent<{ files: readonly GitFileChangeShape[] }>,
		refs: { repoPath: string; lhs: string; rhs: string; wip?: boolean; title?: string },
	): void {
		const files = e.detail?.files;
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

	protected onFileChecked(_e: CustomEvent): void {
		// Override in subclasses to handle file checked events (e.g., stage/unstage)
	}

	protected renderChangedFilesSlottedContent(): TemplateResult<1> | typeof nothing {
		return nothing;
	}

	protected renderCommitStats(stats?: GitCommitStats) {
		return renderCommitStatsIcons(stats, { includeLineStats: true });
	}

	protected onShareWipChanges(_e: Event, staged: boolean, hasFiles: boolean): void {
		if (!hasFiles) return;

		const event = new CustomEvent('share-wip', {
			detail: {
				checked: staged,
			},
		});
		this.dispatchEvent(event);
	}

	protected getFileActions(_file: File, _options?: Partial<TreeItemBase>): TreeItemAction[] {
		return [];
	}

	protected getFileContext(_file: File): string | undefined {
		return undefined;
	}

	protected getFolderContext(_folder: { name: string; relativePath: string; repoPath?: string }): string | undefined {
		return undefined;
	}
}
