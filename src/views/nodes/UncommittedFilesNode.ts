import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { GitTrackingState } from '../../git/models/branch';
import type { GitFileWithCommit } from '../../git/models/file';
import type { GitStatus, GitStatusFile } from '../../git/models/status';
import { makeHierarchical } from '../../system/array';
import { flatMap, groupBy } from '../../system/iterable';
import { joinPaths, normalizePath } from '../../system/path';
import type { ViewsWithWorkingTree } from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { UncommittedFileNode } from './UncommittedFileNode';

export class UncommittedFilesNode extends ViewNode<'uncommitted-files', ViewsWithWorkingTree> {
	constructor(
		view: ViewsWithWorkingTree,
		protected override readonly parent: ViewNode,
		public readonly status:
			| GitStatus
			| {
					readonly repoPath: string;
					readonly files: GitStatusFile[];
					readonly state: GitTrackingState;
					readonly upstream?: string;
			  },
		public readonly range: string | undefined,
	) {
		super('uncommitted-files', GitUri.fromRepoPath(status.repoPath), view, parent);

		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	get repoPath(): string {
		return this.status.repoPath;
	}

	getChildren(): ViewNode[] {
		const repoPath = this.repoPath;

		const files: GitFileWithCommit[] = [
			...flatMap(this.status.files, f => {
				const commits = f.getPseudoCommits(this.view.container, undefined);
				return commits.map(
					c =>
						({
							status: f.status,
							repoPath: f.repoPath,
							indexStatus: f.indexStatus,
							workingTreeStatus: f.workingTreeStatus,
							path: f.path,
							originalPath: f.originalPath,
							commit: c,
						}) satisfies GitFileWithCommit,
				);
			}),
		];

		files.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

		const groups = groupBy(files, f => f.path);

		let children: FileNode[] = Object.values(groups).map(
			files => new UncommittedFileNode(this.view, this, repoPath, files[files.length - 1]),
		);

		if (this.view.config.files.layout !== 'list') {
			const hierarchy = makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, hierarchy, repoPath, '', undefined, true);
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

	getTreeItem(): TreeItem {
		const item = new TreeItem('Uncommitted changes', TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.UncommittedFiles;
		item.iconPath = new ThemeIcon('folder');

		return item;
	}
}
