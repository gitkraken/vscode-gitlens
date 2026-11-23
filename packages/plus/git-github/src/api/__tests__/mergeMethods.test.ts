import assert from 'node:assert';
import { suite, test } from 'mocha';
import { PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { GitHubApiConfig } from '../config.js';
import type { GitHubMergeSettings } from '../github.js';
import { fromGitHubMergeSettings, GitHubApi } from '../github.js';
import type { GitHubTokenInfo } from '../token.js';

const Merge = PullRequestMergeMethod.Merge;
const Squash = PullRequestMergeMethod.Squash;
const Rebase = PullRequestMergeMethod.Rebase;

type Rule = NonNullable<NonNullable<NonNullable<GitHubMergeSettings['ref']>['rules']>['nodes']>[number];

function rule(type: string, enforcement: string | null, parameters: Record<string, unknown> | null = {}): Rule {
	return {
		type: type,
		repositoryRuleset: enforcement != null ? { enforcement: enforcement } : null,
		parameters: parameters,
	};
}

function settings(overrides?: Partial<GitHubMergeSettings>): GitHubMergeSettings {
	return {
		mergeCommitAllowed: true,
		squashMergeAllowed: true,
		rebaseMergeAllowed: true,
		viewerDefaultMergeMethod: 'MERGE',
		ref: { branchProtectionRule: null, rules: { nodes: [] } },
		...overrides,
	};
}

function withRules(nodes: Rule[], overrides?: Partial<GitHubMergeSettings>): GitHubMergeSettings {
	return settings({ ref: { branchProtectionRule: null, rules: { nodes: nodes } }, ...overrides });
}

/**
 * The base branch's merge methods: the repository's settings narrowed by the branch's active rulesets and protection,
 * the viewer's default, and the merge queue's method.
 */
suite('GitHubApi.getMergeMethodsForBranch', () => {
	const provider = {
		id: 'github',
		name: 'GitHub',
		domain: 'github.com',
		icon: 'github',
		getIgnoreSSLErrors: () => false,
		reauthenticate: () => Promise.resolve(),
		trackRequestException: () => {},
	} as unknown as Provider;

	const token: GitHubTokenInfo = {
		providerId: 'github',
		accessToken: 'token',
		microHash: 'hash',
		cloud: true,
		type: undefined,
	};

	function serve(repository: unknown): {
		config: GitHubApiConfig;
		getCalls: () => { query: string; variables: Record<string, unknown> }[];
	} {
		const calls: { query: string; variables: Record<string, unknown> }[] = [];
		const config = {
			isWeb: false,
			wrapForForcedInsecureSSL: (_i: unknown, fn: () => unknown) => fn(),
			fetch: async (_url: unknown, init?: { body?: string }) => {
				const body = JSON.parse(init?.body ?? '{}') as { query?: string; variables?: Record<string, unknown> };
				calls.push({ query: body.query ?? '', variables: body.variables ?? {} });
				return new Response(JSON.stringify({ data: { repository: repository } }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
		} as unknown as GitHubApiConfig;
		return { config: config, getCalls: () => calls };
	}

	test('reads the settings, rules and queue of the branch in one request', async () => {
		const { config, getCalls } = serve(
			withRules([
				rule('MERGE_QUEUE', 'ACTIVE', { mergeMethod: 'SQUASH' }),
				rule('REQUIRED_STATUS_CHECKS', 'ACTIVE', {}),
				rule('PULL_REQUEST', 'ACTIVE', { allowedMergeMethods: ['MERGE', 'SQUASH', 'REBASE'] }),
			]),
		);

		const result = await new GitHubApi(config).getMergeMethodsForBranch(provider, token, 'o', 'a', 'main');

		assert.deepEqual(result, { allowed: [Merge, Squash, Rebase], default: Merge, queue: Squash });
		assert.equal(getCalls().length, 1);
		const { query, variables } = getCalls()[0];
		assert.match(query, /ref\(qualifiedName: \$ref\)/);
		assert.match(query, /viewerDefaultMergeMethod/);
		assert.match(query, /allowedMergeMethods/);
		assert.equal(variables.owner, 'o');
		assert.equal(variables.repo, 'a');
		assert.equal(variables.ref, 'refs/heads/main');
	});

	test('narrows by the linear-history protection and a pull request rule', async () => {
		const { config } = serve({
			mergeCommitAllowed: false,
			squashMergeAllowed: true,
			rebaseMergeAllowed: true,
			viewerDefaultMergeMethod: 'REBASE',
			ref: {
				branchProtectionRule: { requiresLinearHistory: true },
				rules: { nodes: [rule('PULL_REQUEST', 'ACTIVE', { allowedMergeMethods: ['SQUASH', 'REBASE'] })] },
			},
		});

		const result = await new GitHubApi(config).getMergeMethodsForBranch(provider, token, 'o', 'a', 'main');

		assert.deepEqual(result, { allowed: [Squash, Rebase], default: Rebase });
	});

	test('GitHub Enterprise Server answers unknown without a request', async () => {
		const { config, getCalls } = serve(settings());

		const result = await new GitHubApi(config).getMergeMethodsForBranch(provider, token, 'o', 'a', 'main', {
			baseUrl: 'https://ghe.example.com/api/v3',
		});

		assert.equal(result, undefined);
		assert.equal(getCalls().length, 0);
	});

	test('a repository that is not found answers unknown', async () => {
		const { config } = serve(null);

		assert.equal(
			await new GitHubApi(config).getMergeMethodsForBranch(provider, token, 'o', 'a', 'main'),
			undefined,
		);
	});
});

suite('fromGitHubMergeSettings', () => {
	test('a branch that does not exist narrows nothing and has no queue', () => {
		assert.deepEqual(fromGitHubMergeSettings(settings({ ref: null })), {
			allowed: [Merge, Squash, Rebase],
			default: Merge,
		});
		assert.deepEqual(fromGitHubMergeSettings(settings({ ref: null, mergeCommitAllowed: false })), {
			allowed: [Squash, Rebase],
			default: Squash,
		});
	});

	test('no method allowed has no default', () => {
		assert.deepEqual(
			fromGitHubMergeSettings(
				settings({ mergeCommitAllowed: false, squashMergeAllowed: false, rebaseMergeAllowed: false }),
			),
			{ allowed: [] },
		);
	});

	test('a viewer default outside the allowed methods falls back to the first allowed', () => {
		assert.deepEqual(
			fromGitHubMergeSettings(settings({ viewerDefaultMergeMethod: 'MERGE', mergeCommitAllowed: false })),
			{ allowed: [Squash, Rebase], default: Squash },
		);
		assert.deepEqual(fromGitHubMergeSettings(settings({ viewerDefaultMergeMethod: null })), {
			allowed: [Merge, Squash, Rebase],
			default: Merge,
		});
	});

	test('two pull request rules intersect, in the fixed order', () => {
		assert.deepEqual(
			fromGitHubMergeSettings(
				withRules([
					rule('PULL_REQUEST', 'ACTIVE', { allowedMergeMethods: ['REBASE', 'SQUASH'] }),
					rule('PULL_REQUEST', 'ACTIVE', { allowedMergeMethods: ['MERGE', 'REBASE'] }),
				]),
			),
			{ allowed: [Rebase], default: Rebase },
		);
	});

	test('an active required-linear-history rule drops merge', () => {
		assert.deepEqual(fromGitHubMergeSettings(withRules([rule('REQUIRED_LINEAR_HISTORY', 'ACTIVE', null)])), {
			allowed: [Squash, Rebase],
			default: Squash,
		});
	});

	test('rules that are not active, or have no ruleset, are ignored', () => {
		assert.deepEqual(
			fromGitHubMergeSettings(
				withRules([
					null,
					rule('PULL_REQUEST', 'EVALUATE', { allowedMergeMethods: ['REBASE'] }),
					rule('PULL_REQUEST', 'DISABLED', { allowedMergeMethods: ['REBASE'] }),
					rule('PULL_REQUEST', null, { allowedMergeMethods: ['REBASE'] }),
					rule('REQUIRED_LINEAR_HISTORY', 'EVALUATE', null),
					rule('MERGE_QUEUE', 'EVALUATE', { mergeMethod: 'REBASE' }),
					rule('MERGE_QUEUE', 'DISABLED', { mergeMethod: 'REBASE' }),
				]),
			),
			{ allowed: [Merge, Squash, Rebase], default: Merge },
		);
	});

	test('the first active merge queue rule gives the queue method, and an unknown method is ignored', () => {
		assert.deepEqual(
			fromGitHubMergeSettings(
				withRules([
					rule('MERGE_QUEUE', 'ACTIVE', { mergeMethod: 'FAST_FORWARD' }),
					rule('MERGE_QUEUE', 'ACTIVE', { mergeMethod: 'REBASE' }),
					rule('MERGE_QUEUE', 'ACTIVE', { mergeMethod: 'SQUASH' }),
				]),
			),
			{ allowed: [Merge, Squash, Rebase], default: Merge, queue: Rebase },
		);
	});
});
