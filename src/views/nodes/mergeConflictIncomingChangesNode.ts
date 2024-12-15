import type { CancellationToken, Command } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands/diffWith';
import { GlyphChars } from '../../constants';
import { GlCommand } from '../../constants.commands';
import { GitUri } from '../../git/gitUri';
import type { GitCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import type { GitMergeStatus } from '../../git/models/merge';
import type { GitRebaseStatus } from '../../git/models/rebase';
import { getReferenceLabel } from '../../git/models/reference.utils';
import { createCommand, createCoreCommand } from '../../system/vscode/command';
import { configuration } from '../../system/vscode/configuration';
import type { FileHistoryView } from '../fileHistoryView';
import type { LineHistoryView } from '../lineHistoryView';
import type { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode } from './abstract/viewNode';
import { getFileRevisionAsCommitTooltip } from './fileRevisionAsCommitNode';

export class MergeConflictIncomingChangesNode extends ViewNode<
	'conflict-incoming-changes',
	ViewsWithCommits | FileHistoryView | LineHistoryView
> {
	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
		protected override readonly parent: ViewNode,
		private readonly status: GitMergeStatus | GitRebaseStatus,
		private readonly file: GitFile,
	) {
		super('conflict-incoming-changes', GitUri.fromFile(file, status.repoPath, status.HEAD.ref), view, parent);
	}

	private _commit: Promise<GitCommit | undefined> | undefined;
	private async getCommit(): Promise<GitCommit | undefined> {
		if (this._commit == null) {
			const ref = this.status.type === 'rebase' ? this.status.steps.current.commit?.ref : this.status.HEAD.ref;
			if (ref == null) return undefined;

			this._commit = this.view.container.git.getCommit(this.status.repoPath, ref);
		}
		return this._commit;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	async getTreeItem(): Promise<TreeItem> {
		const commit = await this.getCommit();

		const item = new TreeItem('Incoming changes', TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.MergeConflictIncomingChanges;
		item.description = `${getReferenceLabel(this.status.incoming, { expand: false, icon: false })}${
			this.status.type === 'rebase'
				? ` (${getReferenceLabel(this.status.steps.current.commit, {
						expand: false,
						icon: false,
				  })})`
				: ` (${getReferenceLabel(this.status.HEAD, { expand: false, icon: false })})`
		}`;
		item.iconPath = this.view.config.avatars
			? (await commit?.getAvatarUri({ defaultStyle: configuration.get('defaultGravatarsStyle') })) ??
			  new ThemeIcon('diff')
			: new ThemeIcon('diff');
		item.command = this.getCommand();

		return item;
	}

	override getCommand(): Command | undefined {
		if (this.status.mergeBase == null) {
			return createCoreCommand(
				'vscode.open',
				'Open Revision',
				this.view.container.git.getRevisionUri(this.status.HEAD.ref, this.file.path, this.status.repoPath),
			);
		}

		return createCommand<[DiffWithCommandArgs]>(GlCommand.DiffWith, 'Open Changes', {
			lhs: {
				sha: this.status.mergeBase,
				uri: GitUri.fromFile(this.file, this.status.repoPath, undefined, true),
				title: `${this.file.path} (merge-base)`,
			},
			rhs: {
				sha: this.status.HEAD.ref,
				uri: GitUri.fromFile(this.file, this.status.repoPath),
				title: `${this.file.path} (${
					this.status.incoming != null
						? getReferenceLabel(this.status.incoming, { expand: false, icon: false })
						: 'incoming'
				})`,
			},
			repoPath: this.status.repoPath,
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		});
	}

	override async resolveTreeItem(item: TreeItem, token: CancellationToken): Promise<TreeItem> {
		if (item.tooltip == null) {
			item.tooltip = await this.getTooltip(token);
		}
		return item;
	}

	private async getTooltip(cancellation: CancellationToken) {
		const commit = await this.getCommit();
		if (cancellation.isCancellationRequested) return undefined;

		const markdown = new MarkdownString(
			`Incoming changes from ${getReferenceLabel(this.status.incoming, { label: false })}\\\n$(file)${
				GlyphChars.Space
			}${this.file.path}`,
			true,
		);

		if (commit == null) {
			markdown.appendMarkdown(
				this.status.type === 'rebase'
					? `\n\n${getReferenceLabel(this.status.steps.current.commit, {
							capitalize: true,
							label: false,
					  })}`
					: `\n\n${getReferenceLabel(this.status.HEAD, {
							capitalize: true,
							label: false,
					  })}`,
			);
			return markdown;
		}

		const tooltip = await getFileRevisionAsCommitTooltip(
			this.view.container,
			commit,
			this.file,
			this.view.config.formats.commits.tooltipWithStatus,
			{ cancellation: cancellation },
		);

		markdown.appendMarkdown(`\n\n${tooltip}`);
		markdown.isTrusted = true;

		return markdown;
	}
}
