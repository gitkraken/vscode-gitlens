import type { Command, Selection } from 'vscode';
import { MarkdownString, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import type { DiffWithPreviousCommandArgs } from '../../commands';
import { Commands } from '../../constants';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import { getGitFileStatusIcon } from '../../git/models/file';
import type { GitRevisionReference } from '../../git/models/reference';
import { joinPaths, relativeDir } from '../../system/path';
import type { FileHistoryView } from '../fileHistoryView';
import type { View, ViewsWithCommits } from '../viewBase';
import type { ViewNode } from './viewNode';
import { ContextValues, ViewRefFileNode } from './viewNode';

export class CommitFileNode<TView extends View = ViewsWithCommits | FileHistoryView> extends ViewRefFileNode<TView> {
	static key = ':file';
	static getId(parent: ViewNode, path: string): string {
		return `${parent.id}${this.key}(${path})`;
	}

	constructor(
		view: TView,
		parent: ViewNode,
		file: GitFile,
		public commit: GitCommit,
		private readonly _options: {
			branch?: GitBranch;
			selection?: Selection;
			unpublished?: boolean;
		} = {},
	) {
		super(GitUri.fromFile(file, commit.repoPath, commit.sha), view, parent, file);
	}

	override toClipboard(): string {
		return this.file.path;
	}

	override get id(): string {
		return CommitFileNode.getId(this.parent, this.file.path);
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
		item.resourceUri = Uri.parse(`gitlens-view://commit-file/status/${this.file.status}`);
		item.tooltip = this.tooltip;

		const icon = getGitFileStatusIcon(this.file.status);
		item.iconPath = {
			dark: this.view.container.context.asAbsolutePath(joinPaths('images', 'dark', icon)),
			light: this.view.container.context.asAbsolutePath(joinPaths('images', 'light', icon)),
		};

		item.command = this.getCommand();

		// Only cache the label for a single refresh (its only cached because it is used externally for sorting)
		this._label = undefined;

		return item;
	}

	protected get contextValue(): string {
		if (!this.commit.isUncommitted) {
			return `${ContextValues.File}+committed${this._options.branch?.current ? '+current' : ''}${
				this._options.branch?.current && this._options.branch.sha === this.commit.ref ? '+HEAD' : ''
			}${this._options.unpublished ? '+unpublished' : ''}`;
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

	private get tooltip() {
		const tooltip = StatusFileFormatter.fromTemplate(
			`\${file}\${'&nbsp;&nbsp;\u2022&nbsp;&nbsp;'changesDetail}\${'&nbsp;\\\n'directory}&nbsp;\n\n\${status}\${ (originalPath)}`,
			this.file,
		);

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		return markdown;
	}

	override getCommand(): Command | undefined {
		let line;
		if (this.commit.lines.length) {
			line = this.commit.lines[0].line - 1;
		} else {
			line = this._options.selection?.active.line ?? 0;
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
			command: Commands.DiffWithPrevious,
			arguments: [undefined, commandArgs],
		};
	}
}
