import { MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import { GitBranch } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import type { PullRequest } from '../../git/models/pullRequest';
import {
	ensurePullRequestRefs,
	getComparisonRefsForPullRequest,
	getOrOpenPullRequestRepository,
} from '../../git/models/pullRequest';
import type { GitBranchReference } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { createRevisionRange } from '../../git/models/revision.utils';
import { getAheadBehindFilesQuery, getCommitsQuery } from '../../git/queryResults';
import { getIssueOrPullRequestMarkdownIcon, getIssueOrPullRequestThemeIcon } from '../../git/utils/icons';
import { pluralize } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { CacheableChildrenViewNode } from './abstract/cacheableChildrenViewNode';
import type { ClipboardType, ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { CodeSuggestionsNode } from './codeSuggestionsNode';
import { MessageNode } from './common';
import { ResultsCommitsNode } from './resultsCommitsNode';
import { ResultsFilesNode } from './resultsFilesNode';

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
		item.description = `${this.pullRequest.state}, ${this.pullRequest.formatDateFromNow()}`;
		item.iconPath = getIssueOrPullRequestThemeIcon(this.pullRequest);
		item.tooltip = getPullRequestTooltip(this.pullRequest, this.context);

		return item;
	}
}

export async function getPullRequestChildren(
	view: ViewsWithCommits,
	parent: ViewNode,
	pullRequest: PullRequest,
	repoOrPath?: Repository | string,
) {
	let repo: Repository | undefined;
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
				`Unable to locate repository '${pullRequest.refs?.head.owner ?? pullRequest.repository.owner}/${
					pullRequest.refs?.head.repo ?? pullRequest.repository.repo
				}'.`,
			),
		];
	}

	const repoPath = repo.path;
	const refs = getComparisonRefsForPullRequest(repoPath, pullRequest.refs!);

	const counts = await ensurePullRequestRefs(
		view.container,
		pullRequest,
		repo,
		{ promptMessage: `Unable to open details for PR #${pullRequest.id} because of a missing remote.` },
		refs,
	);
	if (!counts?.right) {
		return [new MessageNode(view, parent, 'No commits could be found.')];
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
			'Commits',
			{
				query: getCommitsQuery(view.container, repoPath, comparison.range),
				comparison: comparison,
			},
			{
				autolinks: false,
				expand: false,
				description: pluralize('commit', counts?.right ?? 0),
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
	context?: { commit?: GitCommit; idPrefix?: string; codeSuggestionsCount?: number },
) {
	const tooltip = new MarkdownString('', true);
	tooltip.supportHtml = true;
	tooltip.isTrusted = true;

	if (context?.commit != null) {
		tooltip.appendMarkdown(
			`Commit \`$(git-commit) ${context.commit.shortSha}\` was introduced by $(git-pull-request) PR #${pullRequest.id}\n\n`,
		);
	}

	const linkTitle = ` "Open Pull Request \\#${pullRequest.id} on ${pullRequest.provider.name}"`;
	tooltip.appendMarkdown(
		`${getIssueOrPullRequestMarkdownIcon(pullRequest)} [**${pullRequest.title.trim()}**](${
			pullRequest.url
		}${linkTitle}) \\\n[${context?.idPrefix ?? ''}#${pullRequest.id}](${pullRequest.url}${linkTitle}) by [@${
			pullRequest.author.name
		}](${pullRequest.author.url} "Open @${pullRequest.author.name} on ${
			pullRequest.provider.name
		}") was ${pullRequest.state.toLowerCase()} ${pullRequest.formatDateFromNow()}`,
	);
	if (context?.codeSuggestionsCount != null && context.codeSuggestionsCount > 0) {
		tooltip.appendMarkdown(
			`\n\n$(gitlens-code-suggestion) ${pluralize('code suggestion', context.codeSuggestionsCount)}`,
		);
	}
	return tooltip;
}
