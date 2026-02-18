import type { Selection } from 'vscode';
import { Disposable, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { GitUri } from '../../git/gitUri.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitFile } from '../../git/models/file.js';
import { GitFileIndexStatus } from '../../git/models/fileStatus.js';
import type { GitLog } from '../../git/models/log.js';
import type { RepositoryChangeEvent, RepositoryFileSystemChangeEvent } from '../../git/models/repository.js';
import { deletedOrMissing } from '../../git/models/revision.js';
import { getBranchAheadRange } from '../../git/utils/-webview/branch.utils.js';
import { isUncommitted } from '../../git/utils/revision.utils.js';
import { gate } from '../../system/decorators/gate.js';
import { trace } from '../../system/decorators/log.js';
import { memoize } from '../../system/decorators/memoize.js';
import { weakEvent } from '../../system/event.js';
import { filterMap, find } from '../../system/iterable.js';
import { getLoggableName } from '../../system/logger.js';
import { maybeStartLoggableScope } from '../../system/logger.scope.js';
import { getSettledValue } from '../../system/promise.js';
import type { FileHistoryView } from '../fileHistoryView.js';
import type { LineHistoryView } from '../lineHistoryView.js';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode.js';
import type { PageableViewNode, ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { LoadMoreNode, MessageNode } from './common.js';
import { FileRevisionAsCommitNode } from './fileRevisionAsCommitNode.js';
import { LineHistoryTrackerNode } from './lineHistoryTrackerNode.js';
import { insertDateMarkers } from './utils/-webview/node.utils.js';

export class LineHistoryNode
	extends SubscribeableViewNode<'line-history', FileHistoryView | LineHistoryView>
	implements PageableViewNode
{
	limit: number | undefined;

	constructor(
		uri: GitUri,
		view: FileHistoryView | LineHistoryView,
		protected override readonly parent: ViewNode,
		private readonly branch: GitBranch | undefined,
		public readonly selection: Selection,
		private readonly editorContents: string | undefined,
	) {
		super('line-history', uri, view, parent);

		if (branch != null) {
			this.updateContext({ branch: branch });
		}
		this._uniqueId = getViewNodeId(
			`${this.type}+${uri.toString()}+[${selection.start.line},${selection.start.character}-${
				selection.end.line
			},${selection.end.character}]`,
			this.context,
		);
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
			this.parent instanceof LineHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''
		}`;

		const children: ViewNode[] = [];
		if (this.uri.repoPath == null) return children;

		const { sha } = this.uri;
		const selection = this.selection;

		const svc = this.view.container.git.getRepositoryService(this.uri.repoPath);
		const range = this.branch != null ? await getBranchAheadRange(svc, this.branch) : undefined;
		const [logResult, blameResult, getBranchAndTagTipsResult, unpublishedCommitsResult] = await Promise.allSettled([
			this.getLog(selection),
			sha == null || isUncommitted(sha)
				? this.editorContents
					? this.view.container.git.getBlameForRangeContents(this.uri, selection, this.editorContents)
					: this.view.container.git.getBlameForRange(this.uri, selection)
				: undefined,
			svc.getBranchesAndTagsTipsLookup(this.branch?.name),
			range ? svc.commits.getLogShas(range, { limit: 0 }) : undefined,
		]);

		// Check for any uncommitted changes in the range
		const blame = getSettledValue(blameResult);
		if (blame?.lines.length) {
			const uncommittedCommit = find(blame.commits.values(), c => c.isUncommitted);
			if (uncommittedCommit != null) {
				const relativePath = svc.getRelativePath(this.uri, this.uri.repoPath);

				const status = await svc.status.getStatusForFile?.(this.uri);
				if (status != null) {
					const file: GitFile = {
						conflictStatus: status?.conflictStatus,
						path: uncommittedCommit.file?.path ?? relativePath,
						indexStatus: status?.indexStatus,
						originalPath: uncommittedCommit.file?.originalPath,
						repoPath: this.uri.repoPath,
						status: status?.status ?? GitFileIndexStatus.Modified,
						workingTreeStatus: status?.workingTreeStatus,
					};

					const currentUser = await svc.config.getCurrentUser();
					const pseudoCommits = status?.getPseudoCommits(this.view.container, currentUser);
					if (pseudoCommits != null) {
						for (const commit of pseudoCommits.reverse()) {
							children.unshift(
								new FileRevisionAsCommitNode(this.view, this, file, commit, {
									selection: selection,
								}),
							);
						}
					}
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
						c.file != null
							? new FileRevisionAsCommitNode(this.view, this, c.file, c, {
									branch: this.branch,
									getBranchAndTagTips: getBranchAndTagTips,
									selection: selection,
									unpublished: unpublishedCommits?.has(c.ref),
								})
							: undefined,
					),
					this,
				),
			);

			if (log.hasMore) {
				children.push(new LoadMoreNode(this.view, this, children.at(-1)!));
			}
		}

		if (children.length === 0) return [new MessageNode(this.view, this, 'No line history could be found.')];
		return children;
	}

	getTreeItem(): TreeItem {
		const label = this.label;
		const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.LineHistory;
		item.description = this.uri.directory;
		item.tooltip = `History of ${this.uri.fileName}${this.lines}\n${this.uri.directory}/${
			this.uri.sha == null ? '' : `\n\n${this.uri.sha}`
		}`;

		this.view.description = `${label}${
			this.parent instanceof LineHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''
		}`;

		return item;
	}

	get label(): string {
		return `${this.uri.fileName}${this.lines}${
			this.uri.sha ? ` ${this.uri.sha === deletedOrMissing ? this.uri.shortSha : `(${this.uri.shortSha})`}` : ''
		}`;
	}

	@memoize()
	get lines(): string {
		return this.selection.isSingleLine
			? `:${this.selection.start.line + 1}`
			: `:${this.selection.start.line + 1}-${this.selection.end.line + 1}`;
	}

	@trace()
	protected subscribe(): Disposable | undefined {
		const repo = this.view.container.git.getRepository(this.uri);
		if (repo == null) return undefined;

		const subscription = Disposable.from(
			weakEvent(repo.onDidChange, this.onRepositoryChanged, this),
			weakEvent(repo.onDidChangeFileSystem, this.onFileSystemChanged, this, [repo.watchFileSystem()]),
		);

		return subscription;
	}

	protected override etag(): number {
		return Date.now();
	}

	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (!e.changed('index', 'heads', 'remotes', 'remoteProviders', 'pausedOp', 'unknown')) {
			return;
		}

		using scope = maybeStartLoggableScope(`${getLoggableName(this)}.onRepositoryChanged(e=${e.toString()})`);
		scope?.trace('triggering node refresh');

		void this.triggerChange(true);
	}

	private onFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (!e.uris.has(this.uri)) return;

		using scope = maybeStartLoggableScope(
			`${getLoggableName(this)}.onFileSystemChanged(e=${this.uri.toString(true)})`,
		);
		scope?.trace('triggering node refresh');

		void this.triggerChange(true);
	}

	@trace()
	override refresh(reset: boolean = false): void | { cancel: boolean } | Promise<void | { cancel: boolean }> {
		if (reset) {
			this._log = undefined;
		}
		return super.refresh(reset);
	}

	private _log: GitLog | undefined;
	private async getLog(selection?: Selection): Promise<GitLog | undefined> {
		this._log ??= await this.view.container.git
			.getRepositoryService(this.uri.repoPath!)
			.commits.getLogForPath(this.uri, this.uri.sha, {
				all: false,
				isFolder: false,
				limit: this.limit ?? this.view.config.pageItemLimit,
				range: selection ?? this.selection,
				renames: false,
			});

		return this._log;
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
}
