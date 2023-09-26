// import type { EnrichedAutolink } from './annotations/autolinks';
import type { Disposable } from './api/gitlens';
import type { Container } from './container';
import type { DefaultBranch } from './git/models/defaultBranch';
import type { IssueOrPullRequest } from './git/models/issue';
import type { PullRequest } from './git/models/pullRequest';
import type { GitRemote } from './git/models/remote';
import type { RepositoryMetadata } from './git/models/repositoryMetadata';
import type { RemoteProvider } from './git/remotes/remoteProvider';
import type { RichRemoteProvider } from './git/remotes/richRemoteProvider';
import { isPromise } from './system/promise';

type Caches = {
	defaultBranch: { key: `repo:${string}`; value: DefaultBranch };
	// enrichedAutolinksBySha: { key: `sha:${string}:${string}`; value: Map<string, EnrichedAutolink> };
	issuesOrPrsById: { key: `id:${string}:${string}`; value: IssueOrPullRequest };
	prByBranch: { key: `branch:${string}:${string}`; value: PullRequest };
	prsBySha: { key: `sha:${string}:${string}`; value: PullRequest };
	repoMetadata: { key: `repo:${string}`; value: RepositoryMetadata };
};

type Cache = keyof Caches;
type CacheKey<T extends Cache> = Caches[T]['key'];
type CacheValue<T extends Cache> = Caches[T]['value'];
type CacheResult<T> = Promise<T | undefined> | T | undefined;

type Cacheable<T> = () => { value: CacheResult<T>; expiresAt?: number };
type Cached<T> =
	| {
			value: T | undefined;
			expiresAt?: number;
			etag?: string;
	  }
	| {
			value: Promise<T | undefined>;
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
	): CacheResult<CacheValue<T>> {
		const item = this._cache.get(`${cache}:${key}`);

		if (
			item == null ||
			(item.expiresAt != null && item.expiresAt > 0 && item.expiresAt < Date.now()) ||
			(item.etag != null && item.etag !== etag)
		) {
			const { value, expiresAt } = cacheable();
			return this.set<T>(cache, key, value, etag, expiresAt)?.value as CacheResult<CacheValue<T>>;
		}

		return item.value as CacheResult<CacheValue<T>>;
	}

	getIssueOrPullRequest(
		id: string,
		remoteOrProvider: RichRemoteProvider | GitRemote<RichRemoteProvider>,
		cacheable: Cacheable<IssueOrPullRequest>,
	): CacheResult<IssueOrPullRequest> {
		const { key, etag } = getRemoteKeyAndEtag(remoteOrProvider);
		return this.get('issuesOrPrsById', `id:${id}:${key}`, etag, cacheable);
	}

	// getEnrichedAutolinks(
	// 	sha: string,
	// 	remoteOrProvider: RichRemoteProvider | GitRemote<RichRemoteProvider>,
	// 	cacheable: Cacheable<Map<string, EnrichedAutolink>>,
	// ): CacheResult<Map<string, EnrichedAutolink>> {
	// 	const { key, etag } = getRemoteKeyAndEtag(remoteOrProvider);
	// 	return this.get('enrichedAutolinksBySha', `sha:${sha}:${key}`, etag, cacheable);
	// }

	getPullRequestForBranch(
		branch: string,
		remoteOrProvider: RichRemoteProvider | GitRemote<RichRemoteProvider>,
		cacheable: Cacheable<PullRequest>,
	): CacheResult<PullRequest> {
		const cache = 'prByBranch';
		const { key, etag } = getRemoteKeyAndEtag(remoteOrProvider);
		// Wrap the cacheable so we can also add the result to the issuesOrPrsById cache
		return this.get(cache, `branch:${branch}:${key}`, etag, this.wrapPullRequestCacheable(cacheable, key, etag));
	}

	getPullRequestForSha(
		sha: string,
		remoteOrProvider: RichRemoteProvider | GitRemote<RichRemoteProvider>,
		cacheable: Cacheable<PullRequest>,
	): CacheResult<PullRequest> {
		const cache = 'prsBySha';
		const { key, etag } = getRemoteKeyAndEtag(remoteOrProvider);
		// Wrap the cacheable so we can also add the result to the issuesOrPrsById cache
		return this.get(cache, `sha:${sha}:${key}`, etag, this.wrapPullRequestCacheable(cacheable, key, etag));
	}

	getRepositoryDefaultBranch(
		remoteOrProvider: RichRemoteProvider | GitRemote<RichRemoteProvider>,
		cacheable: Cacheable<DefaultBranch>,
	): CacheResult<DefaultBranch> {
		const { key, etag } = getRemoteKeyAndEtag(remoteOrProvider);
		return this.get('defaultBranch', `repo:${key}`, etag, cacheable);
	}

	getRepositoryMetadata(
		remoteOrProvider: RichRemoteProvider | GitRemote<RichRemoteProvider>,
		cacheable: Cacheable<RepositoryMetadata>,
	): CacheResult<RepositoryMetadata> {
		const { key, etag } = getRemoteKeyAndEtag(remoteOrProvider);
		return this.get('repoMetadata', `repo:${key}`, etag, cacheable);
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

			item = { value: value, etag: etag };
		} else {
			item = { value: value, etag: etag, expiresAt: expiresAt ?? getExpiresAt<T>(cache, value) };
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
			return 0; // Never expires
		case 'issuesOrPrsById': {
			if (value == null) return 0; // Never expires

			// Open issues expire after 1 hour, but closed issues expire after 12 hours unless recently updated and then expire in 1 hour

			const issueOrPr = value as CacheValue<'issuesOrPrsById'>;
			if (!issueOrPr.closed) return defaultExpiresAt;

			const updatedAgo = now - (issueOrPr.closedDate ?? issueOrPr.date).getTime();
			return now + (updatedAgo > 14 * 24 * 60 * 60 * 1000 ? 12 : 1) * 60 * 60 * 1000;
		}
		case 'prByBranch':
		case 'prsBySha': {
			if (value == null) return cache === 'prByBranch' ? defaultExpiresAt : 0 /* Never expires */;

			// Open prs expire after 1 hour, but closed/merge prs expire after 12 hours unless recently updated and then expire in 1 hour

			const pr = value as CacheValue<'prsBySha'>;
			if (pr.state === 'opened') return defaultExpiresAt;

			const updatedAgo = now - (pr.closedDate ?? pr.mergedDate ?? pr.date).getTime();
			return now + (updatedAgo > 14 * 24 * 60 * 60 * 1000 ? 12 : 1) * 60 * 60 * 1000;
		}
		// case 'enrichedAutolinksBySha':
		default:
			return value == null ? 0 /* Never expires */ : defaultExpiresAt;
	}
}

function getRemoteKeyAndEtag(remoteOrProvider: RemoteProvider | GitRemote<RichRemoteProvider>) {
	return {
		key: remoteOrProvider.remoteKey,
		etag: remoteOrProvider.hasRichIntegration()
			? `${remoteOrProvider.remoteKey}:${remoteOrProvider.maybeConnected ?? false}`
			: remoteOrProvider.remoteKey,
	};
}
