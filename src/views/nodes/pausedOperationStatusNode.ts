import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { Colors } from '../../constants.colors';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus';
import type { GitStatus } from '../../git/models/status';
import { pausedOperationStatusStringsByType } from '../../git/utils/pausedOperationStatus.utils';
import { getReferenceLabel } from '../../git/utils/reference.utils';
import { Lazy } from '../../system/lazy';
import { pluralize } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { MergeConflictFilesNode } from './mergeConflictFilesNode';
import { RebaseCommitNode } from './rebaseCommitNode';

export class PausedOperationStatusNode extends ViewNode<'paused-operation-status', ViewsWithCommits> {
	private _status: GitStatus | undefined;
	private readonly _lazyStatus: Lazy<GitStatus | Promise<GitStatus | undefined> | undefined>;

	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly pausedOpStatus: GitPausedOperationStatus,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
		status?: GitStatus | undefined,
	) {
		super('paused-operation-status', GitUri.fromRepoPath(pausedOpStatus.repoPath), view, parent);

		this.updateContext({ branch: branch, root: root, pausedOperation: pausedOpStatus.type });
		this._uniqueId = getViewNodeId(this.type, this.context);

		this._status = status;
		this._lazyStatus = new Lazy<GitStatus | Promise<GitStatus | undefined> | undefined>(
			() =>
				status ??
				this.view.container.git
					.getRepositoryService(this.repoPath)
					.status.getStatus()
					.then(s => (this._status = s)),
		);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	async getChildren(): Promise<ViewNode[]> {
		const status = await this._lazyStatus.value;

		if (this.pausedOpStatus.type !== 'rebase') {
			return status?.hasConflicts
				? [new MergeConflictFilesNode(this.view, this, this.pausedOpStatus, status.conflicts)]
				: [];
		}

		const children: (MergeConflictFilesNode | RebaseCommitNode)[] = [];

		const revision = this.pausedOpStatus.steps.current.commit;
		if (revision != null) {
			const commit =
				revision != null
					? await this.view.container.git
							.getRepositoryService(this.pausedOpStatus.repoPath)
							.commits.getCommit(revision.ref)
					: undefined;
			if (commit != null) {
				children.push(new RebaseCommitNode(this.view, this, commit));
			}
		}

		if (status?.hasConflicts) {
			children.push(new MergeConflictFilesNode(this.view, this, this.pausedOpStatus, status.conflicts));
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const status = await this._lazyStatus.value;

		const hasConflicts = status?.hasConflicts === true;
		const hasChildren =
			status?.hasConflicts || (this.pausedOpStatus.type === 'rebase' && this.pausedOpStatus.hasStarted);

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

		item.description = hasConflicts ? pluralize('conflict', status.conflicts.length) : undefined;

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
		const hasConflicts = this._status?.hasConflicts === true;

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

		const { hasStarted } = this.pausedOpStatus;
		const strings = pausedOperationStatusStringsByType[this.pausedOpStatus.type];
		return `${hasConflicts ? strings.conflicts : hasStarted ? strings.label : strings.pending} ${getReferenceLabel(
			this.pausedOpStatus.incoming,
			{ expand: false, icon: false },
		)} ${strings.directionality} ${getReferenceLabel(this.pausedOpStatus.current ?? this.pausedOpStatus.onto, {
			expand: false,
			icon: false,
		})}${hasStarted ? ` (${this.pausedOpStatus.steps.current.number}/${this.pausedOpStatus.steps.total})` : ''}`;
	}

	private get tooltip(): MarkdownString {
		const status = this._status;
		const hasConflicts = status?.hasConflicts === true;

		let tooltip;
		if (this.pausedOpStatus.type !== 'rebase') {
			const strings = pausedOperationStatusStringsByType[this.pausedOpStatus.type];
			tooltip = `${strings.label} ${getReferenceLabel(this.pausedOpStatus.incoming, { label: false })} ${
				strings.directionality
			} ${getReferenceLabel(this.pausedOpStatus.current, { label: false })}${
				hasConflicts ? `\n\nResolve ${pluralize('conflict', status.conflicts.length)} before continuing` : ''
			}`;
		} else {
			const { hasStarted } = this.pausedOpStatus;
			const strings = pausedOperationStatusStringsByType[this.pausedOpStatus.type];
			tooltip = `${hasStarted ? strings.label : strings.pending} ${getReferenceLabel(
				this.pausedOpStatus.incoming,
				{
					label: false,
				},
			)} ${strings.directionality} ${getReferenceLabel(this.pausedOpStatus.current ?? this.pausedOpStatus.onto, {
				label: false,
			})}${
				hasStarted
					? `\n\nPaused at step ${this.pausedOpStatus.steps.current.number} of ${
							this.pausedOpStatus.steps.total
						}${
							hasConflicts
								? `\\\nResolve ${pluralize('conflict', status.conflicts.length)} before continuing`
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
