import type { TemplateResult } from 'lit';
import { html, LitElement, nothing } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { TextDocumentShowOptions } from 'vscode';
import type { ViewFilesLayout } from '../../../../config';
import type { HierarchicalItem } from '../../../../system/array';
import { makeHierarchical } from '../../../../system/array';
import { pluralize } from '../../../../system/string';
import type { Preferences, State } from '../../../commitDetails/protocol';
import type {
	TreeItemAction,
	TreeItemActionDetail,
	TreeItemBase,
	TreeItemCheckedDetail,
	TreeItemSelectionDetail,
	TreeModel,
} from '../../shared/components/tree/base';
import '../../shared/components/webview-pane';
import '../../shared/components/actions/action-item';
import '../../shared/components/actions/action-nav';
import '../../shared/components/code-icon';
import '../../shared/components/tree/tree-generator';

type Files = Mutable<NonNullable<NonNullable<State['commit']>['files']>>;
export type File = Files[0];
type Mode = 'commit' | 'stash' | 'wip';

// Can only import types from 'vscode'
const BesideViewColumn = -2; /*ViewColumn.Beside*/

export interface FileChangeListItemDetail extends File {
	showOptions?: TextDocumentShowOptions;
}

export class GlDetailsBase extends LitElement {
	readonly tab: 'wip' | 'commit' = 'commit';

	@property({ type: Array })
	files?: Files;

