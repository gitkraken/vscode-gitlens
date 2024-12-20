import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import type { Colors } from '../../constants.colors';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitRebaseStatus } from '../../git/models/rebase';
import { getReferenceLabel } from '../../git/models/reference.utils';
import type { GitStatus } from '../../git/models/status';
import { pluralize } from '../../system/string';
import { executeCoreCommand } from '../../system/vscode/command';
import type { ViewsWithCommits } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode';
import { MergeConflictFilesNode } from './mergeConflictFilesNode';
import { RebaseCommitNode } from './rebaseCommitNode';

export class RebaseStatusNode extends ViewNode<'rebase-status', ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly rebaseStatus: GitRebaseStatus,
		public readonly status: GitStatus | undefined,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
	) {
		super('rebase-status', GitUri.fromRepoPath(rebaseStatus.repoPath), view, parent);

		this.updateContext({ branch: branch, root: root, status: 'rebasing' });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	async getChildren(): Promise<ViewNode[]> {
		const children: (MergeConflictFilesNode | RebaseCommitNode)[] = [];

		const revision = this.rebaseStatus.steps.current.commit;
		if (revision != null) {
			const commit =
				revision != null
					? await this.view.container.git.getCommit(this.rebaseStatus.repoPath, revision.ref)
					: undefined;
			if (commit != null) {
				children.push(new RebaseCommitNode(this.view, this, commit));
			}
		}

		if (this.status?.hasConflicts) {
			children.push(new MergeConflictFilesNode(this.view, this, this.rebaseStatus, this.status.conflicts));
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const started = this.rebaseStatus.steps.total > 0;
		const pausedAtCommit = started && this.rebaseStatus.steps.current.commit != null;
		const hasConflicts = this.status?.hasConflicts === true;

		const item = new TreeItem(
			`${hasConflicts ? 'Resolve conflicts to continue rebasing' : started ? 'Rebasing' : 'Pending rebase of'} ${
				this.rebaseStatus.incoming != null
					? getReferenceLabel(this.rebaseStatus.incoming, { expand: false, icon: false })
					: ''
			} onto ${getReferenceLabel(this.rebaseStatus.current ?? this.rebaseStatus.onto, {
				expand: false,
				icon: false,
			})}${started ? ` (${this.rebaseStatus.steps.current.number}/${this.rebaseStatus.steps.total})` : ''}`,
			pausedAtCommit ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Rebase;
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
			`${started ? 'Rebasing' : 'Pending rebase of'} ${
				this.rebaseStatus.incoming != null
					? getReferenceLabel(this.rebaseStatus.incoming, { label: false })
					: ''
			} onto ${getReferenceLabel(this.rebaseStatus.current ?? this.rebaseStatus.onto, { label: false })}${
				started
					? `\n\nPaused at step ${this.rebaseStatus.steps.current.number} of ${
							this.rebaseStatus.steps.total
					  }${
							hasConflicts
								? `\\\nResolve ${pluralize('conflict', this.status.conflicts.length)} before continuing`
								: ''
					  }`
					: ''
			}`,
			true,
		);
		markdown.supportHtml = true;
		markdown.isTrusted = true;
		item.tooltip = markdown;
		item.resourceUri = createViewDecorationUri('status', { status: 'rebasing', conflicts: hasConflicts });

		return item;
	}

	async openEditor() {
		const rebaseTodoUri = Uri.joinPath(this.uri, '.git', 'rebase-merge', 'git-rebase-todo');
		await executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}
}
