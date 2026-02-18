import type { CancellationToken, Command } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands/diffWith.js';
import { GlyphChars } from '../../constants.js';
import { GitUri } from '../../git/gitUri.js';
import type { GitCommit } from '../../git/models/commit.js';
import type { GitFile } from '../../git/models/file.js';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus.js';
import { getConflictIncomingRef } from '../../git/utils/pausedOperationStatus.utils.js';
import { getReferenceLabel } from '../../git/utils/reference.utils.js';
import { createCommand, createCoreCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { editorLineToDiffRange } from '../../system/-webview/vscode/editors.js';
import type { FileHistoryView } from '../fileHistoryView.js';
import type { LineHistoryView } from '../lineHistoryView.js';
import type { ViewsWithCommits } from '../viewBase.js';
import { ContextValues, ViewNode } from './abstract/viewNode.js';
import { getFileRevisionAsCommitTooltip } from './fileRevisionAsCommitNode.js';

export class MergeConflictIncomingChangesNode extends ViewNode<
	'conflict-incoming-changes',
	ViewsWithCommits | FileHistoryView | LineHistoryView
> {
	private _incomingRef: string | undefined;

	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
		protected override readonly parent: ViewNode,
		private readonly status: GitPausedOperationStatus,
		private readonly file: GitFile,
	) {
		const incomingRef = getConflictIncomingRef(status);
		super('conflict-incoming-changes', GitUri.fromFile(file, status.repoPath, incomingRef), view, parent);

		this._incomingRef = incomingRef;
	}

	private _commit: Promise<GitCommit | undefined> | undefined;
	private async getCommit(): Promise<GitCommit | undefined> {
		if (this._commit == null) {
			const ref = this._incomingRef;
			if (ref == null) return undefined;

			this._commit = this.view.container.git.getRepositoryService(this.status.repoPath).commits.getCommit(ref);
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
		item.description = getReferenceLabel(this.status.incoming, { expand: false, icon: false });
		// Show the specific commit SHA in parens when it adds info beyond the incoming label
		if (this.status.type === 'rebase') {
			item.description += ` (${getReferenceLabel(this.status.steps.current.commit, {
				expand: false,
				icon: false,
			})})`;
		} else if (this.status.incoming.refType === 'branch') {
			item.description += ` (${getReferenceLabel(this.status.HEAD, { expand: false, icon: false })})`;
		}
		item.iconPath = this.view.config.avatars
			? ((await commit?.getAvatarUri({ defaultStyle: configuration.get('defaultGravatarsStyle') })) ??
				new ThemeIcon('diff'))
			: new ThemeIcon('diff');
		item.command = this.getCommand();

		return item;
	}

	override getCommand(): Command | undefined {
		const ref = this._incomingRef;
		if (ref == null) return undefined;

		if (this.status.mergeBase == null) {
			return createCoreCommand(
				'vscode.open',
				'Open Revision',
				this.view.container.git.getRepositoryService(this.status.repoPath).getRevisionUri(ref, this.file.path),
			);
		}

		return createCommand<[DiffWithCommandArgs]>('gitlens.diffWith', 'Open Changes', {
			lhs: {
				sha: this.status.mergeBase,
				uri: GitUri.fromFile(this.file, this.status.repoPath, undefined, true),
				title: `${this.file.path} (merge-base)`,
			},
			rhs: {
				sha: ref,
				uri: GitUri.fromFile(this.file, this.status.repoPath),
				title: `${this.file.path} (${
					this.status.incoming != null
						? getReferenceLabel(this.status.incoming, { expand: false, icon: false })
						: 'incoming'
				})`,
			},
			repoPath: this.status.repoPath,
			range: editorLineToDiffRange(0),
			showOptions: { preserveFocus: true, preview: true },
		});
	}

	override async resolveTreeItem(item: TreeItem, token: CancellationToken): Promise<TreeItem> {
		item.tooltip ??= await this.getTooltip(token);
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
