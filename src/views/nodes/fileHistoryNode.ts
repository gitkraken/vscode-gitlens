'use strict';
import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import {
	GitCommitType,
	GitLog,
	GitLogCommit,
	GitService,
	GitUri,
	RepositoryChange,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent
} from '../../git/gitService';
import { Logger } from '../../logger';
import { debug, gate, Iterables } from '../../system';
import { View } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, SubscribeableViewNode, ViewNode } from './viewNode';
import { RepositoryNode } from './repositoryNode';

export class FileHistoryNode extends SubscribeableViewNode implements PageableViewNode {
	static key = ':history:file';
	static getId(repoPath: string, uri: string): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${uri})`;
	}

	constructor(uri: GitUri, view: View, parent: ViewNode) {
		super(uri, view, parent);
	}

	toClipboard(): string {
		return this.uri.fileName;
	}

	get id(): string {
		return FileHistoryNode.getId(this.uri.repoPath!, this.uri.toString(true));
	}

	async getChildren(): Promise<ViewNode[]> {
		const children: ViewNode[] = [];

		if (this.uri.sha === undefined) {
			const status = await Container.git.getStatusForFile(this.uri.repoPath!, this.uri.fsPath);
			if (status?.workingTreeStatus !== undefined || status?.indexStatus !== undefined) {
				const user = await Container.git.getCurrentUser(this.uri.repoPath!);
				if (status.workingTreeStatus !== undefined && status.indexStatus !== undefined) {
					let commit = new GitLogCommit(
						GitCommitType.LogFile,
						this.uri.repoPath!,
						GitService.uncommittedSha,
						'You',
						user !== undefined ? user.email : undefined,
						new Date(),
						new Date(),
						'',
						status.fileName,
						[status],
						status.status,
						status.originalFileName,
						GitService.uncommittedStagedSha,
						status.originalFileName || status.fileName
					);

					children.push(
						new CommitFileNode(this.view, this, status, commit, {
							displayAsCommit: true,
							inFileHistory: true
						})
					);

					commit = new GitLogCommit(
						GitCommitType.LogFile,
						this.uri.repoPath!,
						GitService.uncommittedStagedSha,
						'You',
						user !== undefined ? user.email : undefined,
						new Date(),
						new Date(),
						'',
						status.fileName,
						[status],
						status.status,
						status.originalFileName,
						'HEAD',
						status.originalFileName || status.fileName
					);

					children.push(
						new CommitFileNode(this.view, this, status, commit, {
							displayAsCommit: true,
							inFileHistory: true
						})
					);
				} else {
					const commit = new GitLogCommit(
						GitCommitType.LogFile,
						this.uri.repoPath!,
						status.workingTreeStatus !== undefined
							? GitService.uncommittedSha
							: GitService.uncommittedStagedSha,
						'You',
						user !== undefined ? user.email : undefined,
						new Date(),
						new Date(),
						'',
						status.fileName,
						[status],
						status.status,
						status.originalFileName,
						'HEAD',
						status.originalFileName || status.fileName
					);
					children.push(
						new CommitFileNode(this.view, this, status, commit, {
							displayAsCommit: true,
							inFileHistory: true
						})
					);
				}
			}
		}

		const log = await this.getLog();
		if (log !== undefined) {
			children.push(
				...insertDateMarkers(
					Iterables.map(
						log.commits.values(),
						c =>
							new CommitFileNode(this.view, this, c.files[0], c, {
								displayAsCommit: true,
								inFileHistory: true
							})
					),
					this
				)
			);

			if (log.hasMore) {
				children.push(new ShowMoreNode(this.view, this, children[children.length - 1]));
			}
		}

		if (children.length === 0) return [new MessageNode(this.view, this, 'No file history could be found.')];
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			`${this.uri.fileName}${
				this.uri.sha
					? ` ${
							this.uri.sha === GitService.deletedOrMissingSha
								? this.uri.shortSha
								: `(${this.uri.shortSha})`
					  }`
					: ''
			}`,
			TreeItemCollapsibleState.Expanded
		);
		item.contextValue = ResourceType.FileHistory;
		item.description = this.uri.directory;
		item.tooltip = `History of ${this.uri.fileName}\n${this.uri.directory}/${
			this.uri.sha === undefined ? '' : `\n\n${this.uri.sha}`
		}`;

		item.iconPath = {
			dark: Container.context.asAbsolutePath('images/dark/icon-history.svg'),
			light: Container.context.asAbsolutePath('images/light/icon-history.svg')
		};

		void this.ensureSubscription();

		return item;
	}

	@debug()
	protected async subscribe() {
		const repo = await Container.git.getRepository(this.uri);
		if (repo === undefined) return undefined;

		const subscription = Disposable.from(
			repo.onDidChange(this.onRepoChanged, this),
			repo.onDidChangeFileSystem(this.onRepoFileSystemChanged, this),
			{ dispose: () => repo.stopWatchingFileSystem() }
		);

		repo.startWatchingFileSystem();

		return subscription;
	}

	private onRepoChanged(e: RepositoryChangeEvent) {
		if (!e.changed(RepositoryChange.Repository)) return;

		Logger.log(`FileHistoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

		void this.triggerChange();
	}

	private onRepoFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (!e.uris.some(uri => uri.toString(true) === this.uri.toString(true))) return;

		Logger.debug(
			`FileHistoryNode${this.id}.onRepoFileSystemChanged(${this.uri.toString(true)}); triggering node refresh`
		);

		void this.triggerChange();
	}

	@gate()
	@debug()
	refresh(reset?: boolean) {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log === undefined) {
			this._log = await Container.git.getLogForFile(this.uri.repoPath, this.uri.fsPath, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: this.uri.sha
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	async showMore(limit?: number | { until?: any }) {
		let log = await this.getLog();
		if (log === undefined || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;
		this.triggerChange(false);
	}
}
