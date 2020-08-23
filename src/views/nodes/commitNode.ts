'use strict';
import * as paths from 'path';
import { Command, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { ViewFilesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { CommitFormatter, GitBranch, GitLogCommit, GitRevisionReference } from '../../git/git';
import { Arrays, Strings } from '../../system';
import { ViewsWithFiles } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import { FileNode, FolderNode } from './folderNode';
import { ContextValues, ViewNode, ViewRefNode } from './viewNode';

export class CommitNode extends ViewRefNode<ViewsWithFiles, GitRevisionReference> {
	constructor(
		view: ViewsWithFiles,
		parent: ViewNode,
		public readonly commit: GitLogCommit,
		public readonly branch?: GitBranch,
		private readonly getBranchAndTagTips?: (sha: string) => string | undefined,
		private readonly _options: { expand?: boolean } = {},
	) {
		super(commit.toGitUri(), view, parent);
	}

	toClipboard(): string {
		return this.commit.sha;
	}

	get ref(): GitRevisionReference {
		return this.commit;
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
		const label = CommitFormatter.fromTemplate(this.view.config.commitFormat, this.commit, {
			dateFormat: Container.config.defaultDateFormat,
			getBranchAndTagTips: this.getBranchAndTagTips,
			truncateMessageAtNewLine: true,
		});

		const item = new TreeItem(
			label,
			this._options.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.contextValue = ContextValues.Commit;
		if (this.branch?.current) {
			item.contextValue += '+current';
		}
		item.description = CommitFormatter.fromTemplate(this.view.config.commitDescriptionFormat, this.commit, {
			truncateMessageAtNewLine: true,
			dateFormat: Container.config.defaultDateFormat,
		});
		item.iconPath = this.view.config.avatars
			? this.commit.getAvatarUri(Container.config.defaultGravatarsStyle)
			: new ThemeIcon('git-commit');
		item.tooltip = CommitFormatter.fromTemplate(
			this.commit.isUncommitted
				? `\${author} ${GlyphChars.Dash} \${id}\n\${ago} (\${date})`
				: `\${author} \${(email) }${GlyphChars.Dash} \${id}\${ (tips)}\n\${ago} (\${date})\n\n\${message}`,
			this.commit,
			{
				dateFormat: Container.config.defaultDateFormat,
				getBranchAndTagTips: this.getBranchAndTagTips,
			},
		);

		if (!this.commit.isUncommitted) {
			item.tooltip += this.commit.getFormattedDiffStatus({
				expand: true,
				prefix: '\n\n',
				separator: '\n',
			});
		}

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
