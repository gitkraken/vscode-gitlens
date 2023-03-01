import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout } from '../../config';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitFileWithCommit } from '../../git/models/file';
import { createRevisionRange } from '../../git/models/reference';
import { groupBy, makeHierarchical } from '../../system/array';
import { filter, flatMap, map } from '../../system/iterable';
import { joinPaths, normalizePath } from '../../system/path';
import { pluralize, sortCompare } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { BranchNode } from './branchNode';
import type { BranchTrackingStatus } from './branchTrackingStatusNode';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { StatusFileNode } from './statusFileNode';
import { ContextValues, ViewNode } from './viewNode';

export class BranchTrackingStatusFilesNode extends ViewNode<ViewsWithCommits> {
	static key = ':status-branch:files';
	static getId(repoPath: string, name: string, root: boolean, upstream: string, direction: string): string {
		return `${BranchNode.getId(repoPath, name, root)}${this.key}(${upstream}|${direction})`;
	}

	readonly repoPath: string;

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly status: Required<BranchTrackingStatus>,
		public readonly direction: 'ahead' | 'behind',
		// Specifies that the node is shown as a root
		private readonly root: boolean = false,
	) {
		super(GitUri.fromRepoPath(status.repoPath), view, parent);
		this.repoPath = status.repoPath;
	}

	override get id(): string {
		return BranchTrackingStatusFilesNode.getId(
			this.status.repoPath,
			this.status.ref,
			this.root,
			this.status.upstream,
			this.direction,
		);
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.view.container.git.getLog(this.repoPath, {
			limit: 0,
			ref: createRevisionRange(this.status.upstream, this.branch.ref, this.direction === 'behind' ? '...' : '..'),
		});

		let files: GitFileWithCommit[];

		if (log != null) {
			await Promise.allSettled(
				map(
					filter(log.commits.values(), c => c.files == null),
					c => c.ensureFullDetails(),
				),
			);

			files = [
				...flatMap(
					log.commits.values(),
					c => c.files?.map<GitFileWithCommit>(f => ({ ...f, commit: c })) ?? [],
				),
			];
		} else {
			files = [];
		}

		files.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

		const groups = groupBy(files, s => s.path);

		let children: FileNode[] = Object.values(groups).map(
			files =>
				new StatusFileNode(
					this.view,
					this,
					files[files.length - 1],
					this.repoPath,
					files.map(s => s.commit),
					this.direction,
				),
		);

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy, false);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) => a.priority - b.priority || sortCompare(a.label!, b.label!));
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const stats = await this.view.container.git.getChangedFilesCount(
			this.repoPath,
			`${this.status.upstream}${this.direction === 'behind' ? '..' : '...'}`,
		);
		const files = stats?.changedFiles ?? 0;

		const label = `${pluralize('file', files)} changed`;
		const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.BranchStatusFiles;

		return item;
	}
}
