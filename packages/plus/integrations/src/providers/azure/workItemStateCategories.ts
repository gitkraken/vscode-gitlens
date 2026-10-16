import type { IssueProviderState } from '@gitlens/git/models/issue.js';
import type { AzureWorkItemStateCategory } from './models.js';
import { azureIssueStateCategory, encodeAzurePathSegment } from './models.js';

/** A work item type's workflow, as the category each of its state names classifies to. */
export type AzureWorkItemTypeStateCategories = ReadonlyMap<string, IssueProviderState['category']>;

/**
 * The states of work item type `type` in `project`, relative to the organization's or collection's base URL: the one
 * address both readers of this endpoint use. `api-version=6.0-preview.1` because Azure DevOps Server 2020 serves it
 * only as a preview; Azure DevOps Services accepts it too.
 */
export function getAzureWorkItemTypeStatesPath(namespace: string, project: string, type: string): string {
	return `${encodeAzurePathSegment(namespace)}/${encodeAzurePathSegment(project)}/_apis/wit/workItemTypes/${encodeAzurePathSegment(type)}/states?api-version=6.0-preview.1`;
}

/** {@link getAzureWorkItemTypeStatesPath} on `baseUrl`. */
export function getAzureWorkItemTypeStatesUrl(
	baseUrl: string,
	namespace: string,
	project: string,
	type: string,
): string {
	return `${baseUrl.replace(/\/$/, '')}/${getAzureWorkItemTypeStatesPath(namespace, project, type)}`;
}

/**
 * The states response, keyed by state name. Throws on a response with no `value` list, so the read fails rather than
 * leaving every state of the type without a category; a state with no string name is skipped.
 */
export function parseAzureWorkItemTypeStates(body: unknown): AzureWorkItemTypeStateCategories {
	const states = (body as { value?: unknown } | null | undefined)?.value;
	if (!Array.isArray(states)) throw new Error('Azure DevOps returned no work item states');

	const categories = new Map<string, IssueProviderState['category']>();
	for (const state of states as ({ name?: unknown; category?: unknown } | null | undefined)[]) {
		if (typeof state?.name !== 'string') continue;

		categories.set(state.name, azureIssueStateCategory(state.category as AzureWorkItemStateCategory | undefined));
	}
	return categories;
}
