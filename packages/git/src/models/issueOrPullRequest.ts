import type { ProviderReference } from './remoteProvider.js';

export interface IssueOrPullRequest {
	readonly type: IssueOrPullRequestType;
	readonly provider: ProviderReference;
	readonly id: string;
	readonly nodeId: string | undefined;
	readonly title: string;
	readonly url: string;
	readonly createdDate: Date;
	readonly updatedDate: Date;
	readonly closedDate?: Date;
	readonly closed: boolean;
	/** Unset when the provider cannot classify the workflow state and supplies no closed date. */
	readonly state: IssueOrPullRequestState | undefined;
	readonly commentsCount?: number;
	readonly thumbsUpCount?: number;
	/**
	 * The milestone the item is scheduled under: a GitHub or GitLab milestone, or a Linear project milestone. `null`
	 * when the read asked for it and the item has none; `undefined` when the read didn't ask, or the provider has no
	 * milestones. Whether a read asked is what `getIssueFieldPresence` / `getPullRequestFieldPresence`
	 * (`@gitlens/integrations`) report for the `milestone` group.
	 */
	readonly milestone?: IssueMilestone | null;
}

export interface IssueMilestone {
	/**
	 * Stable and unique within the provider's host, never across hosts: a GitHub node ID, a GitLab global ID
	 * (`gid://gitlab/Milestone/<id>`), a Linear project milestone's UUID. Key it with the item's provider and domain.
	 */
	readonly id: string;
	readonly title: string;
	/** Linear reports a project milestone as `closed` once it is done. */
	readonly state: 'open' | 'closed';
	/** The due date, which on Linear is the project milestone's target date. Absent when none is set. */
	readonly dueDate?: Date;
	/** Absent when the provider has no page for it (Linear). */
	readonly url?: string;
}

export type IssueOrPullRequestType = 'issue' | 'pullrequest';
export type IssueOrPullRequestState = 'opened' | 'closed' | 'merged';
