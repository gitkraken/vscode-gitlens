'use strict';
import * as paths from 'path';
import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { BranchNode } from './branchNode';
import { ViewFilesLayout } from '../../configuration';
import { FileNode, FolderNode } from './folderNode';
import { GitBranch, GitMergeStatus, GitReference, GitStatus } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { MergeConflictFileNode } from './mergeConflictFileNode';
import { Arrays, Strings } from '../../system';
import { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode } from './viewNode';

export class MergeStatusNode extends ViewNode<ViewsWithCommits> {
	static key = ':merge';
	static getId(repoPath: string, name: string, root: boolean): string {
		return `${BranchNode.getId(repoPath, name, root)}${this.key}`;
	}

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly mergeStatus: GitMergeStatus,
		public readonly status: GitStatus | undefined,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
	) {
		super(GitUri.fromRepoPath(mergeStatus.repoPath), view, parent);
	}

	get id(): string {
		return MergeStatusNode.getId(this.mergeStatus.repoPath, this.mergeStatus.current.name, this.root);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	getChildren(): ViewNode[] {
		if (this.status?.hasConflicts !== true) return [];

		let children: FileNode[] = this.status.conflicts.map(
			f => new MergeConflictFileNode(this.view, this, this.mergeStatus, f),
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
		const item = new TreeItem(
			`${this.status?.hasConflicts ? 'Resolve conflicts before merging' : 'Merging'} ${
				this.mergeStatus.incoming != null
					? `${GitReference.toString(this.mergeStatus.incoming, { expand: false, icon: false })} `
					: ''
			}into ${GitReference.toString(this.mergeStatus.current, { expand: false, icon: false })}`,
			TreeItemCollapsibleState.Expanded,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Merge;
		item.description = this.status?.hasConflicts
			? Strings.pluralize('conflict', this.status.conflicts.length)
			: undefined;
		item.iconPath = this.status?.hasConflicts
			? new ThemeIcon('warning', new ThemeColor('list.warningForeground'))
			: new ThemeIcon('debug-pause', new ThemeColor('list.foreground'));
		item.tooltip = new MarkdownString(
			`${`Merging ${
				this.mergeStatus.incoming != null ? GitReference.toString(this.mergeStatus.incoming) : ''
			}into ${GitReference.toString(this.mergeStatus.current)}`}${
				this.status?.hasConflicts
					? `\n\n${Strings.pluralize('conflicted file', this.status.conflicts.length)}`
					: ''
			}`,
			true,
		);

		return item;
	}
}
