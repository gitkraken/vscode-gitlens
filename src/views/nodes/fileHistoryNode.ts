import { Disposable, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { RepositoryChangeEvent, RepositoryFileSystemChangeEvent } from '../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import { deletedOrMissing } from '../../git/models/revision';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import { weakEvent } from '../../system/event';
import { filterMap, flatMap, map, uniqueBy } from '../../system/iterable';
import { Logger } from '../../system/logger';
import { basename } from '../../system/path';
import { configuration } from '../../system/vscode/configuration';
import type { FileHistoryView } from '../fileHistoryView';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { PageableViewNode, ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { FileHistoryTrackerNode } from './fileHistoryTrackerNode';
import { FileRevisionAsCommitNode } from './fileRevisionAsCommitNode';
import { insertDateMarkers } from './helpers';

export class FileHistoryNode
	extends SubscribeableViewNode<'file-history', FileHistoryView>
	implements PageableViewNode
{
	limit: number | undefined;

	protected override splatted = true;

	constructor(
		uri: GitUri,
		view: FileHistoryView,
		protected override readonly parent: ViewNode,
		private readonly folder: boolean,
		private readonly branch: GitBranch | undefined,
	) {
		super('file-history', uri, view, parent);

		if (branch != null) {
			this.updateContext({ branch: branch });
		}
		this._uniqueId = getViewNodeId(`${this.type}+${uri.toString()}`, this.context);
		this.limit = this.view.getNodeLastKnownLimit(this);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.uri.fileName;
	}

	async getChildren(): Promise<ViewNode[]> {
		this.view.description = `${this.label}${
			this.parent instanceof FileHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''
		}`;

		const children: ViewNode[] = [];
		if (this.uri.repoPath == null) return children;

		const range = this.branch != null ? await this.view.container.git.getBranchAheadRange(this.branch) : undefined;
		const [log, fileStatuses, currentUser, getBranchAndTagTips, unpublishedCommits] = await Promise.all([
			this.getLog(),
			this.uri.sha == null
				? this.view.container.git.getStatusForFiles(this.uri.repoPath, this.getPathOrGlob())
				: undefined,
			this.uri.sha == null ? this.view.container.git.getCurrentUser(this.uri.repoPath) : undefined,
			this.view.container.git.getBranchesAndTagsTipsLookup(this.uri.repoPath, this.branch?.name),
			range
				? this.view.container.git.getLogRefsOnly(this.uri.repoPath, {
						limit: 0,
						ref: range,
				  })
				: undefined,
		]);

		if (fileStatuses?.length) {
			if (this.folder) {
				// Combine all the working/staged changes into single pseudo commits
				const commits = map(
					uniqueBy(
						flatMap(fileStatuses, f => f.getPseudoCommits(this.view.container, currentUser)),
						c => c.sha,
						(original, c) =>
							original.with({
								files: {
									files: [
										...(original.files ?? (original.file != null ? [original.file] : [])),
										...(c.files ?? (c.file != null ? [c.file] : [])),
									],
								},
							}),
					),
					commit => new CommitNode(this.view, this, commit),
				);
				children.push(...commits);
			} else {
				const [file] = fileStatuses;
				const commits = file.getPseudoCommits(this.view.container, currentUser);
				if (commits.length) {
					children.push(
						...commits.map(commit => new FileRevisionAsCommitNode(this.view, this, file, commit)),
					);
				}
			}
		}

		if (log != null) {
			children.push(
				...insertDateMarkers(
					filterMap(log.commits.values(), c =>
						this.folder
							? new CommitNode(
									this.view,
									this,
									c,
									unpublishedCommits?.has(c.ref),
									this.branch,
									getBranchAndTagTips,
									{
										expand: false,
									},
							  )
							: c.file != null
							  ? new FileRevisionAsCommitNode(this.view, this, c.file, c, {
										branch: this.branch,
										getBranchAndTagTips: getBranchAndTagTips,
										unpublished: unpublishedCommits?.has(c.ref),
							    })
							  : undefined,
					),
					this,
				),
			);

			if (log.hasMore) {
				children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
			}
		}

		if (children.length === 0) return [new MessageNode(this.view, this, 'No file history could be found.')];
		return children;
	}

	getTreeItem(): TreeItem {
		this.splatted = false;

		const label = this.label;
		const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.FileHistory;
		item.description = this.uri.directory;
		item.tooltip = `History of ${this.uri.fileName}\n${this.uri.directory}/${
			this.uri.sha == null ? '' : `\n\n${this.uri.sha}`
		}`;

		this.view.description = `${label}${
			this.parent instanceof FileHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''
		}`;

		return item;
	}

	get label() {
		// Check if this is a base folder
		if (this.folder && this.uri.fileName === '') {
			return `${basename(this.uri.path)}${
				this.uri.sha
					? ` ${this.uri.sha === deletedOrMissing ? this.uri.shortSha : `(${this.uri.shortSha})`}`
					: ''
			}`;
		}

		return `${this.uri.fileName}${
			this.uri.sha ? ` ${this.uri.sha === deletedOrMissing ? this.uri.shortSha : `(${this.uri.shortSha})`}` : ''
		}`;
	}

	@debug()
	protected subscribe() {
		const repo = this.view.container.git.getRepository(this.uri);
		if (repo == null) return undefined;

		const subscription = Disposable.from(
			weakEvent(repo.onDidChange, this.onRepositoryChanged, this),
			weakEvent(repo.onDidChangeFileSystem, this.onFileSystemChanged, this, [repo.watchFileSystem()]),
			weakEvent(
				configuration.onDidChange,
				e => {
					if (configuration.changed(e, 'advanced.fileHistoryFollowsRenames')) {
						this.view.resetNodeLastKnownLimit(this);
					}
				},
				this,
			),
		);

		return subscription;
	}

	protected override etag(): number {
		return Date.now();
	}

	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (
			!e.changed(
				RepositoryChange.Index,
				RepositoryChange.Heads,
				RepositoryChange.Remotes,
				RepositoryChange.RemoteProviders,
				RepositoryChange.Status,
				RepositoryChange.Unknown,
				RepositoryChangeComparisonMode.Any,
			)
		) {
			return;
		}

		Logger.debug(`FileHistoryNode.onRepositoryChanged(${e.toString()}); triggering node refresh`);

		void this.triggerChange(true);
	}

	private onFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (this.folder) {
			if (!e.uris.some(uri => uri.fsPath.startsWith(this.uri.fsPath))) return;
		} else if (!e.uris.some(uri => uri.toString() === this.uri.toString())) {
			return;
		}

		Logger.debug(`FileHistoryNode.onFileSystemChanged(${this.uri.toString(true)}); triggering node refresh`);

		void this.triggerChange(true);
	}

	@gate()
	@debug()
	override refresh(reset?: boolean) {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog() {
		if (this._log == null) {
			this._log = await this.view.container.git.getLogForFile(this.uri.repoPath, this.getPathOrGlob(), {
				limit: this.limit ?? this.view.config.pageItemLimit,
				ref: this.uri.sha,
			});
		}

		return this._log;
	}

	@memoize()
	private getPathOrGlob() {
		return this.folder ? Uri.joinPath(this.uri, '*') : this.uri;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	@gate()
	async loadMore(limit?: number | { until?: any }) {
		let log = await window.withProgress(
			{
				location: { viewId: this.view.id },
			},
			() => this.getLog(),
		);
		if (!log?.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		// Needs to force if splatted, since the parent node will cancel the refresh (since it thinks nothing changed)
		void this.triggerChange(false, this.splatted);
	}
}
