import type { Command, Selection } from 'vscode';
import { TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import type { DiffWithPreviousCommandArgs } from '../../commands/diffWithPrevious';
import { Schemes } from '../../constants';
import { GlCommand } from '../../constants.commands';
import type { TreeViewRefFileNodeTypes } from '../../constants.views';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import { getGitFileStatusIcon } from '../../git/models/file';
import type { GitRevisionReference } from '../../git/models/reference';
import { joinPaths } from '../../system/path';
import { relativeDir } from '../../system/vscode/path';
import type { ViewsWithCommits, ViewsWithStashes } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { getFileTooltipMarkdown } from './abstract/viewFileNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { ViewRefFileNode } from './abstract/viewRefNode';

export abstract class CommitFileNodeBase<
	Type extends TreeViewRefFileNodeTypes,
	TView extends ViewsWithCommits | ViewsWithStashes,
> extends ViewRefFileNode<Type, TView> {
	constructor(
		type: Type,
		view: TView,
		parent: ViewNode,
		file: GitFile,
		public commit: GitCommit,
		private readonly options?: {
			branch?: GitBranch;
			selection?: Selection;
			unpublished?: boolean;
		},
	) {
		super(type, GitUri.fromFile(file, commit.repoPath, commit.sha), view, parent, file);

		this.updateContext({ commit: commit, file: file });
		this._uniqueId = getViewNodeId(type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.file.path;
	}

	get priority(): number {
		return 0;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	async getTreeItem(): Promise<TreeItem> {
		if (this.commit.file == null) {
			// Try to get the commit directly from the multi-file commit
			const commit = await this.commit.getCommitForFile(this.file);
			if (commit == null) {
				const log = await this.view.container.git.getLogForFile(this.repoPath, this.file.path, {
					limit: 2,
					ref: this.commit.sha,
				});
				if (log != null) {
					this.commit = log.commits.get(this.commit.sha) ?? this.commit;
				}
			} else {
				this.commit = commit;
			}
		}

		const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
		item.id = this.id;
		item.contextValue = this.contextValue;
		item.description = this.description;

		if (this.view.config.files.icon === 'type') {
			item.resourceUri = Uri.from({
				scheme: Schemes.Git,
				authority: 'gitlens-view',
				path: this.uri.path,
				query: JSON.stringify({
					// Ensure we use the fsPath here, otherwise the url won't open properly
					path: this.uri.fsPath,
					ref: this.uri.sha,
					decoration: createViewDecorationUri('commit-file', { status: this.file.status }).toString(),
				}),
			});
		} else {
			item.resourceUri = createViewDecorationUri('commit-file', { status: this.file.status });
			const icon = getGitFileStatusIcon(this.file.status);
			item.iconPath = {
				dark: this.view.container.context.asAbsolutePath(joinPaths('images', 'dark', icon)),
				light: this.view.container.context.asAbsolutePath(joinPaths('images', 'light', icon)),
			};
		}
		item.tooltip = getFileTooltipMarkdown(this.file);
		item.command = this.getCommand();

		// Only cache the label for a single refresh (its only cached because it is used externally for sorting)
		this._label = undefined;

		return item;
	}

	protected get contextValue(): string {
		if (!this.commit.isUncommitted) {
			return `${ContextValues.File}+committed${this.options?.branch?.current ? '+current' : ''}${
				this.options?.branch?.current && this.options.branch.sha === this.commit.ref ? '+HEAD' : ''
			}${this.options?.unpublished ? '+unpublished' : ''}`;
		}

		return this.commit.isUncommittedStaged ? `${ContextValues.File}+staged` : `${ContextValues.File}+unstaged`;
	}

	private get description() {
		return StatusFileFormatter.fromTemplate(this.view.config.formats.files.description, this.file, {
			relativePath: this.relativePath,
		});
	}

	private _folderName: string | undefined;
	get folderName() {
		if (this._folderName === undefined) {
			this._folderName = relativeDir(this.uri.relativePath);
		}
		return this._folderName;
	}

	private _label: string | undefined;
	get label() {
		if (this._label === undefined) {
			this._label = StatusFileFormatter.fromTemplate(this.view.config.formats.files.label, this.file, {
				relativePath: this.relativePath,
			});
		}
		return this._label;
	}

	private _relativePath: string | undefined;
	get relativePath(): string | undefined {
		return this._relativePath;
	}
	set relativePath(value: string | undefined) {
		this._relativePath = value;
		this._label = undefined;
	}

	override getCommand(): Command | undefined {
		let line;
		if (this.commit.lines.length) {
			line = this.commit.lines[0].line - 1;
		} else {
			line = this.options?.selection?.active.line ?? 0;
		}

		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			uri: GitUri.fromFile(this.file, this.commit.repoPath),
			line: line,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Open Changes with Previous Revision',
			command: GlCommand.DiffWithPrevious,
			arguments: [undefined, commandArgs],
		};
	}
}

export class CommitFileNode extends CommitFileNodeBase<'commit-file', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		file: GitFile,
		commit: GitCommit,
		options?: {
			branch?: GitBranch;
			selection?: Selection;
			unpublished?: boolean;
		},
	) {
		super('commit-file', view, parent, file, commit, options);
	}
}
