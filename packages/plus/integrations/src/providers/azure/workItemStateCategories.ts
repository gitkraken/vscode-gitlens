import type { AzureWorkItemTypeStates } from '@gitkraken/provider-apis';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type { AzureWorkItemStateCategory } from './models.js';
import { azureIssueStateCategory, encodeAzurePathSegment } from './models.js';

type WorkItemTypeStates = readonly { name: string; category?: string }[];
type WorkItemTypeStatesSnapshot = {
	states: WorkItemTypeStates;
	usesLegacyMappings: boolean;
};
type WorkItemStateMappings = ReadonlyMap<string, ReadonlyMap<string, string>>;

export type AzureWorkItemStatesScope = {
	baseUrl: string;
	namespace: string;
	project: string;
	token: string;
	isPAT: boolean;
};

// Older servers return a 404 page for unsupported API versions, so callers must supply the negotiated version.
export function getAzureWorkItemTypesUrl(
	baseUrl: string,
	namespace: string,
	project: string,
	apiVersion: string,
): string {
	return `${baseUrl.replace(/\/$/, '')}/${encodeAzurePathSegment(namespace)}/${encodeAzurePathSegment(project)}/_apis/wit/workItemTypes?api-version=${apiVersion}`;
}

// Azure DevOps Server serves this endpoint only as a preview.
export function getAzureWorkItemTypeStatesPath(
	namespace: string,
	project: string,
	type: string,
	apiVersion: string,
): string {
	return `${encodeAzurePathSegment(namespace)}/${encodeAzurePathSegment(project)}/_apis/wit/workItemTypes/${encodeAzurePathSegment(type)}/states?api-version=${apiVersion}`;
}

