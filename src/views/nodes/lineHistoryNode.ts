'use strict';
import { Disposable, Selection, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitCommitType, GitFile, GitLogCommit } from '../../git/git';
import {
	GitLog,
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

export class LineHistoryNode extends SubscribeableViewNode implements PageableViewNode {
	static key = ':history:line';
	static getId(repoPath: string, uri: string, selection: Selection): string {
		return `${RepositoryNode.getId(repoPath)}${this.key}(${uri}[${selection.start.line},${selection.start.character}-${selection.end.line},${selection.end.character}])`;
	}

	constructor(
		uri: GitUri,
		view: View,
		parent: ViewNode,
		public readonly selection: Selection,
		private readonly _editorContents: string | undefined
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
		const children: ViewNode[] = [];

		let selection = this.selection;

		if (this.uri.sha === undefined) {
			// Check for any uncommitted changes in the range
			const blame = this._editorContents
				? await Container.git.getBlameForRangeContents(this.uri, selection, this._editorContents)
				: await Container.git.getBlameForRange(this.uri, selection);
			if (blame !== undefined) {
				for (const commit of blame.commits.values()) {
					if (!commit.isUncommitted) continue;

					const file: GitFile = {
						fileName: commit.fileName,
						indexStatus: '?',
						originalFileName: commit.originalFileName,
						repoPath: this.uri.repoPath!,
						status: 'M',
						workingTreeStatus: '?'
					};

					const uncommitted = new GitLogCommit(
						GitCommitType.LogFile,
						this.uri.repoPath!,
						commit.sha,
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
						commit.originalFileName || commit.fileName
					);

					const firstLine = blame.lines[0];
					const lastLine = blame.lines[blame.lines.length - 1];

					// Since there could be a change in the line numbers, update the selection
					const firstActive = selection.active.line === firstLine.line - 1;
					selection = new Selection(
						(firstActive ? lastLine : firstLine).originalLine - 1,
						selection.anchor.character,
						(firstActive ? firstLine : lastLine).originalLine - 1,
						selection.active.character
					);

					children.splice(
						0,
						0,
						new CommitFileNode(this.view, this, file, uncommitted, {
							displayAsCommit: true,
							inFileHistory: true,
							selection: selection
						})
					);

					break;
				}
			}
		}

		const log = await this.getLog(selection);
		if (log !== undefined) {
			children.push(
				...insertDateMarkers(
					Iterables.filterMap(
						log.commits.values(),
						c =>
							new CommitFileNode(this.view, this, c.files[0], c, {
								displayAsCommit: true,
								inFileHistory: true,
								selection: selection
							})
					),
					this
				)
			);

			if (log.hasMore) {
				children.push(new ShowMoreNode(this.view, this, 'Commits', children[children.length - 1]));
			}
		}

		if (children.length === 0) return [new MessageNode(this.view, this, 'No line history could be found.')];
		return children;
	}

	getTreeItem(): TreeItem {
		const lines = this.selection.isSingleLine
			? ` #${this.selection.start.line + 1}`
			: ` #${this.selection.start.line + 1}-${this.selection.end.line + 1}`;
		const item = new TreeItem(
			`${this.uri.fileName}${lines}${
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
		item.contextValue = ResourceType.LineHistory;
		item.description = this.uri.directory;
		item.tooltip = `History of ${this.uri.fileName}${lines}\n${this.uri.directory}/${
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

		Logger.log(`LineHistoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

		void this.triggerChange();
	}

	private onRepoFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
		if (!e.uris.some(uri => uri.toString(true) === this.uri.toString(true))) return;

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
		if (this._log === undefined) {
			this._log = await Container.git.getLogForFile(this.uri.repoPath, this.uri.fsPath, {
				limit: this.limit ?? this.view.config.defaultItemLimit,
				ref: this.uri.sha,
				range: selection ?? this.selection
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
