import type { CancellationToken } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { GitStashCommit } from '@gitlens/git/models/commit.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitStashReference } from '@gitlens/git/models/reference.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import { joinPaths, normalizePath } from '@gitlens/utils/path.js';
import { getSettledValue, pauseOnCancelOrTimeoutMapTuplePromise } from '@gitlens/utils/promise.js';
import { sortCompare } from '@gitlens/utils/string.js';
import { CommitFormatter } from '../../git/formatters/commitFormatter.js';
import {
	getCommitEnrichedAutolinks,
	getCommitGitUri,
	getCommitsForFiles,
} from '../../git/utils/-webview/commit.utils.js';
import { remoteSupportsIntegration } from '../../git/utils/-webview/remote.utils.js';
import { toAbortSignal } from '../../system/-webview/cancellation.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { ViewsWithStashes } from '../viewBase.js';
import type { ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { ViewRefNode } from './abstract/viewRefNode.js';
import type { FileNode } from './folderNode.js';
import { FolderNode } from './folderNode.js';
import { StashFileNode } from './stashFileNode.js';

export class StashNode extends ViewRefNode<'stash', ViewsWithStashes, GitStashReference> {
	constructor(
		view: ViewsWithStashes,
		protected override parent: ViewNode,
		public readonly commit: GitStashCommit,
		private readonly _options?: { allowFilteredFiles?: boolean; icon?: boolean },
	) {
		super('stash', getCommitGitUri(commit), view, parent);

		this.updateContext({ commit: commit });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.commit.stashName;
	}

	get ref(): GitStashReference {
		return this.commit;
	}

	async getChildren(): Promise<ViewNode[]> {
		// Ensure we have checked for untracked files (inside the getCommitsForFiles call)
		const commits = await getCommitsForFiles(this.commit, {
			allowFilteredFiles: this._options?.allowFilteredFiles,
			include: { stats: true },
		});
		let children: FileNode[] = commits.map(c => new StashFileNode(this.view, this, c.file!, c as GitStashCommit));

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
			CommitFormatter.fromTemplate(this.view.config.formats.stashes.label, this.commit, {
				messageTruncateAtNewLine: true,
				dateFormat: configuration.get('defaultDateFormat'),
			}),
			TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.description = CommitFormatter.fromTemplate(this.view.config.formats.stashes.description, this.commit, {
			messageTruncateAtNewLine: true,
			dateFormat: configuration.get('defaultDateFormat'),
		});
		item.contextValue = ContextValues.Stash;
		if (this._options?.icon) {
			item.iconPath = new ThemeIcon('archive');
		}

		return item;
	}

	override async resolveTreeItem(item: TreeItem, token: CancellationToken): Promise<TreeItem> {
		item.tooltip ??= await this.getTooltip(token);
		return item;
	}

	private async getTooltip(cancellation: CancellationToken) {
		const [remotesResult, _] = await Promise.allSettled([
			this.view.container.git
				.getRepositoryService(this.commit.repoPath)
				.remotes.getBestRemotesWithProviders(toAbortSignal(cancellation)),
			GitCommit.ensureFullDetails(this.commit, {
				allowFilteredFiles: this._options?.allowFilteredFiles,
				include: { stats: true },
			}),
		]);

		if (cancellation.isCancellationRequested) return undefined;

		const remotes = getSettledValue(remotesResult, []);
		const [remote] = remotes;

		let enrichedAutolinks;

		if (remote != null && remoteSupportsIntegration(remote)) {
			const [enrichedAutolinksResult] = await Promise.allSettled([
				pauseOnCancelOrTimeoutMapTuplePromise(
					getCommitEnrichedAutolinks(this.commit.repoPath, this.commit.message, this.commit.summary, remote),
					toAbortSignal(cancellation),
				),
			]);

			if (cancellation.isCancellationRequested) return undefined;

			const enrichedAutolinksMaybeResult = getSettledValue(enrichedAutolinksResult);
			if (!enrichedAutolinksMaybeResult?.paused) {
				enrichedAutolinks = enrichedAutolinksMaybeResult?.value;
			}
		}

		const tooltip = await CommitFormatter.fromTemplateAsync(
			configuration.get('views.formats.stashes.tooltip'),
			this.commit,
			{ source: 'view:hover' },
			{
				enrichedAutolinks: enrichedAutolinks,
				dateFormat: configuration.get('defaultDateFormat'),
				messageAutolinks: true,
				messageIndent: 4,
				outputFormat: 'markdown',
				remotes: remotes,
			},
		);

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		return markdown;
	}
}
