import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { FilesComparison } from '../../git/actions/commit';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitFileWithCommit } from '../../git/models/file';
import { createRevisionRange } from '../../git/models/revision.utils';
import { makeHierarchical } from '../../system/array';
import { filter, flatMap, groupByMap, map } from '../../system/iterable';
import { joinPaths, normalizePath } from '../../system/path';
import { pluralize, sortCompare } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import type { BranchTrackingStatus } from './branchTrackingStatusNode';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { StatusFileNode } from './statusFileNode';

export class BranchTrackingStatusFilesNode extends ViewNode<'tracking-status-files', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly status: Required<BranchTrackingStatus>,
		public readonly direction: 'ahead' | 'behind',
	) {
		super('tracking-status-files', GitUri.fromRepoPath(status.repoPath), view, parent);

		this.updateContext({ branch: branch, branchStatus: status, branchStatusUpstreamType: direction });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	get ref1(): string {
		return this.branch.ref;
	}

	get ref2(): string {
		return this.status.upstream?.name;
	}

	get repoPath(): string {
		return this.status.repoPath;
	}

	async getFilesComparison(): Promise<FilesComparison> {
		const grouped = await this.getGroupedFiles();
		return {
			files: [...map(grouped, ([, files]) => files[files.length - 1])],
			repoPath: this.repoPath,
			ref1: this.ref1,
			ref2: this.ref2,
			title: this.direction === 'ahead' ? `Changes to push to ${this.ref2}` : `Changes to pull from ${this.ref2}`,
		};
	}

	private async getGroupedFiles(): Promise<Map<string, GitFileWithCommit[]>> {
		const log = await this.view.container.git.getLog(this.repoPath, {
			limit: 0,
			ref:
				this.direction === 'behind'
					? createRevisionRange(this.ref1, this.ref2, '..')
					: createRevisionRange(this.ref2, this.ref1, '..'),
		});
		if (log == null) return new Map();

		await Promise.allSettled(
			map(
				filter(log.commits.values(), c => c.files == null),
				c => c.ensureFullDetails(),
			),
		);

		const files = [
			...flatMap(log.commits.values(), c => c.files?.map<GitFileWithCommit>(f => ({ ...f, commit: c })) ?? []),
		];

		files.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

		const groups = groupByMap(files, s => s.path);
		return groups;
	}

	async getChildren(): Promise<ViewNode[]> {
		const files = await this.getGroupedFiles();

		let children: FileNode[] = [
			...map(files.values(), files => new StatusFileNode(this.view, this, this.repoPath, files, this.direction)),
		];

		if (this.view.config.files.layout !== 'list') {
			const hierarchy = makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, hierarchy, this.repoPath, '', undefined, false);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) => a.priority - b.priority || sortCompare(a.label!, b.label!));
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const stats = await this.view.container.git.getChangedFilesCount(
			this.repoPath,
			this.direction === 'behind' ? `${this.ref1}...${this.ref2}` : `${this.ref2}...`,
		);
		const files = stats?.files ?? 0;

		const label = `${pluralize('file', files)} changed`;
		const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.BranchStatusFiles;

		return item;
	}
}
