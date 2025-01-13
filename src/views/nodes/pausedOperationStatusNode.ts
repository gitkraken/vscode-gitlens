import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { Colors } from '../../constants.colors';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus';
import { getReferenceLabel } from '../../git/models/reference.utils';
import type { GitStatus } from '../../git/models/status';
import { pausedOperationStatusStringsByType } from '../../git/utils/pausedOperationStatus.utils';
import { pluralize } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { MergeConflictFilesNode } from './mergeConflictFilesNode';
import { RebaseCommitNode } from './rebaseCommitNode';

export class PausedOperationStatusNode extends ViewNode<'paused-operation-status', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly pausedOpStatus: GitPausedOperationStatus,
		public readonly status: GitStatus | undefined,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
	) {
		super('paused-operation-status', GitUri.fromRepoPath(pausedOpStatus.repoPath), view, parent);

		this.updateContext({ branch: branch, root: root, pausedOperation: pausedOpStatus.type });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.pausedOpStatus.type !== 'rebase') {
			return this.status?.hasConflicts
				? [new MergeConflictFilesNode(this.view, this, this.pausedOpStatus, this.status.conflicts)]
				: [];
		}

		const children: (MergeConflictFilesNode | RebaseCommitNode)[] = [];

		const revision = this.pausedOpStatus.steps.current.commit;
		if (revision != null) {
			const commit =
				revision != null
					? await this.view.container.git.getCommit(this.pausedOpStatus.repoPath, revision.ref)
					: undefined;
			if (commit != null) {
				children.push(new RebaseCommitNode(this.view, this, commit));
			}
		}

		if (this.status?.hasConflicts) {
			children.push(new MergeConflictFilesNode(this.view, this, this.pausedOpStatus, this.status.conflicts));
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const hasConflicts = this.status?.hasConflicts === true;
		const hasChildren =
			this.status?.hasConflicts ||
			(this.pausedOpStatus.type === 'rebase' &&
				this.pausedOpStatus.steps.total > 0 &&
				this.pausedOpStatus.steps.current.commit != null);

		const item = new TreeItem(
			this.label,
			hasChildren ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None,
		);
		item.id = this.id;

		switch (this.pausedOpStatus.type) {
			case 'cherry-pick':
				item.contextValue = ContextValues.PausedOperationCherryPick;
				break;
			case 'merge':
				item.contextValue = ContextValues.PausedOperationMerge;
				break;
			case 'rebase':
				item.contextValue = ContextValues.PausedOperationRebase;
				break;
			case 'revert':
				item.contextValue = ContextValues.PausedOperationRevert;
				break;
		}

		item.description = hasConflicts ? pluralize('conflict', this.status.conflicts.length) : undefined;

		const iconColor: Colors = hasConflicts
			? 'gitlens.decorations.statusMergingOrRebasingConflictForegroundColor'
			: 'gitlens.decorations.statusMergingOrRebasingForegroundColor';
		item.iconPath = new ThemeIcon('warning', new ThemeColor(iconColor));

		item.tooltip = this.tooltip;
		item.resourceUri = createViewDecorationUri('status', {
			status: this.pausedOpStatus.type,
			conflicts: hasConflicts,
		});

		return item;
	}

	private get label(): string {
		const hasConflicts = this.status?.hasConflicts === true;

		if (this.pausedOpStatus.type !== 'rebase') {
			const strings = pausedOperationStatusStringsByType[this.pausedOpStatus.type];
			return `${hasConflicts ? strings.conflicts : strings.label} ${getReferenceLabel(
				this.pausedOpStatus.incoming,
				{
					expand: false,
					icon: false,
				},
			)} ${strings.directionality} ${getReferenceLabel(this.pausedOpStatus.current, {
				expand: false,
				icon: false,
			})}`;
		}

		const started = this.pausedOpStatus.steps.total > 0;
		const strings = pausedOperationStatusStringsByType[this.pausedOpStatus.type];
		return `${hasConflicts ? strings.conflicts : started ? strings.label : strings.pending} ${getReferenceLabel(
			this.pausedOpStatus.incoming,
			{ expand: false, icon: false },
		)} ${strings.directionality} ${getReferenceLabel(this.pausedOpStatus.current ?? this.pausedOpStatus.onto, {
			expand: false,
			icon: false,
		})}${started ? ` (${this.pausedOpStatus.steps.current.number}/${this.pausedOpStatus.steps.total})` : ''}`;
	}

	private get tooltip(): MarkdownString {
		const hasConflicts = this.status?.hasConflicts === true;

		let tooltip;
		if (this.pausedOpStatus.type !== 'rebase') {
			const strings = pausedOperationStatusStringsByType[this.pausedOpStatus.type];
			tooltip = `${strings.label} ${getReferenceLabel(this.pausedOpStatus.incoming, { label: false })} ${
				strings.directionality
			} ${getReferenceLabel(this.pausedOpStatus.current, { label: false })}${
				hasConflicts
					? `\n\nResolve ${pluralize('conflict', this.status.conflicts.length)} before continuing`
					: ''
			}`;
		} else {
			const started = this.pausedOpStatus.steps.total > 0;
			const strings = pausedOperationStatusStringsByType[this.pausedOpStatus.type];
			tooltip = `${started ? strings.label : strings.pending} ${getReferenceLabel(this.pausedOpStatus.incoming, {
				label: false,
			})} ${strings.directionality} ${getReferenceLabel(this.pausedOpStatus.current ?? this.pausedOpStatus.onto, {
				label: false,
			})}${
				started
					? `\n\nPaused at step ${this.pausedOpStatus.steps.current.number} of ${
							this.pausedOpStatus.steps.total
					  }${
							hasConflicts
								? `\\\nResolve ${pluralize('conflict', this.status.conflicts.length)} before continuing`
								: ''
					  }`
					: ''
			}`;
		}

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;
		return markdown;
	}
}
