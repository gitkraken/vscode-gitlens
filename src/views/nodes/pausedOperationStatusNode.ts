import { l10n, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import { getReferenceLabel } from '@gitlens/git/utils/reference.utils.js';
import { Lazy } from '@gitlens/utils/lazy.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { Colors } from '../../constants.colors.js';
import { GitUri } from '../../git/gitUri.js';
import type { ViewsWithCommits } from '../viewBase.js';
import { createViewDecorationUri } from '../viewDecorationProvider.js';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode.js';
import { MergeConflictFilesNode } from './mergeConflictFilesNode.js';
import { RebaseCommitNode } from './rebaseCommitNode.js';

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
			const commit = await this.view.container.git
				.getRepositoryService(this.pausedOpStatus.repoPath)
				.commits.getCommit(revision.ref);
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

		if (hasConflicts) {
			item.description = formatPlural(l10n.t('{0, plural, one{{0} conflict} other{{0} conflicts}}'), [
				status.conflicts.length,
			]);
		}

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
		const incoming = getReferenceLabel(this.pausedOpStatus.incoming, {
			expand: false,
			icon: false,
		});

		if (this.pausedOpStatus.type === 'rebase') {
			const target = getReferenceLabel(this.pausedOpStatus.current ?? this.pausedOpStatus.onto, {
				expand: false,
				icon: false,
			});
			if (!this.pausedOpStatus.hasStarted) {
				return hasConflicts
					? l10n.t('Resolve conflicts to continue rebasing {incoming} onto {target}', {
							incoming: incoming,
							target: target,
						})
					: l10n.t('Pending rebase of {incoming} onto {target}', {
							incoming: incoming,
							target: target,
						});
			}

			const args = {
				incoming: incoming,
				target: target,
				current: this.pausedOpStatus.steps.current.number,
				total: this.pausedOpStatus.steps.total,
			};
			return hasConflicts
				? l10n.t('Resolve conflicts to continue rebasing {incoming} onto {target} ({current}/{total})', args)
				: l10n.t('Rebasing {incoming} onto {target} ({current}/{total})', args);
		}

		const current = getReferenceLabel(this.pausedOpStatus.current, {
			expand: false,
			icon: false,
		});
		switch (this.pausedOpStatus.type) {
			case 'cherry-pick':
				return hasConflicts
					? l10n.t('Resolve conflicts to continue cherry picking {incoming} into {current}', {
							incoming: incoming,
							current: current,
						})
					: l10n.t('Cherry picking {incoming} into {current}', {
							incoming: incoming,
							current: current,
						});
			case 'merge':
				return hasConflicts
					? l10n.t('Resolve conflicts to continue merging {incoming} into {current}', {
							incoming: incoming,
							current: current,
						})
					: l10n.t('Merging {incoming} into {current}', { incoming: incoming, current: current });
			case 'revert':
				return hasConflicts
					? l10n.t('Resolve conflicts to continue reverting {incoming} in {current}', {
							incoming: incoming,
							current: current,
						})
					: l10n.t('Reverting {incoming} in {current}', { incoming: incoming, current: current });
		}
	}

	private get tooltip(): MarkdownString {
		const status = this._status;
		const hasConflicts = status?.hasConflicts === true;
		let tooltip = this.getTooltipSummary();

		if (this.pausedOpStatus.type === 'rebase' && this.pausedOpStatus.hasStarted) {
			tooltip += `\n\n${l10n.t('Paused at step {current} of {total}', {
				current: this.pausedOpStatus.steps.current.number,
				total: this.pausedOpStatus.steps.total,
			})}`;
			if (hasConflicts) {
				tooltip += `\\\n${this.getResolveConflictsTooltip(status.conflicts.length)}`;
			}
		} else if (this.pausedOpStatus.type !== 'rebase' && hasConflicts) {
			tooltip += `\n\n${this.getResolveConflictsTooltip(status.conflicts.length)}`;
		}

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;
		return markdown;
	}

	private getTooltipSummary(): string {
		const incoming = getReferenceLabel(this.pausedOpStatus.incoming, { label: false });
		if (this.pausedOpStatus.type === 'rebase') {
			const target = getReferenceLabel(this.pausedOpStatus.current ?? this.pausedOpStatus.onto, {
				label: false,
			});
			return this.pausedOpStatus.hasStarted
				? l10n.t('Rebasing {incoming} onto {target}', { incoming: incoming, target: target })
				: l10n.t('Pending rebase of {incoming} onto {target}', { incoming: incoming, target: target });
		}

		const current = getReferenceLabel(this.pausedOpStatus.current, { label: false });
		switch (this.pausedOpStatus.type) {
			case 'cherry-pick':
				return l10n.t('Cherry picking {incoming} into {current}', {
					incoming: incoming,
					current: current,
				});
			case 'merge':
				return l10n.t('Merging {incoming} into {current}', { incoming: incoming, current: current });
			case 'revert':
				return l10n.t('Reverting {incoming} in {current}', { incoming: incoming, current: current });
		}
	}

	private getResolveConflictsTooltip(count: number): string {
		return formatPlural(
			l10n.t(
				'{0, plural, one{Resolve {0} conflict before continuing} other{Resolve {0} conflicts before continuing}}',
			),
			[count],
		);
	}
}
