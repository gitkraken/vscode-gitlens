import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout } from '../../configuration';
import { GitUri } from '../../git/gitUri';
import { GitCommit, GitFileWithCommit, GitLog, GitStatus, GitStatusFile, GitTrackingState } from '../../git/models';
import { groupBy, makeHierarchical } from '../../system/array';
import { filter, flatMap, map } from '../../system/iterable';
import { joinPaths, normalizePath } from '../../system/path';
import { pluralize, sortCompare } from '../../system/string';
import { RepositoriesView } from '../repositoriesView';
import { FileNode, FolderNode } from './folderNode';
import { RepositoryNode } from './repositoryNode';
import { StatusFileNode } from './statusFileNode';
import { ContextValues, ViewNode } from './viewNode';

export class StatusFilesNode extends ViewNode<RepositoriesView> {
	static key = ':status-files';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	readonly repoPath: string;

	constructor(
		view: RepositoriesView,
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
		return StatusFilesNode.getId(this.repoPath);
	}

	async getChildren(): Promise<ViewNode[]> {
		let files: GitFileWithCommit[] = [];

		const repoPath = this.repoPath;

		let log: GitLog | undefined;
		if (this.range != null) {
			log = await this.view.container.git.getLog(repoPath, { limit: 0, ref: this.range });
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
			}
		}

		if (this.view.config.includeWorkingTree && this.status.files.length !== 0) {
			files.splice(
				0,
				0,
				...flatMap(this.status.files, f =>
					map(f.getPseudoCommits(undefined), c => this.getFileWithPseudoCommit(f, c)),
				),
			);
		}

		files.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

		const groups = groupBy(files, s => s.path);

		let children: FileNode[] = Object.values(groups).map(
			files =>
				new StatusFileNode(
					this.view,
					this,
					repoPath,
					files[files.length - 1],
					files.map(s => s.commit),
				),
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
			children.sort((a, b) => a.priority - b.priority || sortCompare(a.label!, b.label!));
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let files = this.view.config.includeWorkingTree ? this.status.files.length : 0;

		if (this.range != null) {
			if (this.status.upstream != null && this.status.state.ahead > 0) {
				if (files > 0) {
					const aheadFiles = await this.view.container.git.getDiffStatus(
						this.repoPath,
						`${this.status.upstream}...`,
					);

					if (aheadFiles != null) {
						const uniques = new Set();
						for (const f of this.status.files) {
							uniques.add(f.path);
						}
						for (const f of aheadFiles) {
							uniques.add(f.path);
						}

						files = uniques.size;
					}
				} else {
					const stats = await this.view.container.git.getChangedFilesCount(
						this.repoPath,
						`${this.status.upstream}...`,
					);
					if (stats != null) {
						files += stats.files;
					} else {
						files = -1;
					}
				}
			}
		}

		const label = files === -1 ? '?? files changed' : `${pluralize('file', files)} changed`;
		const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ContextValues.StatusFiles;
		item.iconPath = {
			dark: this.view.container.context.asAbsolutePath('images/dark/icon-diff.svg'),
			light: this.view.container.context.asAbsolutePath('images/light/icon-diff.svg'),
		};

		return item;
	}

	private getFileWithPseudoCommit(file: GitStatusFile, commit: GitCommit): GitFileWithCommit {
		return {
			status: file.status,
			repoPath: file.repoPath,
			indexStatus: file.indexStatus,
			workingTreeStatus: file.workingTreeStatus,
			path: file.path,
			originalPath: file.originalPath,
			commit: commit,
		};
	}
}
