'use strict';
import * as paths from 'path';
import { Command, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchNode } from './branchNode';
import { ViewFilesLayout } from '../../configuration';
import { FileNode, FolderNode } from './folderNode';
import {
	CommitFormatter,
	GitBranch,
	GitLogCommit,
	GitRebaseStatus,
	GitReference,
	GitRevisionReference,
	GitStatus,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { MergeConflictFileNode } from './mergeConflictFileNode';
import { Arrays, Strings } from '../../system';
import { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode, ViewRefNode } from './viewNode';
import { Container } from '../../container';
import { GlyphChars } from '../../constants';
import { CommitFileNode } from './commitFileNode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';

export class RebaseStatusNode extends ViewNode<ViewsWithCommits> {
	static key = ':rebase';
	static getId(repoPath: string, name: string, root: boolean): string {
		return `${BranchNode.getId(repoPath, name, root)}${this.key}`;
	}

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly rebaseStatus: GitRebaseStatus,
		public readonly status: GitStatus | undefined,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
	) {
		super(GitUri.fromRepoPath(rebaseStatus.repoPath), view, parent);
	}

	get id(): string {
		return RebaseStatusNode.getId(this.rebaseStatus.repoPath, this.rebaseStatus.incoming.name, this.root);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.status?.hasConflicts !== true) return [];

		let children: FileNode[] = this.status.conflicts.map(
			f => new MergeConflictFileNode(this.view, this, this.rebaseStatus, f),
		);

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = Arrays.makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) =>
				a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' }),
			);
		}

		const commit = await Container.git.getCommit(this.rebaseStatus.repoPath, this.rebaseStatus.stepCurrent.ref);
		if (commit != null) {
			children.splice(0, 0, new RebaseCommitNode(this.view, this, commit) as any);
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			`${this.status?.hasConflicts ? 'Resolve conflicts to continue rebasing' : 'Rebasing'} ${
				this.rebaseStatus.incoming != null
					? `${GitReference.toString(this.rebaseStatus.incoming, { expand: false, icon: false })} `
					: ''
			}(${this.rebaseStatus.step}/${this.rebaseStatus.steps})`,
			TreeItemCollapsibleState.Expanded,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Rebase;
		item.description = this.status?.hasConflicts
			? Strings.pluralize('conflict', this.status.conflicts.length)
			: undefined;
		item.iconPath = this.status?.hasConflicts
			? new ThemeIcon('warning', new ThemeColor('list.warningForeground'))
			: new ThemeIcon('debug-pause', new ThemeColor('list.foreground'));
		item.tooltip = new MarkdownString(
			`${`Rebasing ${
				this.rebaseStatus.incoming != null ? GitReference.toString(this.rebaseStatus.incoming) : ''
			}onto ${GitReference.toString(this.rebaseStatus.current)}`}\n\nStep ${this.rebaseStatus.step} of ${
				this.rebaseStatus.steps
			}\\\nStopped at ${GitReference.toString(this.rebaseStatus.stepCurrent, { icon: true })}${
				this.status?.hasConflicts
					? `\n\n${Strings.pluralize('conflicted file', this.status.conflicts.length)}`
					: ''
			}`,
			true,
		);

		return item;
	}
}

export class RebaseCommitNode extends ViewRefNode<ViewsWithCommits, GitRevisionReference> {
	constructor(view: ViewsWithCommits, parent: ViewNode, public readonly commit: GitLogCommit) {
		super(commit.toGitUri(), view, parent);
	}

	toClipboard(): string {
		let message = this.commit.message;
		const index = message.indexOf('\n');
		if (index !== -1) {
			message = `${message.substring(0, index)}${GlyphChars.Space}${GlyphChars.Ellipsis}`;
		}

		return `${this.commit.shortSha}: ${message}`;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	private get tooltip() {
		return CommitFormatter.fromTemplate(
			`\${author}\${ (email)} ${
				GlyphChars.Dash
			} \${id}\${ (tips)}\n\${ago} (\${date})\${\n\nmessage}${this.commit.getFormattedDiffStatus({
				expand: true,
				prefix: '\n\n',
				separator: '\n',
			})}\${\n\n${GlyphChars.Dash.repeat(2)}\nfootnotes}`,
			this.commit,
			{
				dateFormat: Container.config.defaultDateFormat,
				messageIndent: 4,
			},
		);
	}

	getChildren(): ViewNode[] {
		const commit = this.commit;

		let children: FileNode[] = commit.files.map(
			s => new CommitFileNode(this.view, this, s, commit.toFileCommit(s)!),
		);

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = Arrays.makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) =>
				a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' }),
			);
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(`Stopped at commit ${this.commit.shortSha}`, TreeItemCollapsibleState.Collapsed);

		// item.contextValue = ContextValues.RebaseCommit;

		// eslint-disable-next-line no-template-curly-in-string
		item.description = CommitFormatter.fromTemplate('${message}', this.commit, {
			messageTruncateAtNewLine: true,
		});
		item.iconPath = new ThemeIcon('git-commit');
		item.tooltip = this.tooltip;

		return item;
	}

	getCommand(): Command | undefined {
		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			uri: this.uri,
			line: 0,
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