export function getAzureWorkItemTypeStatesUrl(
	baseUrl: string,
	namespace: string,
	project: string,
	type: string,
	apiVersion: string,
): string {
	return `${baseUrl.replace(/\/$/, '')}/${getAzureWorkItemTypeStatesPath(namespace, project, type, apiVersion)}`;
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

function parseWorkItemStates(body: unknown, allowMissingCategory = false): WorkItemTypeStates {
	const states = (body as { value?: unknown } | null)?.value;
	if (!Array.isArray(states) || states.length === 0) throw new Error('Azure DevOps returned no work item states');

	const parsed: { name: string; category?: string }[] = [];
	for (const state of states as { name?: unknown; category?: unknown }[]) {
		if (
			typeof state?.name !== 'string' ||
			!state.name.trim() ||
			(state.category === undefined
				? !allowMissingCategory
				: typeof state.category !== 'string' ||
					azureIssueStateCategory(state.category as AzureWorkItemStateCategory) == null) ||
			parsed.some(s => s.name === state.name && s.category !== state.category)
		) {
			throw new Error('Azure DevOps returned an invalid work item state');
		}

		parsed.push({ name: state.name, category: state.category as string | undefined });
	}
	return parsed;
}

export function resolveAzureWorkItemStateCategory(
	snapshot: WorkItemTypeStatesSnapshot,
	state: string,
): AzureWorkItemStateCategory | undefined {
	const matched = snapshot.states.find(s => s.name === state);
	const category = matched?.category as AzureWorkItemStateCategory | undefined;
	if ((snapshot.usesLegacyMappings || matched != null) && category == null) {
		throw new Error(`Azure DevOps does not expose a category for work item state '${state}'`);
	}

	return category;
}

export function requireAzureWorkItemStateCategories(
	snapshot: WorkItemTypeStatesSnapshot,
): NonNullable<AzureWorkItemTypeStates['types'][number]['states']> {
	return snapshot.states.map(state => {
		if (state.category == null) throw new Error('Azure DevOps does not expose a category for this work item state');

		return { name: state.name, category: state.category };
	});
}

function parseWorkItemStateMappings(body: unknown): WorkItemStateMappings {
	const types = (body as { workItemTypeMappedStates?: unknown } | null)?.workItemTypeMappedStates;
	if (!Array.isArray(types)) throw new Error('Azure DevOps returned no workflow category mappings');

	const result = new Map<string, Map<string, string>>();
	for (const type of types as { workItemTypeName?: unknown; states?: unknown }[]) {
		if (
			typeof type?.workItemTypeName !== 'string' ||
			!type.workItemTypeName.trim() ||
			type.states == null ||
			typeof type.states !== 'object' ||
			Array.isArray(type.states)
		) {
			throw new Error('Azure DevOps returned invalid workflow category mappings');
		}

		const states = result.get(type.workItemTypeName) ?? new Map<string, string>();
		for (const [name, category] of Object.entries(type.states)) {
			if (
				!name.trim() ||
				typeof category !== 'string' ||
				azureIssueStateCategory(category as AzureWorkItemStateCategory) == null ||
				(states.has(name) && states.get(name) !== category)
			) {
				throw new Error('Azure DevOps returned invalid workflow category mappings');
			}

			states.set(name, category);
		}
		result.set(type.workItemTypeName, states);
	}
	return result;
}

function scopeKey(scope: AzureWorkItemStatesScope, type?: string): string {
	encodeAzurePathSegment(scope.namespace);
	encodeAzurePathSegment(scope.project);
	if (type != null) {
		encodeAzurePathSegment(type);
	}

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
	private readonly states = new PromiseCache<string, PromiseSettledResult<WorkItemTypeStatesSnapshot>>({
		createTTL: 5 * 60 * 1000,
		capacity: 256,
	});

	private readonly mappings = new PromiseCache<string, PromiseSettledResult<WorkItemStateMappings>>({
		createTTL: 5 * 60 * 1000,
		capacity: 256,
	});

	clear(): void {
		this.types.clear();
		this.states.clear();
		this.mappings.clear();
	}

	getTypes(
		scope: AzureWorkItemStatesScope,
		read: (signal?: AbortSignal) => Promise<unknown>,
		cancellation?: AbortSignal,
	): Promise<string[]> {
		return this.read(
			this.types,
			scopeKey(scope),
			async signal => parseWorkItemTypes(await read(signal)),
			cancellation,
		);
	}

	getStates(
		scope: AzureWorkItemStatesScope,
		type: string,
		read: (signal?: AbortSignal) => Promise<unknown>,
		cancellation?: AbortSignal,
		readMappings?: (signal?: AbortSignal) => Promise<unknown>,
	): Promise<WorkItemTypeStatesSnapshot> {
		return this.read(
			this.states,
			scopeKey(scope, type),
			async signal => {
				const states = parseWorkItemStates(await read(signal), readMappings != null);
				if (readMappings == null || states.every(state => state.category != null)) {
					return { states: states, usesLegacyMappings: false };
				}

				const mappings = await this.read(
					this.mappings,
					scopeKey(scope),
					async aggregate => parseWorkItemStateMappings(await readMappings(aggregate)),
					signal,
				);
				const mapped = mappings.get(type);
				return {
					states: states.map(state => ({
						name: state.name,
						category: state.category ?? mapped?.get(state.name),
					})),
					usesLegacyMappings: true,
				};
			},
			cancellation,
		);
	}

	private async read<T>(
		cache: PromiseCache<string, PromiseSettledResult<T>>,
		key: string,
		load: (signal?: AbortSignal) => Promise<T>,
		cancellation?: AbortSignal,
	): Promise<T> {
		const result = await cache.getOrCreate(
			key,
			async (_cacheable, signal) => ({ status: 'fulfilled', value: await load(signal) }),
			{
				cancellation: cancellation,
				// Every caller must still see the failure; caching undefined would turn later pages into successes.
				onError: error =>
					isCancellationError(error) || cache.get(key) == null
						? undefined
						: { value: { status: 'rejected', reason: error }, createTTL: 30 * 1000, suppress: true },
			},
		);
		if (result.status === 'rejected') throw result.reason;

		return result.value;
	}
}
