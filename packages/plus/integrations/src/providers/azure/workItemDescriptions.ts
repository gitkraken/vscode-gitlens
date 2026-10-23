import type { AzureWorkItemHtmlField } from '@gitkraken/provider-apis';
import { needsAzureWorkItemHtmlFields, toAzureWorkItemHtmlFields } from '@gitkraken/provider-apis';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import { encodeAzurePathSegment } from './models.js';
import type { AzureWorkItemStatesScope } from './workItemStateCategories.js';

export class AzureWorkItemDescriptionsCache {
	private readonly fields = new PromiseCache<string, PromiseSettledResult<AzureWorkItemHtmlField[]>>({
		createTTL: 60 * 60 * 1000,
		capacity: 256,
	});

	clear(): void {
		this.fields.clear();
	}

	async getFields(
		fields: Readonly<Record<string, unknown>> | undefined,
		scope: Omit<AzureWorkItemStatesScope, 'project'>,
		read: (signal?: AbortSignal) => Promise<unknown>,
		cancellation?: AbortSignal,
	): Promise<readonly AzureWorkItemHtmlField[]> {
		if (!needsAzureWorkItemHtmlFields(fields)) return [];

		encodeAzurePathSegment(scope.namespace);
		const key = JSON.stringify([
			scope.baseUrl.replace(/\/$/, ''),
			scope.namespace.toLowerCase(),
			scope.token,
			scope.isPAT,
		]);
		const result = await this.fields.getOrCreate(
			key,
			async (_cacheable, signal) => {
				const body = await read(signal);
				const value = (body as { value?: unknown } | null)?.value;
				if (!Array.isArray(value)) throw new Error('Azure DevOps returned no work item field catalog');

				return { status: 'fulfilled', value: toAzureWorkItemHtmlFields(value) };
			},
			{
				cancellation: cancellation,
				onError: error =>
					isCancellationError(error) || this.fields.get(key) == null
						? undefined
						: { value: { status: 'rejected', reason: error }, createTTL: 30 * 1000, suppress: true },
			},
		);
		if (result.status === 'rejected') throw result.reason;

		return result.value;
	}
}
