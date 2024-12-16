// import type { EnrichedAutolink } from './annotations/autolinks';
import type { Disposable } from './api/gitlens';
import type { Container } from './container';
import type { Account } from './git/models/author';
import type { DefaultBranch } from './git/models/defaultBranch';
import type { Issue, IssueOrPullRequest } from './git/models/issue';
import type { PullRequest } from './git/models/pullRequest';
import type { RepositoryMetadata } from './git/models/repositoryMetadata';
import type { HostingIntegration, IntegrationBase, ResourceDescriptor } from './plus/integrations/integration';
import { isPromise } from './system/promise';

type Caches = {
	defaultBranch: { key: `repo:${string}`; value: DefaultBranch };
	// enrichedAutolinksBySha: { key: `sha:${string}:${string}`; value: Map<string, EnrichedAutolink> };
	issuesById: { key: `id:${string}:${string}`; value: Issue };
	issuesByIdAndResource: { key: `id:${string}:${string}:${string}`; value: Issue };
	issuesOrPrsById: { key: `id:${string}:${string}`; value: IssueOrPullRequest };
	issuesOrPrsByIdAndRepo: { key: `id:${string}:${string}:${string}`; value: IssueOrPullRequest };
	prByBranch: { key: `branch:${string}:${string}`; value: PullRequest };
	prsById: { key: `id:${string}:${string}`; value: PullRequest };
	prsBySha: { key: `sha:${string}:${string}`; value: PullRequest };
	repoMetadata: { key: `repo:${string}`; value: RepositoryMetadata };
	currentAccount: { key: `id:${string}`; value: Account };
};

type Cache = keyof Caches;
type CacheKey<T extends Cache> = Caches[T]['key'];
type CacheValue<T extends Cache> = Caches[T]['value'];
type CacheResult<T> = Promise<T | undefined> | T | undefined;

type Cacheable<T> = () => { value: CacheResult<T>; expiresAt?: number };
type Cached<T> =
	| {
			value: T | undefined;
			cachedAt: number;
			expiresAt?: number;
			etag?: string;
	  }
	| {
			value: Promise<T | undefined>;
			cachedAt: number;
			expiresAt?: never; // Don't set an expiration on promises as they will resolve to a value with the desired expiration
			etag?: string;
	  };

export class CacheProvider implements Disposable {
	private readonly _cache = new Map<`${Cache}:${CacheKey<Cache>}`, Cached<CacheResult<CacheValue<Cache>>>>();

	// eslint-disable-next-line @typescript-eslint/no-useless-constructor
	constructor(_container: Container) {}

	dispose() {
		this._cache.clear();
	}

	delete<T extends Cache>(cache: T, key: CacheKey<T>) {
		this._cache.delete(`${cache}:${key}`);
	}

	get<T extends Cache>(
		cache: T,
		key: CacheKey<T>,
		etag: string | undefined,
		cacheable: Cacheable<CacheValue<T>>,
		options?: { expiryOverride?: boolean | number },
	): CacheResult<CacheValue<T>> {
		const item = this._cache.get(`${cache}:${key}`);

		// Allow the caller to override the expiry
		let expiry;
		if (item != null) {
			if (typeof options?.expiryOverride === 'number' && options.expiryOverride > 0) {
				expiry = item.cachedAt + options.expiryOverride;
			} else {
				expiry = item.expiresAt;
			}
		}

		if (
			item == null ||
			options?.expiryOverride === true ||
			(expiry != null && expiry > 0 && expiry < Date.now()) ||
			(item.etag != null && item.etag !== etag)
		) {
			const { value, expiresAt } = cacheable();
			return this.set<T>(cache, key, value, etag, expiresAt)?.value as CacheResult<CacheValue<T>>;
		}

		return item.value as CacheResult<CacheValue<T>>;
	}

	getCurrentAccount(
		integration: IntegrationBase,
		cacheable: Cacheable<Account>,
		options?: { expiryOverride?: boolean | number },
	): CacheResult<Account> {
		const { key, etag } = getIntegrationKeyAndEtag(integration);
		return this.get('currentAccount', `id:${key}`, etag, cacheable, options);
	}

