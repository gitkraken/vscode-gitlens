import * as assert from 'assert';
import * as sinon from 'sinon';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import { Git } from '../../exec/git.js';
import type { GitOptions } from '../../exec/git.js';
import { getProbeFailureMessage, getProbeFailureReason, RemotesGitSubProvider } from '../remotes.js';

suite('RemotesGitSubProvider.probeRemote environment', () => {
	async function probeEnv(options: GitOptions): Promise<Record<string, string | undefined>> {
		const git = new Git(() => Promise.resolve({ path: '/nonexistent/git-binary', version: '2.40.0' }), options);
		try {
			const run = sinon.stub(git, 'run').resolves({
				stdout: '',
				stderr: undefined,
				exitCode: 0,
				completion: { status: 'exited', code: 0 },
			} satisfies GitResult);
			const provider = new RemotesGitSubProvider(
				{ hooks: {} } as unknown as GitServiceContext,
				git,
				{} as never,
				{} as unknown as CliGitProviderInternal,
			);
			await provider.probeRemote('/repos/a', 'ssh://host/r.git');
			return run.firstCall.args[0].env as Record<string, string | undefined>;
		} finally {
			sinon.restore();
			git.dispose();
		}
	}

	test('keeps the askpass defaults without a host quiet-network environment', async () => {
		assert.deepStrictEqual(await probeEnv({}), {
			GIT_ASKPASS: '',
			GIT_TERMINAL_PROMPT: '0',
			GCM_INTERACTIVE: 'NEVER',
			SSH_ASKPASS: '',
		});
	});

	test('lets the host replace SSH_ASKPASS while the other quiet keys stay', async () => {
		const env = await probeEnv({
			getQuietNetworkEnvironment: () => ({
				SSH_ASKPASS: '/host/askpass',
				SSH_ASKPASS_REQUIRE: 'force',
				GIT_ASKPASS: 'x',
			}),
		});
		assert.deepStrictEqual(env, {
			GIT_ASKPASS: '',
			GIT_TERMINAL_PROMPT: '0',
			GCM_INTERACTIVE: 'NEVER',
			SSH_ASKPASS: '/host/askpass',
			SSH_ASKPASS_REQUIRE: 'force',
		});
	});
});

suite('getProbeFailureReason', () => {
	const cases: [stderr: string, expected: ReturnType<typeof getProbeFailureReason>][] = [
		["fatal: unable to access 'https://nope.invalid/r.git/': Could not resolve host: nope.invalid", 'hostNotFound'],
		['ssh: Could not resolve hostname nope.invalid: nodename nor servname provided, or not known', 'hostNotFound'],
		["fatal: could not read Username for 'https://github.com': terminal prompts disabled", 'authRequired'],
		['fatal: terminal prompts disabled', 'authRequired'],
		[
			'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
			'authRequired',
		],
		["fatal: unable to access 'https://host/r.git/': The requested URL returned error: 403", 'authRequired'],
		["fatal: unable to access 'https://host/r.git/': The requested URL returned error: 401", 'authRequired'],
		['Host key verification failed.\nfatal: Could not read from remote repository.', 'hostKeyUnverified'],
		["remote: Repository not found.\nfatal: repository 'https://host/r.git/' not found", 'notFound'],
		["fatal: '/tmp/nope' does not appear to be a git repository", 'notFound'],
		["fatal: unable to access 'https://host/r.git/': The requested URL returned error: 404", 'notFound'],
		["fatal: unable to access 'https://host/403/project.git/': SSL certificate problem", 'other'],
		['fatal: something unexpected happened', 'other'],
		['', 'other'],
	];

	for (const [stderr, expected] of cases) {
		test(`${JSON.stringify(stderr)} → ${expected}`, () => {
			assert.strictEqual(getProbeFailureReason(stderr), expected);
		});
	}
});

suite('getProbeFailureMessage', () => {
	test('returns the last fatal line without its prefix', () => {
		assert.strictEqual(
			getProbeFailureMessage('warning: first\nfatal: one\nremote: noise\nfatal:   two  \n'),
			'two',
		);
	});

	test('falls back to the last non-empty line', () => {
		assert.strictEqual(getProbeFailureMessage('error: one\r\nerror: two\r\n\r\n'), 'error: two');
	});

	test('prefers the host message over the generic SSH trailer', () => {
		assert.strictEqual(
			getProbeFailureMessage(
				"GitLab: The project you were looking for could not be found or you don't have permission to view it.\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.\n",
			),
			"GitLab: The project you were looking for could not be found or you don't have permission to view it.",
		);
		assert.strictEqual(
			getProbeFailureMessage(
				'ERROR: Repository not found.\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.',
			),
			'ERROR: Repository not found.',
		);
	});

	test('falls back to the generic SSH trailer when nothing else remains', () => {
		assert.strictEqual(
			getProbeFailureMessage(
				'fatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.',
			),
			'Could not read from remote repository.',
		);
	});

	test('returns the HTTPS fatal line', () => {
		assert.strictEqual(
			getProbeFailureMessage(
				"fatal: unable to access 'https://nope.invalid/r.git/': Could not resolve host: nope.invalid",
			),
			"unable to access 'https://nope.invalid/r.git/': Could not resolve host: nope.invalid",
		);
	});

	test('returns undefined for empty stderr', () => {
		assert.strictEqual(getProbeFailureMessage(''), undefined);
		assert.strictEqual(getProbeFailureMessage('  \n\n'), undefined);
	});
});
