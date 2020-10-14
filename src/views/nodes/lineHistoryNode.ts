'use strict';
import { Disposable, Selection, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitFileNode } from './commitFileNode';
import { LoadMoreNode, MessageNode } from './common';
import { Container } from '../../container';
import {
	GitBranch,
	GitCommitType,
	GitFile,
	GitLog,
	GitLogCommit,
	GitRevision,
	RepositoryChange,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { insertDateMarkers } from './helpers';
import { Logger } from '../../logger';
import { LineHistoryTrackerNode } from './lineHistoryTrackerNode';
import { RepositoryNode } from './repositoryNode';
import { debug, gate, Iterables, memoize } from '../../system';
import { View } from '../viewBase';
import { ContextValues, PageableViewNode, SubscribeableViewNode, ViewNode } from './viewNode';

export class LineHistoryNode extends SubscribeableViewNode implements PageableViewNode {
	static key = ':history:line';
	static getId(repoPath: string, uri: string, selection: Selection): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${uri}[${selection.start.line},${
			selection.start.character
		}-${selection.end.line},${selection.end.character}])`;
	}

	protected splatted = true;

	constructor(
		uri: GitUri,
		view: View,
		parent: ViewNode,
		private readonly branch: GitBranch | undefined,
		public readonly selection: Selection,
		private readonly editorContents: string | undefined,
	) {
		super(uri, view, parent);
	}

	toClipboard(): string {
		return this.uri.fileName;
	}

	get id(): string {
		return LineHistoryNode.getId(this.uri.repoPath!, this.uri.toString(true), this.selection);
	}

	async getChildren(): Promise<ViewNode[]> {
		this.view.description = `${this.label}${
			this.parent instanceof LineHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''
		}`;

		const children: ViewNode[] = [];

		let selection = this.selection;

		const range = this.branch != null ? await Container.git.getBranchAheadRange(this.branch) : undefined;
		const [log, blame, unpublishedCommits] = await Promise.all([
			this.getLog(selection),
			this.uri.sha == null
				? this.editorContents
					? await Container.git.getBlameForRangeContents(this.uri, selection, this.editorContents)
					: await Container.git.getBlameForRange(this.uri, selection)
				: undefined,
			range
				? Container.git.getLogRefsOnly(this.uri.repoPath!, {
						limit: 0,
						ref: range,
				  })
				: undefined,
		]);

		if (this.uri.sha == null) {
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

					const status = await Container.git.getStatusForFile(this.uri.repoPath!, this.uri.fsPath);

					const file: GitFile = {
						fileName: commit.fileName,
						indexStatus: status?.indexStatus ?? '?',
						originalFileName: commit.originalFileName,
						repoPath: this.uri.repoPath!,
						status: 'M',
						workingTreeStatus: status?.workingTreeStatus ?? '?',
					};

					if (status?.workingTreeStatus != null && status?.indexStatus != null) {
						let uncommitted = new GitLogCommit(
							GitCommitType.LogFile,
							this.uri.repoPath!,
							GitRevision.uncommittedStaged,
							'You',
							commit.email,
							commit.authorDate,
							commit.committerDate,
							commit.message,
							commit.fileName,
							[file],
							'M',
							commit.originalFileName,
							commit.previousSha,
							commit.originalFileName ?? commit.fileName,
						);

						children.splice(
							0,
							0,
							new CommitFileNode(this.view, this, file, uncommitted, {
								displayAsCommit: true,
								inFileHistory: true,
								selection: selection,
							}),
						);

						uncommitted = new GitLogCommit(
							GitCommitType.LogFile,
							this.uri.repoPath!,
							GitRevision.uncommitted,
							'You',
							commit.email,
							commit.authorDate,
							commit.committerDate,
							commit.message,
							commit.fileName,
							[file],
							'M',
							commit.originalFileName,
							GitRevision.uncommittedStaged,
							commit.originalFileName ?? commit.fileName,
						);

						children.splice(
							0,
							0,
							new CommitFileNode(this.view, this, file, uncommitted, {
								displayAsCommit: true,
								inFileHistory: true,
								selection: selection,
							}),
						);
					} else {
						const uncommitted = new GitLogCommit(
							GitCommitType.LogFile,
							this.uri.repoPath!,
							status?.workingTreeStatus != null
								? GitRevision.uncommitted
								: status?.indexStatus != null
								? GitRevision.uncommittedStaged
								: commit.sha,
							'You',
							commit.email,
							commit.authorDate,
							commit.committerDate,
							commit.message,
							commit.fileName,
							[file],
							'M',
							commit.originalFileName,
							commit.previousSha,
							commit.originalFileName ?? commit.fileName,
						);

						children.splice(
							0,
							0,
							new CommitFileNode(this.view, this, file, uncommitted, {
								displayAsCommit: true,
								inFileHistory: true,
								selection: selection,
							}),
						);
					}

					break;
				}
			}
		}

		if (log != null) {
			children.push(
				...insertDateMarkers(
					Iterables.filterMap(
						log.commits.values(),
						c =>
							new CommitFileNode(this.view, this, c.files[0], c, {
								branch: this.branch,
								displayAsCommit: true,
								inFileHistory: true,
								selection: selection,
								unpublished: unpublishedCommits?.has(c.ref),
							}),
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

		this.view.description = `${label}${
			this.parent instanceof LineHistoryTrackerNode && !this.parent.followingEditor ? ' (pinned)' : ''
		}`;

		return item;
	}

	get label() {
		return `${this.uri.fileName}${this.lines}${
			this.uri.sha
				? ` ${this.uri.sha === GitRevision.deletedOrMissing ? this.uri.shortSha : `(${this.uri.shortSha})`}`
				: ''
		}`;
	}

	@memoize()
	get lines() {
		return this.selection.isSingleLine
			? `:${this.selection.start.line + 1}`
			: `:${this.selection.start.line + 1}-${this.selection.end.line + 1}`;
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

		Logger.debug(`LineHistoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

		void this.triggerChange();
	}

	private onRepoFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (!e.uris.some(uri => uri.toString() === this.uri.toString())) return;

		Logger.debug(`LineHistoryNode.onRepoFileSystemChanged(${this.uri.toString(true)}); triggering node refresh`);

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
	private async getLog(selection?: Selection) {
		if (this._log == null) {
			this._log = await Container.git.getLogForFile(this.uri.repoPath, this.uri.fsPath, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: this.uri.sha,
				range: selection ?? this.selection,
				renames: false,
			});
		}

		return this._log;
	}

	get hasMore() {
		return this._log?.hasMore ?? true;
	}

	limit: number | undefined = this.view.getNodeLastKnownLimit(this);
	async loadMore(limit?: number | { until?: any }) {
		let log = await this.getLog();
		if (log == null || !log.hasMore) return;

		log = await log.more?.(limit ?? this.view.config.pageItemLimit);
		if (this._log === log) return;

		this._log = log;
		this.limit = log?.count;

		// Needs to force if splatted, since the parent node will cancel the refresh (since it thinks nothing changed)
		void this.triggerChange(false, this.splatted);
	}
}
