import type { AzureWorkItemTypeStates } from '@gitkraken/provider-apis';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type { AzureWorkItemStateCategory } from './models.js';
import { azureIssueStateCategory, encodeAzurePathSegment } from './models.js';

type WorkItemTypeStates = NonNullable<AzureWorkItemTypeStates['types'][number]['states']>;

export type AzureWorkItemStatesScope = {
	baseUrl: string;
	namespace: string;
	project: string;
	token: string;
	isPAT: boolean;
};

export function getAzureWorkItemTypesUrl(baseUrl: string, namespace: string, project: string): string {
	return `${baseUrl.replace(/\/$/, '')}/${encodeAzurePathSegment(namespace)}/${encodeAzurePathSegment(project)}/_apis/wit/workItemTypes?api-version=6.0`;
}

// Server 2020 serves this endpoint only as a preview; Services accepts the same version.
export function getAzureWorkItemTypeStatesPath(namespace: string, project: string, type: string): string {
	return `${encodeAzurePathSegment(namespace)}/${encodeAzurePathSegment(project)}/_apis/wit/workItemTypes/${encodeAzurePathSegment(type)}/states?api-version=6.0-preview.1`;
}

export function getAzureWorkItemTypeStatesUrl(
	baseUrl: string,
	namespace: string,
	project: string,
	type: string,
): string {
	return `${baseUrl.replace(/\/$/, '')}/${getAzureWorkItemTypeStatesPath(namespace, project, type)}`;
}

function parseWorkItemTypes(body: unknown): string[] {
	const types = (body as { value?: unknown } | null)?.value;
	if (!Array.isArray(types)) throw new Error('Azure DevOps returned no work item types');

	const names: string[] = [];
	for (const type of types as { name?: unknown }[]) {
		if (typeof type?.name !== 'string' || !type.name.trim()) {
			throw new Error('Azure DevOps returned an invalid work item type');
		}

		names.push(type.name);
	}
	return [...new Set(names)];
}

function parseWorkItemStates(body: unknown): WorkItemTypeStates {
	const states = (body as { value?: unknown } | null)?.value;
	if (!Array.isArray(states) || states.length === 0) throw new Error('Azure DevOps returned no work item states');

	const parsed: { name: string; category: string }[] = [];
	for (const state of states as { name?: unknown; category?: unknown }[]) {
		if (
			typeof state?.name !== 'string' ||
			!state.name.trim() ||
			typeof state.category !== 'string' ||
			azureIssueStateCategory(state.category as AzureWorkItemStateCategory) == null ||
			parsed.some(s => s.name === state.name && s.category !== state.category)
		) {
			throw new Error('Azure DevOps returned an invalid work item state');
		}

		parsed.push({ name: state.name, category: state.category });
	}
	return parsed;
}

function scopeKey(scope: AzureWorkItemStatesScope, type?: string): string {
	return JSON.stringify([
		scope.baseUrl.replace(/\/$/, ''),
		scope.namespace.toLowerCase(),
		scope.project.toLowerCase(),
		type?.toLowerCase(),
		scope.token,
		scope.isPAT,
	]);
}

/**
 * Workflow metadata per project, work item type and token, kept for 5 minutes. A failed read is kept for 30 seconds,
 * so the pages and per-type reads of a listing fail fast with the same error instead of each asking a failing server
 * again; the first read after that retries.
 */
export class AzureWorkItemStatesCache {
	private readonly types = new PromiseCache<string, PromiseSettledResult<string[]>>({
		createTTL: 5 * 60 * 1000,
		capacity: 256,
	});
	private readonly states = new PromiseCache<string, PromiseSettledResult<WorkItemTypeStates>>({
		createTTL: 5 * 60 * 1000,
		capacity: 256,
	});

	clear(): void {
		this.types.clear();
		this.states.clear();
	}

	getTypes(scope: AzureWorkItemStatesScope, read: () => Promise<unknown>): Promise<string[]> {
		return this.read(this.types, scopeKey(scope), async () => parseWorkItemTypes(await read()));
	}

	getStates(
		scope: AzureWorkItemStatesScope,
		type: string,
		read: () => Promise<unknown>,
	): Promise<WorkItemTypeStates> {
		return this.read(this.states, scopeKey(scope, type), async () => parseWorkItemStates(await read()));
	}

	private async read<T>(
		cache: PromiseCache<string, PromiseSettledResult<T>>,
		key: string,
		load: () => Promise<T>,
	): Promise<T> {
		const result = await cache.getOrCreate(key, async () => ({ status: 'fulfilled', value: await load() }), {
			// Every caller must still see the failure; caching undefined would turn later pages into successes.
			onError: error =>
				cache.get(key) == null
					? undefined
					: { value: { status: 'rejected', reason: error }, createTTL: 30 * 1000, suppress: true },
		});
		if (result.status === 'rejected') throw result.reason;

		return result.value;
	}
}
