import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitFileWithCommit } from '@gitlens/git/models/file.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import { flatMap, groupBy } from '@gitlens/utils/iterable.js';
import type { Lazy } from '@gitlens/utils/lazy.js';
import { joinPaths, normalizePath } from '@gitlens/utils/path.js';
import { GitUri } from '../../git/gitUri.js';
import { getCommitDate } from '../../git/utils/-webview/commit.utils.js';
import { getStatusFilePseudoCommits } from '../../git/utils/-webview/statusFile.utils.js';
import type { ViewsWithWorkingTree } from '../viewBase.js';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode.js';
import type { FileNode } from './folderNode.js';
import { FolderNode } from './folderNode.js';
import { UncommittedFileNode } from './UncommittedFileNode.js';

export class UncommittedFilesNode extends ViewNode<'uncommitted-files', ViewsWithWorkingTree> {
	constructor(
		view: ViewsWithWorkingTree,
		protected override readonly parent: ViewNode,
		public readonly repoPath: string,
		private readonly status: Lazy<Promise<GitStatus | undefined>>,
		public readonly range: string | undefined,
	) {
		super('uncommitted-files', GitUri.fromRepoPath(repoPath), view, parent);

		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	async getChildren(): Promise<ViewNode[]> {
		const repoPath = this.repoPath;

		const status = await this.status.value;
		if (status == null) return [];

		const files: GitFileWithCommit[] = [
			...flatMap(status.files, f => {
				const commits = getStatusFilePseudoCommits(f, undefined);
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

		files.sort((a, b) => getCommitDate(b.commit).getTime() - getCommitDate(a.commit).getTime());

		const groups = groupBy(files, f => f.path);

		let children: FileNode[] = Object.values(groups).map(
			files => new UncommittedFileNode(this.view, this, repoPath, files.at(-1)!),
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
