import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri.js';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus.js';
import type { GitStatusFile } from '../../git/models/statusFile.js';
import { makeHierarchical } from '../../system/array.js';
import { joinPaths, normalizePath } from '../../system/path.js';
import { pluralize, sortCompare } from '../../system/string.js';
import type { ViewsWithCommits } from '../viewBase.js';
import { ViewNode } from './abstract/viewNode.js';
import type { FileNode } from './folderNode.js';
import { FolderNode } from './folderNode.js';
import { MergeConflictFileNode } from './mergeConflictFileNode.js';

export class MergeConflictFilesNode extends ViewNode<'conflict-files', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		private readonly status: GitPausedOperationStatus,
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
