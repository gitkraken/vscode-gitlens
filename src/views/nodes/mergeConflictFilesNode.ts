import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { GitMergeStatus } from '../../git/models/merge';
import type { GitRebaseStatus } from '../../git/models/rebase';
import type { GitStatusFile } from '../../git/models/status';
import { makeHierarchical } from '../../system/array';
import { joinPaths, normalizePath } from '../../system/path';
import { pluralize, sortCompare } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { ViewNode } from './abstract/viewNode';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { MergeConflictFileNode } from './mergeConflictFileNode';

export class MergeConflictFilesNode extends ViewNode<'conflict-files', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		private readonly status: GitMergeStatus | GitRebaseStatus,
		private readonly conflicts: GitStatusFile[],
	) {
		super('conflict-files', GitUri.fromRepoPath(status.repoPath), view, parent);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	getChildren(): ViewNode[] {
		let children: (FileNode | FolderNode)[] = this.conflicts.map(
			f => new MergeConflictFileNode(this.view, this, f, this.status),
		);

		if (this.view.config.files.layout !== 'list') {
			const hierarchy = makeHierarchical(
				children as FileNode[],
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, hierarchy, this.repoPath, '', undefined);
			children = root.getChildren();
		} else {
			children.sort((a, b) => sortCompare(a.label!, b.label!));
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(pluralize('conflict', this.conflicts.length), TreeItemCollapsibleState.Expanded);
		return item;
	}
}
