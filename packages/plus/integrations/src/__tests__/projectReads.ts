import type { Integration } from '../models/integration.js';
import { IssuesIntegration } from '../models/issuesIntegration.js';

/**
 * Makes a tracker read every project on its own, through the per-project read the facade tests stub.
 *
 * Jira and Linear group a user-scoped read's projects into searches, so a stub of their per-project read is
 * otherwise never reached. Those tests pin the facade's per-project accounting (windows, retries, truncation,
 * warnings), not how a tracker searches; `jiraProjectSearches.test.ts` and `linearTeamSearches.test.ts` cover that.
 */
export function readProjectsOneByOne(integration: Integration | undefined): void {
	if (!(integration instanceof IssuesIntegration)) throw new Error('Expected an issue tracker integration');

	(integration as unknown as { getProjectIssuesSearches: () => undefined }).getProjectIssuesSearches = () =>
		undefined;
}
