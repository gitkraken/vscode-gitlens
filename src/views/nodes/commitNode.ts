'use strict';
import * as paths from 'path';
import { Command, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { CommitFileNode } from './commitFileNode';
import { ViewFilesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { FileNode, FolderNode } from './folderNode';
import { CommitFormatter, GitBranch, GitLogCommit, GitRevisionReference } from '../../git/git';
import { PullRequestNode } from './pullRequestNode';
import { StashesView } from '../stashesView';
import { Arrays, Strings } from '../../system';
import { ViewsWithFiles } from '../viewBase';
import { ContextValues, ViewNode, ViewRefNode } from './viewNode';
import { TagsView } from '../tagsView';

export class CommitNode extends ViewRefNode<ViewsWithFiles, GitRevisionReference> {
	constructor(
		view: ViewsWithFiles,
		parent: ViewNode,
		public readonly commit: GitLogCommit,
		private readonly unpublished?: boolean,
		public readonly branch?: GitBranch,
		private readonly getBranchAndTagTips?: (sha: string, compact?: boolean) => string | undefined,
		private readonly _options: { expand?: boolean } = {},
	) {
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
			this.commit.isUncommitted
				? `\${author} ${GlyphChars.Dash} \${id}\n\${ago} (\${date})`
				: `\${author}\${ (email)}\${" via "pullRequest} ${GlyphChars.Dash} \${id}${
						this.unpublished ? ' (unpublished)' : ''
				  }\${ (tips)}\n\${ago} (\${date})\${\n\nmessage}${this.commit.getFormattedDiffStatus({
						expand: true,
						prefix: '\n\n',
						separator: '\n',
				  })}\${\n\n${GlyphChars.Dash.repeat(2)}\nfootnotes}`,
			this.commit,
			{
				dateFormat: Container.config.defaultDateFormat,
				getBranchAndTagTips: this.getBranchAndTagTips,
				// messageAutolinks: true,
				messageIndent: 4,
			},
		);
	}

	async getChildren(): Promise<ViewNode[]> {
		const commit = this.commit;

		let children: (PullRequestNode | FileNode)[] = commit.files.map(
			s => new CommitFileNode(this.view, this, s, commit.toFileCommit(s)!),
		);

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = Arrays.makeHierarchical(
				children as FileNode[],
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			(children as FileNode[]).sort((a, b) =>
				a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' }),
			);
		}

		if (!(this.view instanceof StashesView) && !(this.view instanceof TagsView)) {
			if (this.view.config.pullRequests.enabled && this.view.config.pullRequests.showForCommits) {
				const pr = await commit.getAssociatedPullRequest();
				if (pr != null) {
					children.splice(0, 0, new PullRequestNode(this.view, this, pr, commit));
				}
			}
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const label = CommitFormatter.fromTemplate(this.view.config.commitFormat, this.commit, {
			dateFormat: Container.config.defaultDateFormat,
			getBranchAndTagTips: (sha: string) => this.getBranchAndTagTips?.(sha, true),
			messageTruncateAtNewLine: true,
		});

		const item = new TreeItem(
			label,
			this._options.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);

		item.contextValue = `${ContextValues.Commit}${this.branch?.current ? '+current' : ''}${
			this.branch?.current && this.branch.sha === this.commit.ref ? '+HEAD' : ''
		}${this.unpublished ? '+unpublished' : ''}`;

		item.description = CommitFormatter.fromTemplate(this.view.config.commitDescriptionFormat, this.commit, {
			dateFormat: Container.config.defaultDateFormat,
			messageTruncateAtNewLine: true,
		});
		item.iconPath = this.unpublished
			? new ThemeIcon('arrow-up')
			: !(this.view instanceof StashesView) && this.view.config.avatars
			? this.commit.getAvatarUri(Container.config.defaultGravatarsStyle)
			: new ThemeIcon('git-commit');
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
