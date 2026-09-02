import type { IntegrationIds } from '../constants.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';

const linearIssueNotFoundMessage = /^Linear issue not found: .+$/i;

export function isProviderIssueNotFoundError(providerId: IntegrationIds, ex: unknown): boolean {
	if (providerId === IssuesCloudHostIntegrationId.Linear) {
		return ex instanceof Error && linearIssueNotFoundMessage.test(ex.message);
	}

	const status = (ex as { response?: { status?: unknown } }).response?.status;
	return status === 404 || status === 410 || status === 422;
}
