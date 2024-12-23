import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { GitCommit } from '../../git/models/commit';
import type { GitFileWithCommit } from '../../git/models/file';
import type { GitLog } from '../../git/models/log';
import type { GitStatus, GitStatusFile } from '../../git/models/status';
import { makeHierarchical } from '../../system/array';
import { filter, flatMap, groupBy, map } from '../../system/iterable';
import { joinPaths, normalizePath } from '../../system/path';
import { pluralize, sortCompare } from '../../system/string';
import type { ViewsWithWorkingTree } from '../viewBase';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { StatusFileNode } from './statusFileNode';

export class StatusFilesNode extends ViewNode<'status-files', ViewsWithWorkingTree> {
	constructor(
		view: ViewsWithWorkingTree,
		protected override readonly parent: ViewNode,
		public readonly status: GitStatus,
		public readonly range: string | undefined,
	) {
		super('status-files', GitUri.fromRepoPath(status.repoPath), view, parent);

		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	get repoPath(): string {
		return this.status.repoPath;
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

		if ((this.view.type === 'worktrees' || this.view.config.includeWorkingTree) && this.status.files.length !== 0) {
			files.unshift(
				...flatMap(this.status.files, f =>
					map(f.getPseudoCommits(this.view.container, undefined), c => this.getFileWithPseudoCommit(f, c)),
				),
			);
		}

		files.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

		const groups = groupBy(files, s => s.path);

		let children: FileNode[] = Object.values(groups).map(
			files => new StatusFileNode(this.view, this, repoPath, files, 'working'),
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
			children.sort((a, b) => a.priority - b.priority || sortCompare(a.label!, b.label!));
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		let files =
			this.view.type === 'worktrees' || this.view.config.includeWorkingTree ? this.status.files.length : 0;

		if (this.range != null) {
			if (this.status.upstream != null && this.status.state.ahead > 0) {
				if (files > 0) {
					const aheadFiles = await this.view.container.git.getDiffStatus(
						this.repoPath,
						`${this.status.upstream?.name}...`,
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
						`${this.status.upstream?.name}...`,
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
		item.description = 'working tree';
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
			status:
				(commit.isUncommitted
					? commit.isUncommittedStaged
						? file.indexStatus
						: file.workingTreeStatus
					: file.status) ?? file.status,
			repoPath: file.repoPath,
			indexStatus: file.indexStatus,
			workingTreeStatus: file.workingTreeStatus,
			path: file.path,
			originalPath: file.originalPath,
			commit: commit,
		};
	}
}