	// getEnrichedAutolinks(
	// 	sha: string,
	// 	remoteOrProvider: Integration,
	// 	cacheable: Cacheable<Map<string, EnrichedAutolink>>,
	// 	options?: { force?: boolean },
	// ): CacheResult<Map<string, EnrichedAutolink>> {
	// 	const { key, etag } = getRemoteKeyAndEtag(remoteOrProvider);
	// 	return this.get('enrichedAutolinksBySha', `sha:${sha}:${key}`, etag, cacheable, options);
	// }

	getIssueOrPullRequest(
		id: string,
		resource: ResourceDescriptor,
		integration: IntegrationBase | undefined,
		cacheable: Cacheable<IssueOrPullRequest>,
		options?: { expiryOverride?: boolean | number },
	): CacheResult<IssueOrPullRequest> {
		const { key, etag } = getResourceKeyAndEtag(resource, integration);

		if (resource == null) {
			return this.get('issuesOrPrsById', `id:${id}:${key}`, etag, cacheable, options);
		}
		return this.get(
			'issuesOrPrsByIdAndRepo',
			`id:${id}:${key}:${JSON.stringify(resource)}}`,
			etag,
			cacheable,
			options,
		);
	}

	getIssue(
		id: string,
		resource: ResourceDescriptor,
		integration: IntegrationBase | undefined,
		cacheable: Cacheable<Issue>,
		options?: { expiryOverride?: boolean | number },
	): CacheResult<Issue> {
		const { key, etag } = getResourceKeyAndEtag(resource, integration);

		if (resource == null) {
			return this.get('issuesById', `id:${id}:${key}`, etag, cacheable, options);
		}
		return this.get(
			'issuesByIdAndResource',
			`id:${id}:${key}:${JSON.stringify(resource)}}`,
			etag,
			cacheable,
			options,
		);
	}

	getPullRequest(
		id: string,
		resource: ResourceDescriptor,
		integration: IntegrationBase | undefined,
		cacheable: Cacheable<PullRequest>,
		options?: { expiryOverride?: boolean | number },
	): CacheResult<PullRequest> {
		const { key, etag } = getResourceKeyAndEtag(resource, integration);

		if (resource == null) {
			return this.get('prsById', `id:${id}:${key}`, etag, cacheable, options);
		}
		return this.get('prsById', `id:${id}:${key}:${JSON.stringify(resource)}}`, etag, cacheable, options);
	}

	getPullRequestForBranch(
		branch: string,
		repo: ResourceDescriptor,
		integration: HostingIntegration | undefined,
		cacheable: Cacheable<PullRequest>,
		options?: { expiryOverride?: boolean | number },
	): CacheResult<PullRequest> {
		const { key, etag } = getResourceKeyAndEtag(repo, integration);
		// Wrap the cacheable so we can also add the result to the issuesOrPrsById cache
		return this.get(
			'prByBranch',
			`branch:${branch}:${key}`,
			etag,
			this.wrapPullRequestCacheable(cacheable, key, etag),
			options,
		);
	}

	getPullRequestForSha(
		sha: string,
		repo: ResourceDescriptor,
		integration: HostingIntegration | undefined,
		cacheable: Cacheable<PullRequest>,
		options?: { expiryOverride?: boolean | number },
	): CacheResult<PullRequest> {
		const { key, etag } = getResourceKeyAndEtag(repo, integration);
		// Wrap the cacheable so we can also add the result to the issuesOrPrsById cache
		return this.get(
			'prsBySha',
			`sha:${sha}:${key}`,
			etag,
			this.wrapPullRequestCacheable(cacheable, key, etag),
			options,
		);
	}

	getRepositoryDefaultBranch(
		repo: ResourceDescriptor,
		integration: HostingIntegration | undefined,
		cacheable: Cacheable<DefaultBranch>,
		options?: { expiryOverride?: boolean | number },
	): CacheResult<DefaultBranch> {
		const { key, etag } = getResourceKeyAndEtag(repo, integration);
		return this.get('defaultBranch', `repo:${key}`, etag, cacheable, options);
	}

	getRepositoryMetadata(
		repo: ResourceDescriptor,
		integration: HostingIntegration | undefined,
		cacheable: Cacheable<RepositoryMetadata>,
		options?: { expiryOverride?: boolean | number },
	): CacheResult<RepositoryMetadata> {
		const { key, etag } = getResourceKeyAndEtag(repo, integration);
		return this.get('repoMetadata', `repo:${key}`, etag, cacheable, options);
	}

