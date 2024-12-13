import type { CancellationToken } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import type { GitStashCommit } from '../../git/models/commit';
import type { GitStashReference } from '../../git/models/reference';
import { makeHierarchical } from '../../system/array';
import { joinPaths, normalizePath } from '../../system/path';
import { getSettledValue, pauseOnCancelOrTimeoutMapTuplePromise } from '../../system/promise';
import { sortCompare } from '../../system/string';
import { configuration } from '../../system/vscode/configuration';
import type { ViewsWithStashes } from '../viewBase';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { ViewRefNode } from './abstract/viewRefNode';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { StashFileNode } from './stashFileNode';

export class StashNode extends ViewRefNode<'stash', ViewsWithStashes, GitStashReference> {
	constructor(
		view: ViewsWithStashes,
		protected override parent: ViewNode,
		public readonly commit: GitStashCommit,
		private readonly options?: { icon?: boolean },
	) {
		super('stash', commit.getGitUri(), view, parent);

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
		const commits = await this.commit.getCommitsForFiles({ include: { stats: true } });
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
		if (this.options?.icon) {
			item.iconPath = new ThemeIcon('archive');
		}

		return item;
	}

	override async resolveTreeItem(item: TreeItem, token: CancellationToken): Promise<TreeItem> {
		if (item.tooltip == null) {
			item.tooltip = await this.getTooltip(token);
		}
		return item;
	}

	private async getTooltip(cancellation: CancellationToken) {
		const [remotesResult, _] = await Promise.allSettled([
			this.view.container.git.getBestRemotesWithProviders(this.commit.repoPath, cancellation),
			this.commit.ensureFullDetails({ include: { stats: true } }),
		]);

		if (cancellation.isCancellationRequested) return undefined;

		const remotes = getSettledValue(remotesResult, []);
		const [remote] = remotes;

		let enrichedAutolinks;

		if (remote?.hasIntegration()) {
			const [enrichedAutolinksResult] = await Promise.allSettled([
				pauseOnCancelOrTimeoutMapTuplePromise(this.commit.getEnrichedAutolinks(remote), cancellation),
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
