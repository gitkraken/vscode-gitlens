import type { Integration } from '../models/integration.js';
import { IssuesIntegration } from '../models/issuesIntegration.js';

/**
 * Routes a tracker's batched project read back through its per-project read, which is what the facade tests stub.
 *
 * Jira overrides the batch to search several projects at once, so a stub of its per-project read is otherwise never
 * reached. Those tests pin the facade's per-project accounting (windows, retries, truncation, warnings), not how a
 * tracker batches its searches; `jiraProjectSearches.test.ts` covers the batching itself.
 */
export function readProjectsOneByOne(integration: Integration | undefined): void {
	if (!(integration instanceof IssuesIntegration)) throw new Error('Expected an issue tracker integration');

	integration.getIssuesForProjectsWithTruncationResult = (requests, connectionId) =>
		IssuesIntegration.prototype.getIssuesForProjectsWithTruncationResult.call(integration, requests, connectionId);
}
