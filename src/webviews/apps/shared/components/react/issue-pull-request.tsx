import type { EventName } from '@lit/react';
import type { CustomEventType } from '../element';
import { reactWrapper } from '../helpers/react-wrapper';
import { IssuePullRequest as IssuePullRequestWC } from '../rich/issue-pull-request';

export interface GlIssuePullRequest extends IssuePullRequestWC {}
export const GlIssuePullRequest = reactWrapper(IssuePullRequestWC, {
	tagName: 'issue-pull-request',
	events: {
		onOpenDetails: 'gl-issue-pull-request-details' as EventName<CustomEventType<'gl-issue-pull-request-details'>>,
	},
});
