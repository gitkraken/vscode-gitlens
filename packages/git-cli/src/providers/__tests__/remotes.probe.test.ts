import * as assert from 'assert';
import { getProbeFailureMessage, getProbeFailureReason } from '../remotes.js';

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
