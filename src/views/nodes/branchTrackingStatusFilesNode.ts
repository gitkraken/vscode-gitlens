'use strict';
import * as paths from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchNode } from './branchNode';
import { BranchTrackingStatus } from './branchTrackingStatusNode';
import { ViewFilesLayout } from '../../configuration';
import { Container } from '../../container';
import { FileNode, FolderNode } from './folderNode';
import { GitBranch, GitFileWithCommit, GitRevision } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { StatusFileNode } from './statusFileNode';
import { Arrays, Iterables, Objects, Strings } from '../../system';
import { ViewsWithFiles } from '../viewBase';
import { ContextValues, ViewNode } from './viewNode';

export class BranchTrackingStatusFilesNode extends ViewNode<ViewsWithFiles> {
	static key = ':status-branch:files';
	static getId(repoPath: string, name: string, root: boolean, upstream: string, direction: string): string {
		return `${BranchNode.getId(repoPath, name, root)}${this.key}(${upstream}|${direction})`;
	}

	readonly repoPath: string;

	constructor(
		view: ViewsWithFiles,
		parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly status: Required<BranchTrackingStatus>,
		public readonly direction: 'ahead' | 'behind',
		private readonly root: boolean = false,
	) {
		super(GitUri.fromRepoPath(status.repoPath), view, parent);
		this.repoPath = status.repoPath;
	}

	get id(): string {
		return BranchTrackingStatusFilesNode.getId(
			this.status.repoPath,
			this.status.ref,
			this.root,
			this.status.upstream,
			this.direction,
		);
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await Container.git.getLog(this.repoPath, {
			limit: 0,
			ref: GitRevision.createRange(this.status.upstream, this.branch.ref),
		});

		const files =
			log != null
				? [
						...Iterables.flatMap(log.commits.values(), c =>
							c.files.map(s => {
								const file: GitFileWithCommit = { ...s, commit: c };
								return file;
							}),
						),
				  ]
				: [];

		files.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

		const groups = Arrays.groupBy(files, s => s.fileName);

		let children: FileNode[] = [
			...Iterables.map(
				Objects.values(groups),
				files =>
					new StatusFileNode(
						this.view,
						this,
						this.repoPath,
						files[files.length - 1],
						files.map(s => s.commit),
					),
			),
		];

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = Arrays.makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy, false);
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
		// if (this.status.state.ahead > 0) {
		const stats = await Container.git.getChangedFilesCount(this.repoPath, `${this.status.upstream}...`);
		const files = stats?.files ?? 0;
		// }

		const label = `${Strings.pluralize('file', files)} changed`;
		const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.StatusFiles;
		// item.iconPath = {
		// 	dark: Container.context.asAbsolutePath('images/dark/icon-diff.svg'),
		// 	light: Container.context.asAbsolutePath('images/light/icon-diff.svg'),
		// };

		return item;
	}
}
