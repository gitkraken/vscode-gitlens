import { Disposable, Selection, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitFile } from '../../git/models/file';
import { GitFileIndexStatus } from '../../git/models/fileStatus';
import type { GitLog } from '../../git/models/log';
import type { RepositoryChangeEvent, RepositoryFileSystemChangeEvent } from '../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import { deletedOrMissing } from '../../git/models/revision';
import { isUncommitted } from '../../git/utils/revision.utils';
import { gate } from '../../system/decorators/-webview/gate';
import { memoize } from '../../system/decorators/-webview/memoize';
import { debug } from '../../system/decorators/log';
import { weakEvent } from '../../system/event';
import { filterMap } from '../../system/iterable';
import { getLoggableName, Logger } from '../../system/logger';
import { startLogScope } from '../../system/logger.scope';
import type { FileHistoryView } from '../fileHistoryView';
import type { LineHistoryView } from '../lineHistoryView';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { PageableViewNode, ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { LoadMoreNode, MessageNode } from './common';
import { FileRevisionAsCommitNode } from './fileRevisionAsCommitNode';
import { insertDateMarkers } from './helpers';
import { LineHistoryTrackerNode } from './lineHistoryTrackerNode';

export class LineHistoryNode
	extends SubscribeableViewNode<'line-history', FileHistoryView | LineHistoryView>
	implements PageableViewNode
{
	limit: number | undefined;

	protected override splatted = true;

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
		this.view.description = `${this.view.groupedLabel ? `${this.view.groupedLabel} \u2022 ` : ''}${this.label}${
			this.parent instanceof LineHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''
		}`;

		const children: ViewNode[] = [];
		if (this.uri.repoPath == null) return children;

		let selection = this.selection;

		const range = this.branch != null ? await this.view.container.git.getBranchAheadRange(this.branch) : undefined;
		const [log, blame, getBranchAndTagTips, unpublishedCommits] = await Promise.all([
			this.getLog(selection),
			this.uri.sha == null || isUncommitted(this.uri.sha)
				? this.editorContents
					? await this.view.container.git.getBlameForRangeContents(this.uri, selection, this.editorContents)
					: await this.view.container.git.getBlameForRange(this.uri, selection)
				: undefined,
			this.view.container.git.getBranchesAndTagsTipsLookup(this.uri.repoPath, this.branch?.name),
			range ? this.view.container.git.commits(this.uri.repoPath).getLogShasOnly(range, { limit: 0 }) : undefined,
		]);

		// Check for any uncommitted changes in the range
		if (blame != null) {
			for (const commit of blame.commits.values()) {
				if (!commit.isUncommitted) continue;

				const firstLine = blame.lines[0];
				const lastLine = blame.lines[blame.lines.length - 1];

				// Since there could be a change in the line numbers, update the selection
				const firstActive = selection.active.line === firstLine.line - 1;
				selection = new Selection(
					(firstActive ? lastLine : firstLine).originalLine - 1,
					selection.anchor.character,
					(firstActive ? firstLine : lastLine).originalLine - 1,
					selection.active.character,
				);

				const status = await this.view.container.git.status(this.uri.repoPath).getStatusForFile?.(this.uri);

				if (status != null) {
					const file: GitFile = {
						conflictStatus: status?.conflictStatus,
						path: commit.file?.path ?? '',
						indexStatus: status?.indexStatus,
						originalPath: commit.file?.originalPath,
						repoPath: this.uri.repoPath,
						status: status?.status ?? GitFileIndexStatus.Modified,
						workingTreeStatus: status?.workingTreeStatus,
					};

					const currentUser = await this.view.container.git.config(this.uri.repoPath).getCurrentUser();
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

				break;
			}
		}

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
				children.push(new LoadMoreNode(this.view, this, children[children.length - 1]));
			}
		}

		if (children.length === 0) return [new MessageNode(this.view, this, 'No line history could be found.')];
		return children;
	}

	getTreeItem(): TreeItem {
		this.splatted = false;

		const label = this.label;
		const item = new TreeItem(label, TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.LineHistory;
		item.description = this.uri.directory;
		item.tooltip = `History of ${this.uri.fileName}${this.lines}\n${this.uri.directory}/${
			this.uri.sha == null ? '' : `\n\n${this.uri.sha}`
		}`;

		this.view.description = `${this.view.groupedLabel ? `${this.view.groupedLabel} \u2022 ` : ''}${label}${
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

	@debug()
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
		if (!e.uris.has(this.uri)) return;

		using scope = startLogScope(
			`${getLoggableName(this)}.onFileSystemChanged(e=${this.uri.toString(true)})`,
			false,
		);
		Logger.debug(scope, 'triggering node refresh');

		void this.triggerChange(true);
	}

	@gate()
	@debug()
	override refresh(reset?: boolean): void {
		if (reset) {
			this._log = undefined;
		}
	}

	private _log: GitLog | undefined;
	private async getLog(selection?: Selection) {
		if (this._log == null) {
			this._log = await this.view.container.git
				.commits(this.uri.repoPath!)
				.getLogForPath(this.uri, this.uri.sha, {
					all: false,
					limit: this.limit ?? this.view.config.pageItemLimit,
					range: selection ?? this.selection,
					renames: false,
				});
		}

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