	@property({ type: Boolean })
	isUncommitted = false;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ type: Object })
	orgSettings?: State['orgSettings'];

	@property({ type: Object })
	searchContext?: State['searchContext'];

	@state()
	private _filterMode: 'off' | 'mixed' | 'matched' = 'mixed';

	@property({ attribute: 'empty-text' })
	emptyText? = 'No Files';

	get fileLayout(): ViewFilesLayout {
		return this.preferences?.files?.layout ?? 'auto';
	}

	get isCompact(): boolean {
		return this.preferences?.files?.compact ?? true;
	}

	get indentGuides(): 'none' | 'onHover' | 'always' {
		return this.preferences?.indentGuides ?? 'none';
	}

	get filesChangedPaneLabel(): string {
		const fileCount = this.files?.length ?? 0;
		const filesLabel = fileCount > 0 ? pluralize('file', fileCount) : 'Files';
		return `${filesLabel} changed`;
	}

	protected renderFilterAction(): TemplateResult<1> | typeof nothing {
		if (this.searchContext == null) return nothing;

		const matchCount = this.searchContext.matchedFiles?.length ?? 0;
		const totalCount = this.files?.length ?? 0;

		let icon: string;
		let label: string;
		let className: string | undefined;

		switch (this._filterMode) {
			case 'off':
				icon = 'filter';
				label = `Search matched ${matchCount} of ${totalCount} files\nClick to highlight matching files`;
				break;
			case 'mixed':
				icon = 'filter-filled';
				label = `Search matched ${matchCount} of ${totalCount} files\nClick to show only matching files`;
				className = 'filter-mode-mixed';
				break;
			case 'matched':
				icon = 'filter-filled';
				label = `Showing ${matchCount} of ${totalCount} files\nClick to show all files`;
				break;
		}

		return html`<action-item
			data-action="filter-mode"
			class="${className ?? ''}"
			label="${label}"
			icon="${icon}"
			@click="${this.onToggleFilter}"
		></action-item>`;
	}

	private onToggleFilter(e: Event) {
		e.preventDefault();
		e.stopPropagation();

		// Cycle through: off -> mixed -> matched -> off
		switch (this._filterMode) {
			case 'off':
				this._filterMode = 'mixed';
				break;
			case 'mixed':
				this._filterMode = 'matched';
				break;
			case 'matched':
				this._filterMode = 'off';
				break;
		}
	}

	protected renderLayoutAction(): TemplateResult<1> | typeof nothing {
		let value = 'tree';
		let icon = 'list-tree';
		let label = 'View as Tree';
		switch (this.fileLayout) {
			case 'auto':
				value = 'list';
				icon = 'gl-list-auto';
				label = 'View as List';
				break;
			case 'list':
				value = 'tree';
				icon = 'list-flat';
				label = 'View as Tree';
				break;
			case 'tree':
				value = 'auto';
				icon = 'list-tree';
				label = 'View as Auto';
				break;
		}

		return html`<action-item
			data-action="files-layout"
			data-files-layout="${value}"
			label="${label}"
			icon="${icon}"
		></action-item>`;
	}

	protected renderChangedFiles(mode: Mode, subtitle?: TemplateResult<1>): TemplateResult<1> {
		const fileCount = this.files?.length ?? 0;
		const isTree = this.isTree(fileCount);
		const treeModel = this.createTreeModel(mode, this.files ?? [], isTree, this.isCompact);

		return html`
			<webview-pane collapsable expanded flexible>
				<span slot="title">${this.filesChangedPaneLabel}</span>
				<span slot="subtitle" data-region="stats" style="opacity: 1">${subtitle}</span>
				<action-nav slot="actions"> ${this.renderFilterAction()} ${this.renderLayoutAction()} </action-nav>
				${this.renderChangedFilesActions()}${this.renderTreeFileModel(treeModel)}
			</webview-pane>
		`;
	}

	protected renderChangedFilesActions(): TemplateResult<1> | undefined {
		return undefined;
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

	protected override createRenderRoot(): HTMLElement {
		return this;
	}

	// Tree Model changes
	protected isTree(count: number): boolean {
		if (this.fileLayout === 'auto') {
			return count > (this.preferences?.files?.threshold ?? 5);
		}
		return this.fileLayout === 'tree';
	}

	protected createTreeModel(mode: Mode, files: Files, isTree = false, compact = true): TreeModel[] {
		if (!this.isUncommitted) {
			return this.createFileTreeModel(mode, files, isTree, compact);
		}

		const children: TreeModel[] = [];
		const staged: Files = [];
		const unstaged: Files = [];
		for (const f of files) {
			if (f.staged) {
				staged.push(f);
			} else {
				unstaged.push(f);
			}
		}

		if (!staged.length && !unstaged.length) {
			children.push(...this.createFileTreeModel(mode, files, isTree, compact));
		} else {
			if (staged.length) {
				children.push({
					label: 'Staged Changes',
					path: '/:staged:/',
					level: 1, // isMulti ? 2 : 1,
					branch: true,
					checkable: false,
					expanded: true,
					checked: false, // change.checked !== false,
					// disableCheck: true,
					context: ['staged'],
					children: this.createFileTreeModel(mode, staged, isTree, compact, { level: 2 }),
					actions: this.getStagedActions(),
				});
			}

			if (unstaged.length) {
				children.push({
					label: 'Unstaged Changes',
					path: '/:unstaged:/',
					level: 1, // isMulti ? 2 : 1,
					branch: true,
					checkable: false,
					expanded: true,
					checked: false, // change.checked === true,
					context: ['unstaged'],
					children: this.createFileTreeModel(mode, unstaged, isTree, compact, { level: 2 }),
					actions: this.getUnstagedActions(),
				});
			}
		}

		return children;
	}

	protected sortChildren(children: TreeModel[]): TreeModel[] {
		children.sort((a, b) => {
			if (a.branch && !b.branch) return -1;
			if (!a.branch && b.branch) return 1;

			if (a.label < b.label) return -1;
			if (a.label > b.label) return 1;

			return 0;
		});

		return children;
	}

	protected createFileTreeModel(
		_mode: Mode,
		files: Files,
		isTree = false,
		compact = true,
		options: Partial<TreeItemBase> = { level: 1 },
	): TreeModel[] {
		if (options.level === undefined) {
			options.level = 1;
		}

		// Filter files if filterMode is 'matched' and we have search context
		let filteredFiles = files;
		if (this._filterMode === 'matched' && this.searchContext?.matchedFiles != null) {
			const matchedPaths = new Set(this.searchContext.matchedFiles.map(f => f.path));
			filteredFiles = files.filter(f => matchedPaths.has(f.path));
		}

		if (!filteredFiles.length) {
			return [
				{
					label:
						this._filterMode === 'matched' && this.searchContext != null
							? 'No matching files'
							: 'No changes',
					path: '',
					level: options.level,
					branch: false,
					checkable: false,
					expanded: true,
					checked: false,
				},
			];
		}

		const children: TreeModel[] = [];
		if (isTree) {
			const fileTree = makeHierarchical(
				filteredFiles,
				n => n.path.split('/'),
				(...parts: string[]) => parts.join('/'),
				compact,
			);
			if (fileTree.children != null) {
				for (const child of fileTree.children.values()) {
					const childModel = this.walkFileTree(child, { level: options.level });
					children.push(childModel);
				}
			}
		} else {
			for (const file of filteredFiles) {
				const child = this.fileToTreeModel(file, { level: options.level, branch: false }, true);
				children.push(child);
			}
		}

		this.sortChildren(children);

		return children;
	}

	protected walkFileTree(item: HierarchicalItem<File>, options: Partial<TreeItemBase> = { level: 1 }): TreeModel {
		if (options.level === undefined) {
			options.level = 1;
		}

		let model: TreeModel;
		if (item.value == null) {
			model = this.folderToTreeModel(item.name, options);
		} else {
			model = this.fileToTreeModel(item.value, options);
		}

		if (item.children != null) {
			const children = [];
			for (const child of item.children.values()) {
				const childModel = this.walkFileTree(child, { ...options, level: options.level + 1 });
				children.push(childModel);
			}

			if (children.length > 0) {
				this.sortChildren(children);
				model.branch = true;
				model.children = children;

				// If any child is matched, mark this parent as matched too
				if (children.some(child => child.matched)) {
					model.matched = true;
				}
			}
		}

		return model;
	}

	protected getStagedActions(_options?: Partial<TreeItemBase>): TreeItemAction[] {
		if (this.tab === 'wip') {
			return [
				{
					icon: 'gl-cloud-patch-share',
					label: 'Share Staged Changes',
					action: 'staged-create-patch',
				},
			];
		}
		return [];
	}

	protected getUnstagedActions(_options?: Partial<TreeItemBase>): TreeItemAction[] {
		if (this.tab === 'wip') {
			return [
				{
					icon: 'gl-cloud-patch-share',
					label: 'Share Unstaged Changes',
					action: 'unstaged-create-patch',
				},
			];
		}
		return [];
	}

	protected getFileActions(_file: File, _options?: Partial<TreeItemBase>): TreeItemAction[] {
		return [];
	}

	protected getFileContextData(_file: File): string | undefined {
		// To be overridden by subclasses
		return undefined;
	}

	protected fileToTreeModel(
		file: File,
		options?: Partial<TreeItemBase>,
		flat = false,
		glue = '/',
	): TreeModel<File[]> {
		const pathIndex = file.path.lastIndexOf(glue);
		const fileName = pathIndex !== -1 ? file.path.substring(pathIndex + 1) : file.path;
		const filePath = flat && pathIndex !== -1 ? file.path.substring(0, pathIndex) : '';

		// Check if this file matches the search criteria (always set based on data, not filterMode)
		const isMatchedFile = this.searchContext?.matchedFiles?.find(f => f.path === file.path) != null;

		return {
			branch: false,
			expanded: true,
			path: file.path,
			level: 1,
			checkable: false,
			checked: false,
			icon: { type: 'status', name: file.status }, // 'file',
			label: fileName,
			description: `${flat === true ? filePath : ''}${file.status === 'R' ? ` ← ${file.originalPath}` : ''}`,
			context: [file],
			actions: this.getFileActions(file, options),
			contextData: this.getFileContextData(file),
			matched: isMatchedFile,
			...options,
		};
	}

	protected folderToTreeModel(name: string, options?: Partial<TreeItemBase>): TreeModel {
		return {
			branch: false,
			expanded: true,
			path: name,
			level: 1,
			checkable: false,
			checked: false,
			icon: 'folder',
			label: name,
			...options,
		};
	}

	protected renderTreeFileModel(treeModel: TreeModel[]): TemplateResult<1> {
		return html`<gl-tree-generator
			.model=${treeModel}
			.guides=${this.indentGuides}
			.filtered=${this.searchContext != null && this._filterMode !== 'off'}
			@gl-tree-generated-item-action-clicked=${this.onTreeItemActionClicked}
			@gl-tree-generated-item-checked=${this.onTreeItemChecked}
			@gl-tree-generated-item-selected=${this.onTreeItemSelected}
		></gl-tree-generator>`;
	}

	// Tree Model action events
	// protected onTreeItemActionClicked?(_e: CustomEvent<TreeItemActionDetail>): void;
	protected onTreeItemActionClicked(e: CustomEvent<TreeItemActionDetail>): void {
		if (!e.detail.context || !e.detail.action) return;

		const action = e.detail.action;
		switch (action.action) {
			// stage actions
			case 'staged-create-patch':
				this.onCreatePatch(e);
				break;
			case 'unstaged-create-patch':
				this.onCreatePatch(e, true);
				break;
			// file actions
			case 'file-open':
				this.onOpenFile(e);
				break;
			case 'file-unstage':
				this.onUnstageFile(e);
				break;
			case 'file-stage':
				this.onStageFile(e);
				break;
			case 'file-compare-working':
				this.onCompareWorking(e);
				break;
			case 'file-open-on-remote':
				this.onOpenFileOnRemote(e);
				break;
			case 'file-more-actions':
				this.onMoreActions(e);
				break;
		}
	}

	protected onTreeItemChecked?(_e: CustomEvent<TreeItemCheckedDetail>): void;

	// protected onTreeItemSelected?(_e: CustomEvent<TreeItemSelectionDetail>): void;
	protected onTreeItemSelected(e: CustomEvent<TreeItemSelectionDetail>): void {
		if (!e.detail.context) return;

		this.onComparePrevious(e);
	}

	private onCreatePatch(_e: CustomEvent<TreeItemActionDetail>, isAll = false) {
		const event = new CustomEvent('create-patch', {
			detail: {
				checked: isAll ? true : 'staged',
			},
		});
		this.dispatchEvent(event);
	}

	private onOpenFile(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		const event = new CustomEvent('file-open', {
			detail: this.getEventDetail(file, {
				preview: !e.detail.dblClick,
				viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
			}),
		});
		this.dispatchEvent(event);
	}

	private onOpenFileOnRemote(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		const event = new CustomEvent('file-open-on-remote', {
			detail: this.getEventDetail(file, {
				preview: !e.detail.dblClick,
				viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
			}),
		});
		this.dispatchEvent(event);
	}

	private onCompareWorking(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		const event = new CustomEvent('file-compare-working', {
			detail: this.getEventDetail(file, {
				preview: !e.detail.dblClick,
				viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
			}),
		});
		this.dispatchEvent(event);
	}

	private onComparePrevious(e: CustomEvent<TreeItemSelectionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		const event = new CustomEvent('file-compare-previous', {
			detail: this.getEventDetail(file, {
				preview: !e.detail.dblClick,
				viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
			}),
		});
		this.dispatchEvent(event);
	}

	private onMoreActions(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		const event = new CustomEvent('file-more-actions', {
			detail: this.getEventDetail(file),
		});
		this.dispatchEvent(event);
	}

	private onStageFile(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		const event = new CustomEvent('file-stage', {
			detail: this.getEventDetail(file, {
				preview: !e.detail.dblClick,
				viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
			}),
		});
		this.dispatchEvent(event);
	}

	private onUnstageFile(e: CustomEvent<TreeItemActionDetail>) {
		if (!e.detail.context) return;

		const [file] = e.detail.context;
		const event = new CustomEvent('file-unstage', {
			detail: this.getEventDetail(file, {
				preview: !e.detail.dblClick,
				viewColumn: e.detail.altKey ? BesideViewColumn : undefined,
			}),
		});
		this.dispatchEvent(event);
	}

	private getEventDetail(file: File, showOptions?: TextDocumentShowOptions): FileChangeListItemDetail {
		return {
			path: file.path,
			repoPath: file.repoPath,
			status: file.status,
			// originalPath: this.originalPath,
			staged: file.staged,
			showOptions: showOptions,
		};
	}
}
