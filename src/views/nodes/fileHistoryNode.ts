import { Disposable, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitLog } from '../../git/models/log';
import type { RepositoryChangeEvent, RepositoryFileSystemChangeEvent } from '../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import { deletedOrMissing } from '../../git/models/revision';
import { getBranchAheadRange } from '../../git/utils/-webview/branch.utils';
import { configuration } from '../../system/-webview/configuration';
import { getFolderGlobUri } from '../../system/-webview/path';
import { gate } from '../../system/decorators/gate';
import { debug } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import { weakEvent } from '../../system/event';
import { filterMap, flatMap, map, some, uniqueBy } from '../../system/iterable';
import { getLoggableName, Logger } from '../../system/logger';
import { startLogScope } from '../../system/logger.scope';
import { basename } from '../../system/path';
import { getSettledValue } from '../../system/promise';
import type { FileHistoryView } from '../fileHistoryView';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { PageableViewNode, ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { CommitNode } from './commitNode';
import { LoadMoreNode, MessageNode } from './common';
import { ContributorNode } from './contributorNode';
import { FileHistoryTrackerNode } from './fileHistoryTrackerNode';
import { FileRevisionAsCommitNode } from './fileRevisionAsCommitNode';
import { insertDateMarkers } from './utils/-webview/node.utils';

export class FileHistoryNode
	extends SubscribeableViewNode<'file-history', FileHistoryView>
	implements PageableViewNode
{
	limit: number | undefined;

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
		this.view.description = `${this.view.groupedLabel ? `${this.view.groupedLabel}: ` : ''}${this.label}${
			this.parent instanceof FileHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''
		}`;

		if (this.view.mode === 'contributors') {
			return this.getContributors();
		}
		return this.getCommits();
	}

	getTreeItem(): TreeItem {
		const label = this.label;
		const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.FileHistory;
		item.description = this.uri.directory;
		item.tooltip = `History of ${this.uri.fileName}\n${this.uri.directory}/${
			this.uri.sha == null ? '' : `\n\n${this.uri.sha}`
		}`;

		this.view.description = `${this.view.groupedLabel ? `${this.view.groupedLabel}: ` : ''}${label}${
			this.parent instanceof FileHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''
		}`;

		return item;
	}

	get label(): string {
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
	protected subscribe(): Disposable | undefined {
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
				RepositoryChange.PausedOperationStatus,
				RepositoryChange.Unknown,
				RepositoryChangeComparisonMode.Any,
			)
		) {
			return;
		}

		using scope = startLogScope(`${getLoggableName(this)}.onRepositoryChanged(e=${e.toString()})`, false);
		Logger.debug(scope, 'triggering node refresh');

		void this.triggerChange(true);
	}

	private onFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (this.folder) {
			if (!some(e.uris, uri => uri.fsPath.startsWith(this.uri.fsPath))) return;
		} else if (!e.uris.has(this.uri)) {
			return;
		}

		using scope = startLogScope(
			`${getLoggableName(this)}.onFileSystemChanged(e=${this.uri.toString(true)})`,
			false,
		);
		Logger.debug(scope, 'triggering node refresh');

		void this.triggerChange(true);
	}

	@debug()
	override refresh(reset: boolean = false): void | { cancel: boolean } | Promise<void | { cancel: boolean }> {
		if (reset) {
			this._log = undefined;
		}
		return super.refresh(reset);
	}

	private _log: GitLog | undefined;
	private async getLog() {
		this._log ??= await this.view.container.git
			.getRepositoryService(this.uri.repoPath!)
			.commits.getLogForPath(this.uri, this.uri.sha, {
				limit: this.limit ?? this.view.config.pageItemLimit,
				isFolder: this.folder,
			});
		return this._log;
	}

	@memoize()
	private getPathOrGlob() {
		return this.folder ? getFolderGlobUri(this.uri) : this.uri;
	}

	get hasMore(): boolean {
		return this._log?.hasMore ?? true;
	}

	@gate()
	async loadMore(limit?: number | { until?: any }): Promise<void> {
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

	private async getContributors(): Promise<ViewNode[]> {
		if (this.uri.repoPath == null) return [];

		const svc = this.view.container.git.getRepositoryService(this.uri.repoPath);
		const result = await svc.contributors.getContributors(this.uri.sha ?? undefined, {
			pathspec: this.folder
				? svc.getRelativePath(this.getPathOrGlob(), this.uri.repoPath)
				: svc.getRelativePath(this.uri, this.uri.repoPath),
			stats: true,
		});
		if (!result?.contributors.length) return [new MessageNode(this.view, this, 'No contributors could be found.')];

		const children = result.contributors.map(
			contributor =>
				new ContributorNode(this.uri, this.view, this, contributor, {
					presence: undefined,
					ref: this.uri.sha,
					showMergeCommits: configuration.get('advanced.fileHistoryShowMergeCommits'),
					pathspec: { uri: this.uri, isFolder: this.folder },
				}),
		);

		return children;
	}

	private async getCommits(): Promise<ViewNode[]> {
		if (this.uri.repoPath == null) return [];

		const children: ViewNode[] = [];

		const svc = this.view.container.git.getRepositoryService(this.uri.repoPath);
		const range = this.branch != null ? await getBranchAheadRange(svc, this.branch) : undefined;
		const [logResult, fileStatusesResult, currentUserResult, getBranchAndTagTipsResult, unpublishedCommitsResult] =
			await Promise.allSettled([
				this.getLog(),
				this.uri.sha == null ? svc.status.getStatusForPath?.(this.uri) : undefined,
				this.uri.sha == null ? svc.config.getCurrentUser() : undefined,
				svc.getBranchesAndTagsTipsLookup(this.branch?.name),
				range ? svc.commits.getLogShas(range, { limit: 0 }) : undefined,
			]);

		const currentUser = getSettledValue(currentUserResult);
		const fileStatuses = getSettledValue(fileStatusesResult);

		if (fileStatuses?.length) {
			if (this.folder) {
				const relativePath = svc.getRelativePath(this.getPathOrGlob(), this.uri.repoPath);
				// Combine all the working/staged changes into single pseudo commits
				const commits = map(
					uniqueBy(
						flatMap(fileStatuses, f => f.getPseudoCommits(this.view.container, currentUser)),
						c => c.sha,
						(original, c) =>
							original.with({
								fileset: {
									files: [...(original.fileset?.files ?? []), ...(c.fileset?.files ?? [])],
									filtered: {
										files: [
											...(original.fileset?.filtered?.files ?? []),
											...(c.fileset?.filtered?.files ?? []),
										],
										pathspec: relativePath,
									},
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

		const getBranchAndTagTips = getSettledValue(getBranchAndTagTipsResult);
		const unpublishedCommits = new Set(getSettledValue(unpublishedCommitsResult));

		const log = getSettledValue(logResult);
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
									{ allowFilteredFiles: true, expand: false },
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

		if (!children.length) return [new MessageNode(this.view, this, 'No file history could be found.')];

		return children;
	}
}
