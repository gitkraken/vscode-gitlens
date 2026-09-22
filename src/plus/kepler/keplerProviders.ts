import type { IntegrationIds } from '@gitlens/integrations/constants.js';

// This is the single home for every table mirrored from the Kepler repo (design doc §6.4 — "Drift
// risk — four hand-maintained twins"). Each table below carries a comment naming the exact Kepler
// file and symbol it tracks, so a drift check is one diff rather than a scavenger hunt.

/**
 * Kepler's own provider identifier. Mirrors the `ProviderId` union produced by `PROVIDER_IDS` in
 * the Kepler repo: `src/shared/provider/provider-id.ts#PROVIDER_IDS`.
 */
export type KeplerProviderId =
	| 'azure'
	| 'bitbucket'
	| 'github'
	| 'githubEnterprise'
	| 'gitlab'
	| 'gitlabSelfHosted'
	| 'jira'
	| 'linear'
	| 'trello';

// GitLens `IntegrationIds` (`packages/plus/integrations/src/constants.ts:5-33`) -> Kepler
// `ProviderId`. Mirrors `PROVIDER_IDS` in the Kepler repo: `src/shared/provider/provider-id.ts`.
//
// `bitbucket-server` and `azure-devops-server` are deliberately absent from this map, not merely
// unmapped: Kepler has no support for self-hosted Bitbucket or Azure DevOps at all — no provider
// id, no connection type, no listing capability on Kepler's side. Adding entries for them would be
// two new product integrations, not two strings; see design doc §6.2.
const keplerProviderIds: Readonly<Partial<Record<IntegrationIds, KeplerProviderId>>> = {
	github: 'github',
	'cloud-github-enterprise': 'githubEnterprise',
	gitlab: 'gitlab',
	'cloud-gitlab-self-hosted': 'gitlabSelfHosted',
	bitbucket: 'bitbucket',
	azureDevOps: 'azure',
	jira: 'jira',
	linear: 'linear',
	trello: 'trello',
};

/**
 * Maps a GitLens integration id to the Kepler `ProviderId` it corresponds to.
 *
 * `id` is typed `string`, not `IntegrationIds`: `ProviderReference.id` is `readonly id: string`
 * (`packages/git/src/models/remoteProvider.ts:15-20`), so an arbitrary string can arrive at
 * runtime even though the value is an `IntegrationIds` member when the item came from an
 * integration read. Anything unrecognised — including `bitbucket-server` and
 * `azure-devops-server` — returns `undefined`.
 */
export function getKeplerProviderId(id: string): KeplerProviderId | undefined {
	return keplerProviderIds[id as IntegrationIds];
}

// Mirrors `PR_CAPABLE_PROVIDERS` in the Kepler repo: `src/shared/provider/index.ts`.
const keplerPrCapableProviders: readonly KeplerProviderId[] = [
	'github',
	'githubEnterprise',
	'gitlab',
	'gitlabSelfHosted',
	'azure',
	'bitbucket',
];

// Mirrors `ISSUE_CAPABLE_PROVIDERS` in the Kepler repo: `src/shared/provider/index.ts`.
//
// Note the asymmetry with `keplerPrCapableProviders` above: `bitbucket` is PR-capable but is NOT
// issue-capable — Kepler does not support Bitbucket issues. This is the case in this file most
// likely to be got wrong (design doc §6.2), so it is called out here and in `isKeplerSupportedProvider`.
const keplerIssueCapableProviders: readonly KeplerProviderId[] = [
	'github',
	'githubEnterprise',
	'gitlab',
	'gitlabSelfHosted',
	'azure',
	'jira',
	'linear',
	'trello',
];

/**
 * Gates on Kepler's own capability, not merely on whether the id maps. Call with the Kepler
 * `ProviderId` produced by `getKeplerProviderId` (or `undefined` when it didn't map).
 *
 * `bitbucket` passes for `'pr'` and fails for `'issue'` — see the comment on
 * `keplerIssueCapableProviders` above.
 */
export function isKeplerSupportedProvider(kind: 'pr' | 'issue', providerId: string | undefined): boolean {
	if (providerId == null) return false;

	const capableProviders = kind === 'pr' ? keplerPrCapableProviders : keplerIssueCapableProviders;
	return capableProviders.includes(providerId as KeplerProviderId);
}
