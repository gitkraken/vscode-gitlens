import { MarkdownString, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import { GitFile, IssueOrPullRequest, IssueOrPullRequestType } from '../../git/models';
import { fromNow } from '../../system/date';
import { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode } from './viewNode';

export interface FilesQueryResults {
	label: string;
	files: GitFile[] | undefined;
	filtered?: {
		filter: 'left' | 'right';
		files: GitFile[];
	};
}

export class AutolinkedItemNode extends ViewNode<ViewsWithCommits> {
	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly repoPath: string,
		public readonly issue: IssueOrPullRequest,
	) {
		super(GitUri.fromRepoPath(repoPath), view, parent);
	}

	override toClipboard(): string {
		return this.issue.url;
	}

	override get id(): string {
		return `${this.parent!.id!}:item(${this.issue.id})`;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const relativeTime = fromNow(this.issue.closedDate ?? this.issue.date);

		const item = new TreeItem(`${this.issue.id}: ${this.issue.title}`, TreeItemCollapsibleState.None);
		item.description = relativeTime;
		item.iconPath = IssueOrPullRequest.getThemeIcon(this.issue);
		item.contextValue =
			this.issue.type === IssueOrPullRequestType.PullRequest
				? ContextValues.PullRequest
				: ContextValues.AutolinkedIssue;

		const linkTitle = ` "Open ${
			this.issue.type === IssueOrPullRequestType.PullRequest ? 'Pull Request' : 'Issue'
		} \\#${this.issue.id} on ${this.issue.provider.name}"`;
		const tooltip = new MarkdownString(
			`${IssueOrPullRequest.getMarkdownIcon(this.issue)} [**${this.issue.title.trim()}**](${
				this.issue.url
			}${linkTitle}) \\\n[#${this.issue.id}](${this.issue.url}${linkTitle}) was ${
				this.issue.closed ? 'closed' : 'opened'
			} ${relativeTime}`,
			true,
		);
		tooltip.supportHtml = true;
		tooltip.isTrusted = true;

		item.tooltip = tooltip;

		return item;
	}
}
