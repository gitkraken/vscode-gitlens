import { l10n, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import {
	getComparisonRefsForPullRequest,
	getRepositoryIdentityForPullRequest,
} from '@gitlens/git/utils/pullRequest.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { Colors } from '../../constants.colors.js';
import { GitUri } from '../../git/gitUri.js';
import type { GlRepository } from '../../git/models/repository.js';
import { getAheadBehindFilesQuery, getCommitsQuery } from '../../git/queryResults.js';
import { getIssueOrPullRequestMarkdownIcon, getIssueOrPullRequestThemeIcon } from '../../git/utils/-webview/icons.js';
import {
	ensurePullRequestRefs,
	ensurePullRequestRemote,
	getOrOpenPullRequestRepository,
} from '../../git/utils/-webview/pullRequest.utils.js';
import { createCommand } from '../../system/-webview/command.js';
import type { ViewsWithCommits } from '../viewBase.js';
import { createViewDecorationUri } from '../viewDecorationProvider.js';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode.js';
import type { ClipboardType, ViewNode } from './abstract/viewNode.js';
import { ContextValues, getViewNodeId } from './abstract/viewNode.js';
import { CodeSuggestionsNode } from './codeSuggestionsNode.js';
import { CommandMessageNode, MessageNode } from './common.js';
import { ResultsCommitsNode } from './resultsCommitsNode.js';
import { ResultsFilesNode } from './resultsFilesNode.js';

export class PullRequestNode extends CacheableChildrenViewNode<'pullrequest', ViewsWithCommits> {
	readonly repoPath: string;

	constructor(
		view: ViewsWithCommits,
		protected override readonly parent: ViewNode,
		public readonly pullRequest: PullRequest,
		branchOrCommitOrRepoPath: GitBranch | GitCommit | string,
		private readonly options?: { expand?: boolean },
	) {
		let branchOrCommit;
		let repoPath;
		if (typeof branchOrCommitOrRepoPath === 'string') {
			repoPath = branchOrCommitOrRepoPath;
		} else {
			repoPath = branchOrCommitOrRepoPath.repoPath;
			branchOrCommit = branchOrCommitOrRepoPath;
		}

		super('pullrequest', GitUri.fromRepoPath(repoPath), view, parent);

		if (branchOrCommit != null) {
			if (branchOrCommit instanceof GitBranch) {
				this.updateContext({ branch: branchOrCommit });
			} else {
				this.updateContext({ commit: branchOrCommit });
			}
		}

		this.updateContext({ pullRequest: pullRequest });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.repoPath = repoPath;
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(type?: ClipboardType): string {
		const url = this.getUrl();
		switch (type) {
			case 'markdown':
				return `[${this.pullRequest.id}](${url}) ${this.pullRequest.title}`;
			default:
				return url;
		}
	}

	override getUrl(): string {
		return this.pullRequest.url;
	}

	get baseRef(): GitBranchReference | undefined {
		if (this.pullRequest.refs?.base != null) {
			return {
				refType: 'branch',
				repoPath: this.repoPath,
				ref: this.pullRequest.refs.base.sha,
				name: this.pullRequest.refs.base.branch,
				remote: true,
			};
		}
		return undefined;
	}

	get ref(): GitBranchReference | undefined {
		if (this.pullRequest.refs?.head != null) {
			return {
				refType: 'branch',
				repoPath: this.repoPath,
				ref: this.pullRequest.refs.head.sha,
				name: this.pullRequest.refs.head.branch,
				remote: true,
			};
		}
		return undefined;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const children = await getPullRequestChildren(this.view, this, this.pullRequest, this.repoPath);
			this.children = children;
		}
		return this.children;
	}

	getTreeItem(): TreeItem {
		const hasRefs = this.pullRequest.refs?.base != null && this.pullRequest.refs.head != null;

		const item = new TreeItem(
			`#${this.pullRequest.id}: ${this.pullRequest.title}`,
			hasRefs
				? this.options?.expand
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed
				: TreeItemCollapsibleState.None,
		);
		item.id = this.id;
		item.contextValue = ContextValues.PullRequest;
		if (this.pullRequest.refs?.base != null && this.pullRequest.refs.head != null) {
			item.contextValue += `+refs`;
		}
		item.description = `${this.pullRequest.state}, ${PullRequest.formatDateFromNow(this.pullRequest)}`;
		item.iconPath = getIssueOrPullRequestThemeIcon(this.pullRequest);
		item.tooltip = getPullRequestTooltip(this.pullRequest, this.context);

		return item;
	}
}

export async function getPullRequestChildren(
	view: ViewsWithCommits,
	parent: ViewNode,
	pullRequest: PullRequest,
	repoOrPath?: GlRepository | string,
): Promise<ViewNode[]> {
	let repo: GlRepository | undefined;
	if (repoOrPath == null) {
		repo = await getOrOpenPullRequestRepository(view.container, pullRequest, { promptIfNeeded: true });
	} else if (typeof repoOrPath === 'string') {
		repo = view.container.git.getRepository(repoOrPath);
	} else {
		repo = repoOrPath;
	}

	if (repo == null) {
		return [
			new MessageNode(
				view,
				parent,
				l10n.t(
					"Unable to locate repository '{0}/{1}'.",
					pullRequest.refs?.head.owner ?? pullRequest.repository.owner,
					pullRequest.refs?.head.repo ?? pullRequest.repository.repo,
				),
			),
		];
	}

	const repoPath = repo.path;
	const refs = getComparisonRefsForPullRequest(repoPath, pullRequest.refs!);
	const identity = getRepositoryIdentityForPullRequest(pullRequest);
	if (!(await ensurePullRequestRemote(pullRequest, repo, { silent: true }))) {
		return [
			new CommandMessageNode(
				view,
				parent,
				createCommand<[ViewNode, PullRequest, GlRepository]>(
					'gitlens.views.addPullRequestRemote',
					l10n.t('Add Pull Request Remote...'),
					parent,
					pullRequest,
					repo,
				),
				l10n.t("Unable to find a remote for '{0}'", identity.provider.repoDomain),
				undefined,
				l10n.t("Click to add a remote for '{0}'", identity.provider.repoDomain),
				new ThemeIcon(
					'question',
					new ThemeColor('gitlens.decorations.workspaceRepoMissingForegroundColor' satisfies Colors),
				),
				undefined,
				createViewDecorationUri('remote', { state: 'missing' }),
			),
		];
	}

	const counts = await ensurePullRequestRefs(
		pullRequest,
		repo,
		{ promptMessage: l10n.t('Unable to open details for PR #{0} because of a missing remote.', pullRequest.id) },
		refs,
	);
	if (!counts?.right) {
		return [new MessageNode(view, parent, l10n.t('No commits could be found.'))];
	}

	const comparison = {
		ref1: refs.base.ref,
		ref2: refs.head.ref,
		range: createRevisionRange(refs.base.ref, refs.head.ref, '..'),
	};

	const children = [
		new ResultsCommitsNode(
			view,
			parent,
			repoPath,
			l10n.t('Commits'),
			{
				query: getCommitsQuery(view.container, repoPath, comparison.range),
				comparison: comparison,
			},
			{
				autolinks: false,
				expand: false,
				description: formatPlural(l10n.t('{0, plural, one{{0} commit} other{{0} commits}}'), [
					counts?.right ?? 0,
				]),
			},
		),
		new CodeSuggestionsNode(view, parent, repoPath, pullRequest),
		new ResultsFilesNode(
			view,
			parent,
			repoPath,
			comparison.ref1,
			comparison.ref2,
			() =>
				getAheadBehindFilesQuery(
					view.container,
					repoPath,
					createRevisionRange(comparison.ref1, comparison.ref2, '...'),
					false,
				),
			undefined,
			{ expand: true, timeout: false },
		),
	];
	return children;
}

export function getPullRequestTooltip(
	pullRequest: PullRequest,
	context?: { commit?: GitCommit; idPrefix?: string },
): MarkdownString {
	const tooltip = new MarkdownString('', true);
	tooltip.supportHtml = true;
	tooltip.isTrusted = true;

	if (context?.commit != null) {
		tooltip.appendMarkdown(
			l10n.t(
				'Commit `$(git-commit) {0}` was introduced by $(git-pull-request) PR #{1}\n\n',
				context.commit.shortSha,
				pullRequest.id,
			),
		);
	}

	const linkTitle = ` "${l10n.t('Open Pull Request \\#{0} on {1}', pullRequest.id, pullRequest.provider.name)}"`;
	// A provider can report a pull request with no author (a deleted account, or a host with no per-item
	// creator), which normalizes to an absent `url` and `name`. Interpolating the url produced a link to nowhere,
	// so fall back to plain text; with no name there's nothing to attribute, so drop the `by …` clause rather
	// than render `by @undefined` (the provider layer deliberately doesn't invent a placeholder name).
	const authorName = pullRequest.author.name;
	const attribution =
		authorName == null
			? undefined
			: pullRequest.author.url
				? `[@${authorName}](${pullRequest.author.url} "${l10n.t(
						'Open @{0} on {1}',
						authorName,
						pullRequest.provider.name,
					)}")`
				: `@${authorName}`;
	const status = getPullRequestStatus(pullRequest.state, attribution, PullRequest.formatDateFromNow(pullRequest));
	tooltip.appendMarkdown(
		`${getIssueOrPullRequestMarkdownIcon(pullRequest)} [**${pullRequest.title.trim()}**](${
			pullRequest.url
		}${linkTitle}) \\\n[${context?.idPrefix ?? ''}#${pullRequest.id}](${pullRequest.url}${linkTitle}) ${status}`,
	);
	return tooltip;
}

function getPullRequestStatus(
	state: PullRequest['state'],
	attribution: string | undefined,
	relativeDate: string,
): string {
	switch (state) {
		case 'opened':
			return attribution == null
				? l10n.t('was opened {0}', relativeDate)
				: l10n.t('by {0} was opened {1}', attribution, relativeDate);
		case 'closed':
			return attribution == null
				? l10n.t('was closed {0}', relativeDate)
				: l10n.t('by {0} was closed {1}', attribution, relativeDate);
		case 'merged':
			return attribution == null
				? l10n.t('was merged {0}', relativeDate)
				: l10n.t('by {0} was merged {1}', attribution, relativeDate);
	}
}
