import type { CancellationToken, Command, Selection, Uri } from 'vscode';
import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands/diffWith';
import type { DiffWithPreviousCommandArgs } from '../../commands/diffWithPrevious';
import type { Colors } from '../../constants.colors';
import type { Container } from '../../container';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter';
import type { DiffRange } from '../../git/gitProvider';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import type { GitRevisionReference } from '../../git/models/reference';
import { getGitFileStatusIcon } from '../../git/utils/fileStatus.utils';
import { createCommand } from '../../system/-webview/command';
import { configuration } from '../../system/-webview/configuration';
import { editorLineToDiffRange, selectionToDiffRange } from '../../system/-webview/vscode/editors';
import { joinPaths } from '../../system/path';
import { getSettledValue, pauseOnCancelOrTimeoutMapTuplePromise } from '../../system/promise';
import type { FileHistoryView } from '../fileHistoryView';
import type { LineHistoryView } from '../lineHistoryView';
import type { ViewsWithCommits } from '../viewBase';
import { createViewDecorationUri } from '../viewDecorationProvider';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import { ViewRefFileNode } from './abstract/viewRefNode';
import { MergeConflictCurrentChangesNode } from './mergeConflictCurrentChangesNode';
import { MergeConflictIncomingChangesNode } from './mergeConflictIncomingChangesNode';

export class FileRevisionAsCommitNode extends ViewRefFileNode<
	'file-commit',
	ViewsWithCommits | FileHistoryView | LineHistoryView
> {
	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
		parent: ViewNode,
		file: GitFile,
		public commit: GitCommit,
		private readonly _options: {
			branch?: GitBranch;
			getBranchAndTagTips?: (sha: string, options?: { compact?: boolean }) => string | undefined;
			selection?: Selection;
			unpublished?: boolean;
		} = {},
	) {
		super('file-commit', GitUri.fromFile(file, commit.repoPath, commit.sha), view, parent, file);
	}

	override toClipboard(): string {
		return `${this.commit.shortSha}: ${this.commit.summary}`;
	}

	get isTip(): boolean {
		return (this._options.branch?.current && this._options.branch.sha === this.commit.ref) ?? false;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (!this.commit.file?.hasConflicts) return [];

		const pausedOpStatus = await this.view.container.git
			.getRepositoryService(this.commit.repoPath)
			.pausedOps?.getPausedOperationStatus?.();
		if (pausedOpStatus == null) return [];

		return [
			new MergeConflictCurrentChangesNode(this.view, this, pausedOpStatus, this.file),
			new MergeConflictIncomingChangesNode(this.view, this, pausedOpStatus, this.file),
		];
	}

	async getTreeItem(): Promise<TreeItem> {
		if (this.commit.file == null) {
			// Try to get the commit directly from the multi-file commit
			const commit = await this.commit.getCommitForFile(this.file);
			if (commit == null) {
				const log = await this.view.container.git
					.getRepositoryService(this.repoPath)
					.commits.getLogForPath(this.file.path, this.commit.sha, { isFolder: false, limit: 1 });
				if (log != null) {
					this.commit = log.commits.get(this.commit.sha) ?? this.commit;
				}
			} else {
				this.commit = commit;
			}
		}

		const item = new TreeItem(
			CommitFormatter.fromTemplate(this.view.config.formats.commits.label, this.commit, {
				dateFormat: configuration.get('defaultDateFormat'),
				getBranchAndTagTips: (sha: string) => this._options.getBranchAndTagTips?.(sha, { compact: true }),
				messageTruncateAtNewLine: true,
			}),
			this.commit.file?.hasConflicts ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None,
		);

		item.contextValue = this.contextValue;

		item.description = CommitFormatter.fromTemplate(this.view.config.formats.commits.description, this.commit, {
			dateFormat: configuration.get('defaultDateFormat'),
			getBranchAndTagTips: (sha: string) => this._options.getBranchAndTagTips?.(sha, { compact: true }),
			messageTruncateAtNewLine: true,
		});

		item.resourceUri = createViewDecorationUri('commit-file', { status: this.file.status });

		if (!this.commit.isUncommitted && this.view.config.avatars) {
			item.iconPath = this._options.unpublished
				? new ThemeIcon('arrow-up', new ThemeColor('gitlens.unpublishedCommitIconColor' satisfies Colors))
				: await this.commit.getAvatarUri({ defaultStyle: configuration.get('defaultGravatarsStyle') });
		}

		if (item.iconPath == null) {
			const icon = getGitFileStatusIcon(this.file.status);
			item.iconPath = {
				dark: this.view.container.context.asAbsolutePath(joinPaths('images', 'dark', icon)),
				light: this.view.container.context.asAbsolutePath(joinPaths('images', 'light', icon)),
			};
		}

		item.command = this.getCommand();

		return item;
	}

	protected get contextValue(): string {
		if (!this.commit.isUncommitted) {
			return `${ContextValues.File}+committed${this._options.branch?.current ? '+current' : ''}${
				this.isTip ? '+HEAD' : ''
			}${this._options.unpublished ? '+unpublished' : ''}`;
		}

		return this.commit.file?.hasConflicts
			? `${ContextValues.File}+conflicted`
			: this.commit.isUncommittedStaged
				? `${ContextValues.File}+staged`
				: `${ContextValues.File}+unstaged`;
	}

	override getCommand(): Command | undefined {
		let range: DiffRange;
		if (this.commit.lines.length) {
			// TODO@eamodio should the endLine be the last line of the commit?
			range = { startLine: this.commit.lines[0].line, endLine: this.commit.lines[0].line };
		} else {
			range = this.commit.file?.range ?? selectionToDiffRange(this._options?.selection);
		}

		if (this.commit.file?.hasConflicts) {
			return createCommand<[DiffWithCommandArgs]>('gitlens.diffWith', 'Open Changes', {
				lhs: {
					sha: 'MERGE_HEAD',
					uri: GitUri.fromFile(this.file, this.repoPath, undefined, true),
				},
				rhs: {
					sha: 'HEAD',
					uri: GitUri.fromFile(this.file, this.repoPath),
				},
				repoPath: this.repoPath,
				range: editorLineToDiffRange(0),
				showOptions: { preserveFocus: false, preview: false },
			});
		}

		return createCommand<[undefined, DiffWithPreviousCommandArgs]>(
			'gitlens.diffWithPrevious:views',
			'Open Changes with Previous Revision',
			undefined,
			{
				commit: this.commit,
				uri: GitUri.fromFile(this.file, this.commit.repoPath),
				range: range,
				showOptions: { preserveFocus: true, preview: true },
			},
		);
	}

	override async resolveTreeItem(item: TreeItem, token: CancellationToken): Promise<TreeItem> {
		item.tooltip ??= await this.getTooltip(token);
		return item;
	}

	async getConflictBaseUri(): Promise<Uri | undefined> {
		if (!this.commit.file?.hasConflicts) return undefined;

		const mergeBase = await this.view.container.git
			.getRepositoryService(this.repoPath)
			.refs.getMergeBase('MERGE_HEAD', 'HEAD');
		return GitUri.fromFile(this.file, this.repoPath, mergeBase ?? 'HEAD');
	}

	private async getTooltip(cancellation: CancellationToken) {
		const tooltip = await getFileRevisionAsCommitTooltip(
			this.view.container,
			this.commit,
			this.file,
			this.view.config.formats.commits.tooltipWithStatus,
			{
				getBranchAndTagTips: this._options.getBranchAndTagTips,
				unpublished: this._options.unpublished,
				cancellation: cancellation,
			},
		);

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;
		return markdown;
	}
}

