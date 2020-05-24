'use strict';
import * as paths from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout } from '../../configuration';
import { Container } from '../../container';
import {
	GitCommitType,
	GitFileWithCommit,
	GitLog,
	GitLogCommit,
	GitRevision,
	GitStatus,
	GitStatusFile,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Arrays, Iterables, Objects, Strings } from '../../system';
import { RepositoriesView } from '../repositoriesView';
import { FileNode, FolderNode } from './folderNode';
import { StatusFileNode } from './statusFileNode';
import { ResourceType, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';

export class StatusFilesNode extends ViewNode<RepositoriesView> {
	static key = ':status-files';
	static getId(repoPath: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}`;
	}

	readonly repoPath: string;

	constructor(
		view: RepositoriesView,
		parent: ViewNode,
		public readonly status: GitStatus,
		public readonly range: string | undefined,
	) {
		super(GitUri.fromRepoPath(status.repoPath), view, parent);
		this.repoPath = status.repoPath;
	}

	get id(): string {
		return StatusFilesNode.getId(this.status.repoPath);
	}

	async getChildren(): Promise<ViewNode[]> {
		let files: GitFileWithCommit[] = [];

		const repoPath = this.repoPath;

		let log: GitLog | undefined;
		if (this.range !== undefined) {
			log = await Container.git.getLog(repoPath, { limit: 0, ref: this.range });
			if (log !== undefined) {
				files = [
					...Iterables.flatMap(log.commits.values(), c =>
						c.files.map(s => {
							const file: GitFileWithCommit = { ...s, commit: c };
							return file;
						}),
					),
				];
			}
		}

		if (this.status.files.length !== 0 && this.includeWorkingTree) {
			files.splice(
				0,
				0,
				...Iterables.flatMap(this.status.files, s => {
					if (s.workingTreeStatus !== undefined && s.indexStatus !== undefined) {
						// Decrements the date to guarantee this entry will be sorted after the previous entry (most recent first)
						const older = new Date();
						older.setMilliseconds(older.getMilliseconds() - 1);

						return [
							this.toStatusFile(s, GitRevision.uncommitted, GitRevision.uncommittedStaged),
							this.toStatusFile(s, GitRevision.uncommittedStaged, 'HEAD', older),
						];
					} else if (s.indexStatus !== undefined) {
						return [this.toStatusFile(s, GitRevision.uncommittedStaged, 'HEAD')];
					}

					return [this.toStatusFile(s, GitRevision.uncommitted, 'HEAD')];
				}),
			);
		}

		files.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

		const groups = Arrays.groupBy(files, s => s.fileName);

		let children: FileNode[] = [
			...Iterables.map(
				Objects.values(groups),
				files =>
					new StatusFileNode(
						this.view,
						this,
						repoPath,
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

	async getTreeItem(): Promise<TreeItem> {
		let files = this.status.files !== undefined && this.includeWorkingTree ? this.status.files.length : 0;

		if (this.status.upstream !== undefined && this.status.state.ahead > 0) {
			if (files > 0) {
				const aheadFiles = await Container.git.getDiffStatus(this.repoPath, `${this.status.upstream}...`);

				if (aheadFiles !== undefined) {
					const uniques = new Set();
					for (const f of this.status.files) {
						uniques.add(f.fileName);
					}
					for (const f of aheadFiles) {
						uniques.add(f.fileName);
					}

					files = uniques.size;
				}
			} else {
				const stats = await Container.git.getChangedFilesCount(this.repoPath, `${this.status.upstream}...`);
				if (stats !== undefined) {
					files += stats.files;
				}
			}
		}

		const label = `${Strings.pluralize('file', files)} changed`;
		const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
		item.id = this.id;
		item.contextValue = ResourceType.StatusFiles;
		item.iconPath = {
			dark: Container.context.asAbsolutePath('images/dark/icon-diff.svg'),
			light: Container.context.asAbsolutePath('images/light/icon-diff.svg'),
		};

		return item;
	}

	private get includeWorkingTree(): boolean {
		return this.view.config.includeWorkingTree;
	}

	private toStatusFile(file: GitStatusFile, ref: string, previousRef: string, date?: Date): GitFileWithCommit {
		return {
			status: file.status,
			repoPath: file.repoPath,
			indexStatus: file.indexStatus,
			workingTreeStatus: file.workingTreeStatus,
			fileName: file.fileName,
			originalFileName: file.originalFileName,
			commit: new GitLogCommit(
				GitCommitType.LogFile,
				file.repoPath,
				ref,
				'You',
				undefined,
				date ?? new Date(),
				date ?? new Date(),
				'',
				file.fileName,
				[file],
				file.status,
				file.originalFileName,
				previousRef,
				file.fileName,
			),
		};
	}
}
