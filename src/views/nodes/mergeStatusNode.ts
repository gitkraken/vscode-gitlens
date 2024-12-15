import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { Colors } from '../../constants.colors';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitMergeStatus } from '../../git/models/merge';
import { getReferenceLabel } from '../../git/models/reference.utils';
import type { GitStatus } from '../../git/models/status';
import { pluralize } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { MergeConflictFilesNode } from './mergeConflictFilesNode';

export class MergeStatusNode extends ViewNode<'merge-status', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly mergeStatus: GitMergeStatus,
		public readonly status: GitStatus | undefined,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
	) {
		super('merge-status', GitUri.fromRepoPath(mergeStatus.repoPath), view, parent);

		this.updateContext({ branch: branch, root: root, status: 'merging' });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	getChildren(): ViewNode[] {
		return this.status?.hasConflicts
			? [new MergeConflictFilesNode(this.view, this, this.mergeStatus, this.status.conflicts)]
			: [];
	}

	getTreeItem(): TreeItem {
		const hasConflicts = this.status?.hasConflicts === true;
		const item = new TreeItem(
			`${hasConflicts ? 'Resolve conflicts before merging' : 'Merging'} ${
				this.mergeStatus.incoming != null
					? `${getReferenceLabel(this.mergeStatus.incoming, { expand: false, icon: false })} `
					: ''
			}into ${getReferenceLabel(this.mergeStatus.current, { expand: false, icon: false })}`,
			hasConflicts ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Merge;
		item.description = hasConflicts ? pluralize('conflict', this.status.conflicts.length) : undefined;
		item.iconPath = hasConflicts
			? new ThemeIcon(
					'warning',
					new ThemeColor(
						'gitlens.decorations.statusMergingOrRebasingConflictForegroundColor' satisfies Colors,
					),
			  )
			: new ThemeIcon(
					'warning',
					new ThemeColor('gitlens.decorations.statusMergingOrRebasingForegroundColor' satisfies Colors),
			  );

		const markdown = new MarkdownString(
			`Merging ${
				this.mergeStatus.incoming != null ? getReferenceLabel(this.mergeStatus.incoming, { label: false }) : ''
			}into ${getReferenceLabel(this.mergeStatus.current, { label: false })}${
				hasConflicts
					? `\n\nResolve ${pluralize('conflict', this.status.conflicts.length)} before continuing`
					: ''
			}`,
			true,
		);
		markdown.supportHtml = true;
		markdown.isTrusted = true;
		item.tooltip = markdown;
		item.resourceUri = createViewDecorationUri('status', { status: 'merging', conflicts: hasConflicts });

		return item;
	}
}