	private set<T extends Cache>(
		cache: T,
		key: CacheKey<T>,
		value: CacheResult<CacheValue<T>>,
		etag: string | undefined,
		expiresAt?: number,
	): Cached<CacheResult<CacheValue<T>>> {
		let item: Cached<CacheResult<CacheValue<T>>>;
		if (isPromise(value)) {
			void value.then(
				v => {
					this.set(cache, key, v, etag, expiresAt);
				},
				() => {
					this.delete(cache, key);
				},
			);

			item = { value: value, etag: etag, cachedAt: Date.now() };
		} else {
			item = {
				value: value,
				etag: etag,
				cachedAt: Date.now(),
				expiresAt: expiresAt ?? getExpiresAt<T>(cache, value),
			};
		}

		this._cache.set(`${cache}:${key}`, item);
		return item;
	}

	private wrapPullRequestCacheable(
		cacheable: Cacheable<PullRequest>,
		key: string,
		etag: string | undefined,
	): Cacheable<PullRequest> {
		return () => {
			const item = cacheable();
			if (isPromise(item.value)) {
				void item.value.then(v => {
					if (v != null) {
						this.set('issuesOrPrsById', `id:${v.id}:${key}`, v, etag);
					}
				});
			}

			return item;
		};
	}
}

function getExpiresAt<T extends Cache>(cache: T, value: CacheValue<T> | undefined): number {
	const now = Date.now();
	const defaultExpiresAt = now + 60 * 60 * 1000; // 1 hour

	switch (cache) {
		case 'defaultBranch':
		case 'repoMetadata':
		case 'currentAccount':
			return 0; // Never expires
		case 'issuesById':
		case 'issuesByIdAndResource': {
			if (value == null) return 0; // Never expires

			// Open issues expire after 1 hour, but closed issues expire after 12 hours unless recently updated and then expire in 1 hour

			const issue = value as CacheValue<'issuesById'>;
			if (!issue.closed) return defaultExpiresAt;

			const updatedAgo = now - (issue.closedDate ?? issue.updatedDate).getTime();
			return now + (updatedAgo > 14 * 24 * 60 * 60 * 1000 ? 12 : 1) * 60 * 60 * 1000;
		}
		case 'issuesOrPrsById':
		case 'issuesOrPrsByIdAndRepo': {
			if (value == null) return 0; // Never expires

			// Open issues expire after 1 hour, but closed issues expire after 12 hours unless recently updated and then expire in 1 hour

			const issueOrPr = value as CacheValue<'issuesOrPrsById'>;
			if (!issueOrPr.closed) return defaultExpiresAt;

			const updatedAgo = now - (issueOrPr.closedDate ?? issueOrPr.updatedDate).getTime();
			return now + (updatedAgo > 14 * 24 * 60 * 60 * 1000 ? 12 : 1) * 60 * 60 * 1000;
		}
		case 'prByBranch':
		case 'prsById':
		case 'prsBySha': {
			if (value == null) return cache === 'prByBranch' ? defaultExpiresAt : 0 /* Never expires */;

			// Open prs expire after 1 hour, but closed/merge prs expire after 12 hours unless recently updated and then expire in 1 hour

			const pr = value as CacheValue<'prByBranch' | 'prsById' | 'prsBySha'>;
			if (pr.state === 'opened') return defaultExpiresAt;

			const updatedAgo = now - (pr.closedDate ?? pr.mergedDate ?? pr.updatedDate).getTime();
			return now + (updatedAgo > 14 * 24 * 60 * 60 * 1000 ? 12 : 1) * 60 * 60 * 1000;
		}
		// case 'enrichedAutolinksBySha':
		default:
			return value == null ? 0 /* Never expires */ : defaultExpiresAt;
	}
}

function getResourceKeyAndEtag(resource: ResourceDescriptor, integration?: HostingIntegration | IntegrationBase) {
	return { key: resource.key, etag: `${resource.key}:${integration?.maybeConnected ?? false}` };
}

function getIntegrationKeyAndEtag(integration: IntegrationBase) {
	return { key: integration.id, etag: `${integration.id}:${integration.maybeConnected ?? false}` };
}
