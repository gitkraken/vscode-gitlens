'use strict';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout } from '../../config';
import { GitUri } from '../../git/gitUri';
import type { GitTrackingState } from '../../git/models/branch';
import { GitCommit, GitCommitIdentity } from '../../git/models/commit';
import { uncommitted, uncommittedStaged } from '../../git/models/constants';
import type { GitFileWithCommit } from '../../git/models/file';
import { GitFileChange } from '../../git/models/file';
import type { GitStatus, GitStatusFile } from '../../git/models/status';
import { groupBy, makeHierarchical } from '../../system/array';
import { flatMap } from '../../system/iterable';
import { joinPaths, normalizePath } from '../../system/path';
import type { RepositoriesView } from '../repositoriesView';
import type { WorktreesView } from '../worktreesView';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { RepositoryNode } from './repositoryNode';
import { UncommittedFileNode } from './UncommittedFileNode';
import { ContextValues, ViewNode } from './viewNode';

export class UncommittedFilesNode extends ViewNode<RepositoriesView | WorktreesView> {
	static key = ':uncommitted-files';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	readonly repoPath: string;

	constructor(
		view: RepositoriesView | WorktreesView,
		parent: ViewNode,
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
		super(GitUri.fromRepoPath(status.repoPath), view, parent);
		this.repoPath = status.repoPath;
	}

	override get id(): string {
		return UncommittedFilesNode.getId(this.repoPath);
	}

	getChildren(): ViewNode[] {
		const repoPath = this.repoPath;

		const files: GitFileWithCommit[] = [
			...flatMap(this.status.files, f => {
				if (f.workingTreeStatus != null && f.indexStatus != null) {
					// Decrements the date to guarantee this entry will be sorted after the previous entry (most recent first)
					const older = new Date();
					older.setMilliseconds(older.getMilliseconds() - 1);

					return [
						this.getFileWithPseudoCommit(f, uncommitted, uncommittedStaged),
						this.getFileWithPseudoCommit(f, uncommittedStaged, 'HEAD', older),
					];
				} else if (f.indexStatus != null) {
					return [this.getFileWithPseudoCommit(f, uncommittedStaged, 'HEAD')];
				}

				return [this.getFileWithPseudoCommit(f, uncommitted, 'HEAD')];
			}),
		];

		files.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

		const groups = groupBy(files, f => f.path);

		let children: FileNode[] = Object.values(groups).map(
			files => new UncommittedFileNode(this.view, this, repoPath, files[files.length - 1]),
		);

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, repoPath, '', hierarchy, true);
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

	private getFileWithPseudoCommit(
		file: GitStatusFile,
		ref: string,
		previousRef: string,
		date?: Date,
	): GitFileWithCommit {
		date = date ?? new Date();
		return {
			status: file.status,
			repoPath: file.repoPath,
			indexStatus: file.indexStatus,
			workingTreeStatus: file.workingTreeStatus,
			path: file.path,
			originalPath: file.originalPath,
			commit: new GitCommit(
				this.view.container,
				file.repoPath,
				ref,
				new GitCommitIdentity('You', undefined, date),
				new GitCommitIdentity('You', undefined, date),
				'Uncommitted changes',
				[previousRef],
				'Uncommitted changes',
				new GitFileChange(file.repoPath, file.path, file.status, file.originalPath, previousRef),
				undefined,
				[],
			),
		};
	}
}
