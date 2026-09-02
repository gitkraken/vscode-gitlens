import type { Issue } from '@gitlens/git/models/issue.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { IntegrationCacheProvider } from '../context.js';

export async function getCachedIssue(options: {
	cache: IntegrationCacheProvider;
	id: string;
	resource: ResourceDescriptor;
	integration: Parameters<IntegrationCacheProvider['getIssue']>[2];
	load: () => Promise<Issue | undefined>;
	cacheOptions: {
		connectionId: string | undefined;
		expiryOverride: boolean | number | undefined;
		etag: string;
	};
}): Promise<Issue | undefined> {
	return options.cache.getIssue(
		options.id,
		options.resource,
		options.integration,
		cacheable => ({
			value: options.load().catch((ex: unknown) => {
				cacheable.invalidate();
				throw ex;
			}),
		}),
		options.cacheOptions,
	);
}
