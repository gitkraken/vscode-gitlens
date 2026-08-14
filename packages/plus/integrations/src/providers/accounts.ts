import type { Account as ProviderAccount } from '@gitkraken/provider-apis';
import type { IssueMember } from '@gitlens/git/models/issue.js';
import type { PullRequestMember } from '@gitlens/git/models/pullRequest.js';

export function toProviderAccount(account: PullRequestMember | IssueMember): ProviderAccount {
	return {
		// Stays the provider id because the categorizer matches the viewer to a pull request's people by `id`,
		// and every provider but GitHub already agrees on that namespace. Re-keying to the login breaks Azure,
		// whose account `username` is a display name while its members' is a UPN — different namespaces.
		id: account.id ?? null,
		avatarUrl: account.avatarUrl ?? null,
		name: account.name ?? null,
		url: account.url ?? null,
		// TODO: Implement these in our own model
		email: '',
		username: account.name ?? null,
	};
}

export function fromProviderAccount(account: ProviderAccount | null): PullRequestMember | IssueMember {
	return {
		id: account?.id ?? '',
		// An absent name stays absent. `'unknown'` was a display fallback invented in the provider layer, and a
		// consumer couldn't tell it apart from a member genuinely named that — so it couldn't be undone where a
		// name-shaped placeholder is wrong (rendering an avatar-only chip, or building an AI prompt, where
		// `Assignees: unknown` reads as a real assignee). It also disagreed with {@link toIssueShape}, which
		// collapsed the same absent name to `''` — same facade method, two fallbacks. Both now emit `undefined`.
		name: account?.name ?? undefined,
		username: account?.username ?? undefined,
		avatarUrl: account?.avatarUrl ?? undefined,
		// `url` is optional, so an absent one must be `undefined`, not `''`. `''` passes a `!= null` presence
		// check and renders as a link to nowhere, and it disagreed with {@link toIssueShape} — which already
		// collapses to `undefined` — even though BOTH mappers feed `listIssuesPage` (the repo-scoped path goes
		// through `toIssueShape`, Azure's account-wide path through {@link fromProviderIssue}). Same facade
		// method, two shapes. Matches {@link toProviderRepositoryShape}, which collapses every absent optional.
		url: account?.url ?? undefined,
	};
}
