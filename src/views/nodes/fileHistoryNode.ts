'use strict';
import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitFileNode } from './commitFileNode';
import { MessageNode, ShowMoreNode } from './common';
import { Container } from '../../container';
import { FileHistoryTrackerNode } from './fileHistoryTrackerNode';
import {
	GitLog,
	GitRevision,
	RepositoryChange,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { insertDateMarkers } from './helpers';
import { Logger } from '../../logger';
import { RepositoryNode } from './repositoryNode';
import { debug, gate, Iterables } from '../../system';
import { View } from '../viewBase';
import { ContextValues, PageableViewNode, SubscribeableViewNode, ViewNode } from './viewNode';

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

		if (this.uri.sha == null) {
			const status = await Container.git.getStatusForFile(this.uri.repoPath!, this.uri.fsPath);

			const commits = await status?.toPsuedoCommits();
			if (commits?.length) {
				children.push(
					...commits.map(
						commit =>
							new CommitFileNode(this.view, this, status!, commit, {
								displayAsCommit: true,
								inFileHistory: true,
							}),
					),
				);
			}
		}

		const log = await this.getLog();
		if (log != null) {
			children.push(
				...insertDateMarkers(
					Iterables.map(
						log.commits.values(),
						c =>
							new CommitFileNode(this.view, this, c.files[0], c, {
								displayAsCommit: true,
								inFileHistory: true,
							}),
					),
					this,
				),
			);

			if (log.hasMore) {
				children.push(new ShowMoreNode(this.view, this, children[children.length - 1]));
			}
		}

		this.view.titleDescription = `${this.uri.fileName}${
			this.uri.sha
				? ` ${this.uri.sha === GitRevision.deletedOrMissing ? this.uri.shortSha : `(${this.uri.shortSha})`}`
				: ''
		}${this.parent instanceof FileHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''}`;

		void this.ensureSubscription();

		if (children.length === 0) return [new MessageNode(this.view, this, 'No file history could be found.')];
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			`${this.uri.fileName}${
				this.uri.sha
					? ` ${this.uri.sha === GitRevision.deletedOrMissing ? this.uri.shortSha : `(${this.uri.shortSha})`}`
					: ''
			}`,
			TreeItemCollapsibleState.Expanded,
		);
		item.contextValue = ContextValues.FileHistory;
		item.description = this.uri.directory;
		item.tooltip = `History of ${this.uri.fileName}\n${this.uri.directory}/${
			this.uri.sha == null ? '' : `\n\n${this.uri.sha}`
		}`;

		this.view.titleDescription = `${this.uri.fileName}${
			this.uri.sha
				? ` ${this.uri.sha === GitRevision.deletedOrMissing ? this.uri.shortSha : `(${this.uri.shortSha})`}`
				: ''
		}${this.parent instanceof FileHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''}`;

		void this.ensureSubscription();

		return item;
	}

	@debug()
	protected async subscribe() {
		const repo = await Container.git.getRepository(this.uri);
		if (repo == null) return undefined;

		const subscription = Disposable.from(
			repo.onDidChange(this.onRepoChanged, this),
			repo.onDidChangeFileSystem(this.onRepoFileSystemChanged, this),
			{ dispose: () => repo.stopWatchingFileSystem() },
		);

		repo.startWatchingFileSystem();

		return subscription;
	}

	private onRepoChanged(e: RepositoryChangeEvent) {
		if (!e.changed(RepositoryChange.Heads)) return;

		Logger.log(`FileHistoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

		void (this.parent ?? this).triggerChange(true);
	}

	private onRepoFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (!e.uris.some(uri => uri.toString(true) === this.uri.toString(true))) return;

		Logger.debug(
			`FileHistoryNode${this.id}.onRepoFileSystemChanged(${this.uri.toString(true)}); triggering node refresh`,
		);

		void (this.parent ?? this).triggerChange(true);
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
		if (this._log == null) {
			this._log = await Container.git.getLogForFile(this.uri.repoPath, this.uri.fsPath, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: this.uri.sha,
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
		if (log == null || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;
		void (this.parent ?? this).triggerChange(false);
		if (this.parent) {
			this.view.triggerNodeChange(this.parent);
		}
	}
}
