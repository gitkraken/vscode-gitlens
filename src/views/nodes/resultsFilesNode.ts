'use strict';
import * as paths from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout } from '../../configuration';
import { GitFile } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Arrays, debug, gate, Iterables, Promises, Strings } from '../../system';
import { ViewsWithFiles } from '../viewBase';
import { FileNode, FolderNode } from './folderNode';
import { ResultsFileNode } from './resultsFileNode';
import { ContextValues, ViewNode } from './viewNode';

export interface FilesQueryResults {
	label: string;
	files: GitFile[] | undefined;
}

export class ResultsFilesNode extends ViewNode<ViewsWithFiles> {
	constructor(
		view: ViewsWithFiles,
		parent: ViewNode,
		public readonly repoPath: string,
		public readonly ref1: string,
		public readonly ref2: string,
		private readonly _filesQuery: () => Promise<FilesQueryResults>,
		private readonly direction: 'ahead' | 'behind' | undefined,
		private readonly _options: {
			expand?: boolean;
		} = {},
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);

		this._options = { expand: true, ..._options };
	}

	get id(): string {
		return `${this.parent!.id}:results:files`;
	}

	async getChildren(): Promise<ViewNode[]> {
		const { files } = await this.getFilesQueryResults();
		if (files == null) return [];

		let children: FileNode[] = [
			...Iterables.map(
				files,
				s => new ResultsFileNode(this.view, this, this.repoPath, s, this.ref1, this.ref2, this.direction),
			),
		];

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = Arrays.makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort(
				(a, b) =>
					a.priority - b.priority ||
					a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' }),
			);
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let label;
		let files;
		let state;

		try {
			({ label, files } = await Promises.cancellable(this.getFilesQueryResults(), 100));
			state =
				files == null || files.length === 0
					? TreeItemCollapsibleState.None
					: this._options.expand
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed;
		} catch (ex) {
			if (ex instanceof Promises.CancellationError) {
				ex.promise.then(() => this.triggerChange(false));
			}

			// Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
			// https://github.com/microsoft/vscode/issues/54806 & https://github.com/microsoft/vscode/issues/62214
			state = TreeItemCollapsibleState.Collapsed;
		}

		const item = new TreeItem(label ?? 'files changed', state);
		item.contextValue = ContextValues.ResultsFiles;
		item.id = this.id;

		return item;
	}

	@gate()
	@debug()
	refresh(reset: boolean = false) {
		if (!reset) return;

		this._filesQueryResults = this._filesQuery();
	}

	private _filesQueryResults: Promise<FilesQueryResults> | undefined;

	getFilesQueryResults() {
		if (this._filesQueryResults === undefined) {
			this._filesQueryResults = this._filesQuery();
		}

		return this._filesQueryResults;
	}
}
