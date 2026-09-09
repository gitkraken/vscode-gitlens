import type { CancellationToken, Command } from 'vscode';
import { l10n, MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import { getConflictCurrentRef, getConflictIncomingRef } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { getReferenceLabel } from '@gitlens/git/utils/reference.utils.js';
import { createRevisionRange, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { DiffWithCommandArgs } from '../../commands/diffWith.js';
import { GlyphChars } from '../../constants.js';
import { GitUri } from '../../git/gitUri.js';
import { createCommand, createCoreCommand } from '../../system/-webview/command.js';
import type { FileHistoryView } from '../fileHistoryView.js';
import type { LineHistoryView } from '../lineHistoryView.js';
import type { ViewsWithCommits } from '../viewBase.js';
import { ContextValues, ViewNode } from './abstract/viewNode.js';
import { FileRevisionAsCommitNode } from './fileRevisionAsCommitNode.js';

export class MergeConflictChangesNode extends ViewNode<
	'conflict-current-changes' | 'conflict-incoming-changes',
	ViewsWithCommits | FileHistoryView | LineHistoryView
> {
	private readonly _ref: string | undefined;
	private readonly _displayRef: GitReference | undefined;

	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
		protected override readonly parent: ViewNode,
		private readonly status: GitPausedOperationStatus,
		private readonly file: GitFile,
		private readonly side: 'current' | 'incoming',
		private readonly mergeBasePath?: string,
		readonly workingFilePath?: string,
	) {
		const ref = side === 'current' ? 'HEAD' : getConflictIncomingRef(status);
		super(
			side === 'current' ? 'conflict-current-changes' : 'conflict-incoming-changes',
			GitUri.fromFile(file, status.repoPath, ref),
			view,
			parent,
		);
		this._ref = ref;
		this._displayRef = side === 'current' ? getConflictCurrentRef(status) : status.incoming;
	}

	private _log: Promise<GitLog | undefined> | undefined;
	private getLog(): Promise<GitLog | undefined> {
		if (this._log == null) {
			if (this.status.mergeBase == null || this._ref == null) return Promise.resolve(undefined);

			const svc = this.view.container.git.getRepositoryService(this.status.repoPath);
			const range = createRevisionRange(this.status.mergeBase, this._ref, '..');
			this._log = svc.commits.getLogForPath(this.file.path, range, { isFolder: false, renames: true });
		}
		return this._log;
	}

	async getChildren(): Promise<ViewNode[]> {
		const log = await this.getLog();
		if (!log?.count) return [];

		return Array.from(
			log.commits.values(),
			c => new FileRevisionAsCommitNode(this.view, this, c.file ?? this.file, c),
		);
	}

	getTreeItem(): TreeItem {
		const label = this.side === 'current' ? l10n.t('Current changes') : l10n.t('Incoming changes');
		const contextValue =
			this.side === 'current'
				? ContextValues.MergeConflictCurrentChanges
				: ContextValues.MergeConflictIncomingChanges;

		const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
		item.contextValue = contextValue;
		item.description = getReferenceLabel(this._displayRef, { expand: false, icon: false });
		item.iconPath = new ThemeIcon('diff');
		item.command = this.getCommand();

		return item;
	}

	override getCommand(): Command | undefined {
		if (this._ref == null) return undefined;

		const lhsPath = this.mergeBasePath ?? this.file.path;

		if (this.status.mergeBase == null) {
			return createCoreCommand(
				'vscode.open',
				l10n.t('Open Revision'),
				this.view.container.git
					.getRepositoryService(this.status.repoPath)
					.getRevisionUri(this._ref, this.file.path),
			);
		}

		return createCommand<[DiffWithCommandArgs]>('gitlens.diffWith', l10n.t('Open Changes'), {
			lhs: {
				sha: this.status.mergeBase,
				uri: GitUri.fromFile(lhsPath, this.status.repoPath, this.status.mergeBase),
				title: `${lhsPath} (merge-base)`,
			},
			rhs: {
				sha: this._ref,
				uri: GitUri.fromFile(this.file.path, this.status.repoPath, this._ref),
				title: `${this.file.path} (${
					this._displayRef != null
						? getReferenceLabel(this._displayRef, { expand: false, icon: false })
						: this.side
				})`,
			},
			repoPath: this.status.repoPath,
			range: null,
			showOptions: { preserveFocus: true, preview: true },
		});
	}

	override async resolveTreeItem(item: TreeItem, token: CancellationToken): Promise<TreeItem> {
		const log = await this.getLog();
		if (token.isCancellationRequested) return item;

		item.tooltip ??= this.getTooltip(log);
		return item;
	}

	private getTooltip(log: GitLog | undefined): MarkdownString {
		const lhsPath = this.mergeBasePath;
		const renamed = lhsPath != null && lhsPath !== this.file.path;

		const filePath = renamed ? `${lhsPath} ${GlyphChars.ArrowRight} ${this.file.path}` : this.file.path;
		const count = log?.count ?? 0;
		const mergeBaseSha = this.status.mergeBase;

		const prefix =
			this.side === 'current'
				? l10n.t('Current changes on {0}', getReferenceLabel(this._displayRef, { label: false }))
				: l10n.t('Incoming changes from {0}', getReferenceLabel(this._displayRef, { label: false }));
		const markdown = new MarkdownString(`${prefix}\\\n$(file)${GlyphChars.Space}${filePath}`, true);

		if (mergeBaseSha != null && this._ref != null) {
			const commits = formatPlural(l10n.t('{0, plural, one{{0} commit} other{{0} commits}}'), [count]);
			markdown.appendMarkdown(
				l10n.t(
					'\n\n$(git-commit) {0} (merge-base)  ..  {1}  •  {2}',
					shortenRevision(mergeBaseSha),
					getReferenceLabel(this._displayRef, { label: false }),
					commits,
				),
			);
		}

		return markdown;
	}
}
