import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { CoreColors } from '../../constants';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitMergeStatus } from '../../git/models/merge';
import { getReferenceLabel } from '../../git/models/reference';
import type { GitStatus } from '../../git/models/status';
import { makeHierarchical } from '../../system/array';
import { joinPaths, normalizePath } from '../../system/path';
import { pluralize, sortCompare } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { MergeConflictFileNode } from './mergeConflictFileNode';
import { ContextValues, getViewNodeId, ViewNode } from './viewNode';

export class MergeStatusNode extends ViewNode<ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly mergeStatus: GitMergeStatus,
		public readonly status: GitStatus | undefined,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
	) {
		super(GitUri.fromRepoPath(mergeStatus.repoPath), view, parent);

		this.updateContext({ branch: branch, root: root });
		this._uniqueId = getViewNodeId('merge-status', this.context);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	getChildren(): ViewNode[] {
		if (this.status?.hasConflicts !== true) return [];

		let children: FileNode[] = this.status.conflicts.map(
			f => new MergeConflictFileNode(this.view, this, f, this.mergeStatus),
		);

		if (this.view.config.files.layout !== 'list') {
			const hierarchy = makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, hierarchy, this.repoPath, '', undefined);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) => sortCompare(a.label!, b.label!));
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			`${this.status?.hasConflicts ? 'Resolve conflicts before merging' : 'Merging'} ${
				this.mergeStatus.incoming != null
					? `${getReferenceLabel(this.mergeStatus.incoming, { expand: false, icon: false })} `
					: ''
			}into ${getReferenceLabel(this.mergeStatus.current, { expand: false, icon: false })}`,
			TreeItemCollapsibleState.Expanded,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Merge;
		item.description = this.status?.hasConflicts ? pluralize('conflict', this.status.conflicts.length) : undefined;
		item.iconPath = this.status?.hasConflicts
			? new ThemeIcon('warning', new ThemeColor('list.warningForeground' satisfies CoreColors))
			: new ThemeIcon('debug-pause', new ThemeColor('list.foreground' satisfies CoreColors));

		const markdown = new MarkdownString(
			`${`Merging ${
				this.mergeStatus.incoming != null ? getReferenceLabel(this.mergeStatus.incoming) : ''
			}into ${getReferenceLabel(this.mergeStatus.current)}`}${
				this.status?.hasConflicts ? `\n\n${pluralize('conflicted file', this.status.conflicts.length)}` : ''
			}`,
			true,
		);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;

		return item;
	}
}