export async function getFileRevisionAsCommitTooltip(
	container: Container,
	commit: GitCommit,
	file: GitFile,
	tooltipWithStatusFormat: string,
	options?: {
		cancellation?: CancellationToken;
		getBranchAndTagTips?: (sha: string, options?: { compact?: boolean }) => string | undefined;
		unpublished?: boolean;
	},
): Promise<string | undefined> {
	const [remotesResult, _] = await Promise.allSettled([
		container.git.getRepositoryService(commit.repoPath).remotes.getBestRemotesWithProviders(options?.cancellation),
		commit.message == null ? commit.ensureFullDetails() : undefined,
	]);

	if (options?.cancellation?.isCancellationRequested) return undefined;

	const remotes = getSettledValue(remotesResult, []);
	const [remote] = remotes;

	let enrichedAutolinks;
	let pr;

	if (remote?.supportsIntegration()) {
		const [enrichedAutolinksResult, prResult] = await Promise.allSettled([
			pauseOnCancelOrTimeoutMapTuplePromise(commit.getEnrichedAutolinks(remote), options?.cancellation),
			commit.getAssociatedPullRequest(remote),
		]);

		const enrichedAutolinksMaybeResult = getSettledValue(enrichedAutolinksResult);
		if (!enrichedAutolinksMaybeResult?.paused) {
			enrichedAutolinks = enrichedAutolinksMaybeResult?.value;
		}
		pr = getSettledValue(prResult);
	}

	const status = StatusFileFormatter.fromTemplate(
		`\${status}\${ (originalPath)}\${'&nbsp;&nbsp;•&nbsp;&nbsp;'changesDetail}`,
		file,
		{
			outputFormat: 'markdown',
		},
	);
	return CommitFormatter.fromTemplateAsync(
		tooltipWithStatusFormat.replace('{{slot-status}}', status),
		commit,
		{ source: 'view:hover' },
		{
			enrichedAutolinks: enrichedAutolinks,
			dateFormat: configuration.get('defaultDateFormat'),
			getBranchAndTagTips: options?.getBranchAndTagTips,
			messageAutolinks: true,
			messageIndent: 4,
			pullRequest: pr,
			outputFormat: 'markdown',
			remotes: remotes,
			unpublished: options?.unpublished,
		},
	);
}
