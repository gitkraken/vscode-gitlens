import type { Disposable } from '@gitlens/utils/disposable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { IntegrationServiceContext } from '../context.js';
import type { AzureDevOpsApi } from './azure/azure.js';
import type { BitbucketApi } from './bitbucket/bitbucket.js';
import type { GitHubApi } from './github/github.js';
import type { GitLabApi } from './gitlab/gitlab.js';

/**
 * The per-provider API clients, owned and built by the package. `GitLabApi`/`BitbucketApi`/`AzureDevOpsApi`
 * live in the package; `GitHubApi` comes from `@gitlens/git-github` (shared with the host's GitHub git
 * provider, which reads the manager's memoized instance via `manager.github`). `undefined` is tolerated for
 * offline/limited runtimes.
 */
export interface ApiClients {
	readonly github: Promise<GitHubApi | undefined>;
	readonly gitlab: Promise<GitLabApi | undefined>;
	readonly bitbucket: Promise<BitbucketApi | undefined>;
	readonly azure: Promise<AzureDevOpsApi | undefined>;
}

/**
 * Lazily constructs + memoizes the API clients from the runtime context, pushing each to `disposables` for
 * teardown. Mirrors the lazy-chunked construction the host's `Container` did before the package took
 * ownership (the host used to build these and inject them back through the context — a pure round-trip).
 */
export function createApiClients(ctx: IntegrationServiceContext, disposables: Disposable[]): ApiClients {
	let github: Promise<GitHubApi | undefined> | undefined;
	let gitlab: Promise<GitLabApi | undefined> | undefined;
	let bitbucket: Promise<BitbucketApi | undefined> | undefined;
	let azure: Promise<AzureDevOpsApi | undefined> | undefined;

	const build = async <T extends Disposable>(load: () => Promise<T>): Promise<T | undefined> => {
		const scope = getScopedLogger();
		try {
			const api = await load();
			disposables.push(api);
			return api;
		} catch (ex) {
			scope?.error(ex, 'Failed to construct integration API client');
			return undefined;
		}
	};

	return {
		get github() {
			return (github ??= build(async () =>
				(await import(/* webpackChunkName: "integrations" */ './github/github.js')).createGitHubApi(ctx),
			));
		},
		get gitlab() {
			return (gitlab ??= build(async () =>
				(await import(/* webpackChunkName: "integrations" */ './gitlab/gitlab.js')).createGitLabApi(ctx),
			));
		},
		get bitbucket() {
			return (bitbucket ??= build(async () =>
				(await import(/* webpackChunkName: "integrations" */ './bitbucket/bitbucket.js')).createBitbucketApi(
					ctx,
				),
			));
		},
		get azure() {
			return (azure ??= build(async () =>
				(await import(/* webpackChunkName: "integrations" */ './azure/azure.js')).createAzureDevOpsApi(ctx),
			));
		},
	};
}
