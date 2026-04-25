import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { Preferences } from '../../../../commitDetails/protocol.js';
import type { OpenMultipleChangesArgs } from '../../actions/file.js';
import { renderCommitStatsIcons } from '../commit/commit-stats.js';
import type { TreeItemAction, TreeItemBase } from './base.js';
import type { FileGroup } from './file-tree-utils.js';
import type { FileItem } from './gl-file-tree-pane.js';
import './gl-file-tree-pane.js';
import '../button.js';
import '../code-icon.js';

type Files = Mutable<FileItem[]>;

@customElement('gl-wip-tree-pane')
export class GlWipTreePane extends LitElement {
	static override styles = css`
		:host {
			flex: 1 1 0%;
			display: flex;
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

	@property({ type: Object, attribute: 'search-context' })
	searchContext?: GitCommitSearchContext;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ type: Boolean })
	checkable = false;

	@property({ attribute: false })
	checkableStates?: Map<string, { state?: 'checked' | 'mixed'; disabled?: boolean }>;

	@property({ attribute: false })
	checkableStateDefault?: { state?: 'checked' | 'mixed'; disabled?: boolean };

	@property({ attribute: false })
	multiDiff?: { repoPath: string; lhs: string; rhs: string; title?: string };

	private _effectiveFiles: Files = [];
	private _effectiveStates?: Map<string, { state?: 'checked' | 'mixed'; disabled?: boolean }>;
	private _grouping?: { getGroup: (file: FileItem) => string; groups: FileGroup[] };
	private _wrappedActions:
		| TreeItemAction[]
		| ((file: FileItem, options?: Partial<TreeItemBase>) => TreeItemAction[])
		| undefined;

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
			// Non-checkbox mode: group by staged/unstaged
			effectiveFiles = files;
			effectiveStates = this.checkableStates;
			grouping = {
				getGroup: (file: FileItem) => (file.staged ? 'staged' : 'unstaged'),
				groups: [
					{ key: 'staged', label: 'Staged Changes', actions: this.getStagedActions() },
					{ key: 'unstaged', label: 'Unstaged Changes', actions: this.getUnstagedActions() },
				],
			};
		}

		// When a file appears in BOTH staged and unstaged, downstream action callbacks need to
		// know so they can offer Stage AND Unstage actions instead of one inferred from the
		// canonical (staged) FileItem we kept during dedup.
		const callerActions = this.fileActions;
		this._wrappedActions =
			typeof callerActions === 'function'
				? (file, options) => callerActions(file, { ...(options ?? {}), mixed: mixedPaths.has(file.path) })
				: callerActions;

		this._effectiveFiles = effectiveFiles;
		this._effectiveStates = effectiveStates;
		this._grouping = grouping;
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
			.filesLayout=${this.preferences?.files}
			.showIndentGuides=${this.preferences?.indentGuides}
			.grouping=${this._grouping}
			?checkable=${this.checkable}
			.checkableStates=${this._effectiveStates}
			.checkableStateDefault=${this.checkableStateDefault}
			.buttons=${buttons}
			selection-badge-label="Staged"
			check-verb="Stage"
			uncheck-verb="Unstage"
			@gl-check-all=${this.onCheckAll}
			@gl-file-tree-pane-open-multi-diff=${multiDiff ? () => this.onOpenMultiDiff(multiDiff) : null}
		>
			<span slot="subtitle" style="opacity: 1">${this.renderStats()}</span>
			${files.length > 0
				? html`<gl-button
						slot="leading-actions"
						appearance="toolbar"
						tooltip="Stash Changes"
						@click=${this.onStashSave}
					>
						<code-icon icon="gl-stash-save" slot="prefix"></code-icon>
						Stash
					</gl-button>`
				: nothing}
			<slot name="before-tree" slot="before-tree"></slot>
		</gl-file-tree-pane>`;
	}

	private onStashSave() {
		this.dispatchEvent(new CustomEvent('stash-save', { bubbles: true, composed: true }));
	}

	private onOpenMultiDiff(refs: { repoPath: string; lhs: string; rhs: string; title?: string }): void {
		const files = this.files;
		if (!files?.length) return;

		this.dispatchEvent(
			new CustomEvent('open-multiple-changes', {
				detail: {
					files: files,
					repoPath: refs.repoPath,
					lhs: refs.lhs,
					rhs: refs.rhs,
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
				// Keep the staged version as the canonical entry
				if (f.staged && !deduped[idx].staged) {
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
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-wip-tree-pane': GlWipTreePane;
	}
}
