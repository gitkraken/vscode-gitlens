import type { IntegrationIds } from '@gitlens/integrations/constants.js';
import type { KeplerChannel } from './keplerService.js';

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

/**
 * The channel's product name — the macOS bundle name, the Linux install dir and the userData dir
 * all derive from it. Mirrors `getChannelProductName` in the Kepler repo:
 * `scripts/_product-name.mjs#getChannelProductName`. Kepler's own fallback for an unknown channel
 * is not mirrored because `KeplerChannel` is closed.
 */
export function getKeplerProductName(channel: KeplerChannel): string {
	switch (channel) {
		case 'production':
			return 'Kepler';
		case 'staging':
			return 'Kepler (staging)';
		case 'dev':
			return 'Kepler (dev)';
		case 'source':
			return 'Kepler (source)';
	}
}

/**
 * The channel's package name (`extraMetadata.name`). Mirrors `getChannelPackageName` in the Kepler
 * repo: `scripts/_channel-identity.mjs#getChannelPackageName`.
 */
export function getKeplerPackageName(channel: KeplerChannel): string {
	return channel === 'production' ? 'kepler' : `kepler-${channel}`;
}

export interface KeplerInstallEnvironment {
	/** The user's home directory; empty when unknown */
	readonly home: string;
	/** `%LOCALAPPDATA%` on Windows; undefined when unset */
	readonly localAppData: string | undefined;
}

/**
 * Where an installed Kepler of the given channel lives on disk, most likely first. Pure — the
 * platform and environment are parameters — and builds each path with that platform's own
 * separator rather than `node:path`, whose separator is the host's. Spaces and parentheses in the
 * product name are literal: electron-builder's `sanitizedProductName` keeps them.
 *
 * - macOS: the bundle is `<productName>.app`. The DMG is drag-to-install, so a per-user
 *   `~/Applications` is probed alongside `/Applications`.
 * - Windows: the NSIS installer is one-click and per-user (neither `oneClick` nor `perMachine` is
 *   set in Kepler's `electron-builder.yml`), so there is no Program Files install. For that mode
 *   electron-builder names the dir from the package name, not the product name
 *   (`getWindowsInstallationDirName` in `app-builder-lib/out/targets/targetUtil.js`), which
 *   contradicts Kepler's own comment on `getChannelWindowsExecutableName` — so both are probed.
 * - Linux: deb/rpm unpack to `/opt/<productName>`. Mirrors `getChannelLinuxInstallDir` in
 *   `scripts/_channel-identity.mjs`. AppImage, Snap and Flatpak installs are not detected.
 */
export function getKeplerInstallPaths(
	channel: KeplerChannel,
	platform: string,
	env: KeplerInstallEnvironment,
): string[] {
	const productName = getKeplerProductName(channel);

	switch (platform) {
		case 'darwin': {
			const paths = [`/Applications/${productName}.app`];
			if (env.home) {
				paths.push(`${env.home}/Applications/${productName}.app`);
			}
			return paths;
		}
		case 'win32': {
			if (!env.localAppData) return [];

			const paths = [`${env.localAppData}\\Programs\\${getKeplerPackageName(channel)}`];
			// Windows paths are case-insensitive, so production's two spellings are one path
			if (channel !== 'production') {
				paths.push(`${env.localAppData}\\Programs\\${productName}`);
			}
			return paths;
		}
		case 'linux':
			return [`/opt/${productName}`];
		default:
			return [];
	}
}
