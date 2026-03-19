import type {
	AutolinkReference,
	CacheableAutolinkReference,
	DynamicAutolinkReference,
} from '@gitlens/git/models/autolink.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import type { MaybePausedResult } from '@gitlens/utils/promise.js';

// Re-export @gitlens/git types that are identical
export type { AutolinkType, AutolinkReferenceType, AutolinkReference } from '@gitlens/git/models/autolink.js';

export type GlCacheableAutolinkReference = CacheableAutolinkReference;

export type GlDynamicAutolinkReference = DynamicAutolinkReference;

export interface Autolink extends Omit<CacheableAutolinkReference, 'id'> {
	provider?: ProviderReference;
	id: string;
}

export type EnrichedAutolink = [
	issueOrPullRequest: Promise<IssueOrPullRequest | undefined> | undefined,
	autolink: Autolink,
];

export type MaybeEnrichedAutolink = readonly [
	issueOrPullRequest: MaybePausedResult<IssueOrPullRequest | undefined> | undefined,
	autolink: Autolink,
];

export type RefSet = [
	ProviderReference | undefined,
	(AutolinkReference | DynamicAutolinkReference)[] | CacheableAutolinkReference[],
];
