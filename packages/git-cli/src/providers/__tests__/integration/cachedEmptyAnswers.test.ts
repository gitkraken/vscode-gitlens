import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogChannel } from '@gitlens/utils/logger.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import { createProvider } from './helpers.js';

/**
 * A repository with no commits, refs, remotes or contributors answers each of these reads with nothing, and that
 * answer is real: a repeat read is served from the cache rather than launching git again. Each finished git
 * process logs one `… • completed` line through `gitOptions.logger`.
 */
suite('Genuinely empty answers are cached', () => {
	let dir: string;
	let provider: CliGitProvider;
	const completed: string[] = [];

	const countingLogger: LogChannel = {
		name: 'spawn-counter',
		logLevel: 0,
		dispose: () => {},
		trace: () => {},
		debug: () => {},
		info: (msg: string) => {
			if (msg.includes('• completed')) {
				completed.push(msg);
			}
		},
		warn: () => {},
		error: () => {},
	};

	suiteSetup(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), 'gitlens-empty-')));
		execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'pipe' });
		provider = createProvider({ gitOptions: { logger: countingLogger } });
	});

	suiteTeardown(() => {
		provider.dispose();
		rmSync(dir, { recursive: true, force: true });
	});

	async function launchesDuring(read: () => Promise<unknown>): Promise<number> {
		const mark = completed.length;
		await read();
		return completed.length - mark;
	}

	test('an unborn HEAD has no initial commit and is read once', async () => {
		assert.ok((await launchesDuring(() => provider.commits.getInitialCommitSha(dir))) > 0);
		assert.strictEqual(await provider.commits.getInitialCommitSha(dir), undefined);
		assert.strictEqual(await launchesDuring(() => provider.commits.getInitialCommitSha(dir)), 0);
	});

	test('a repository with no refs has no tags or ref tips and is read once', async () => {
		assert.ok((await launchesDuring(() => provider.tags.getTags(dir))) > 0);
		assert.deepStrictEqual((await provider.tags.getTags(dir)).values, []);
		assert.deepStrictEqual(await provider.refs.getRefTips(dir), []);

		assert.strictEqual(await launchesDuring(() => provider.tags.getTags(dir)), 0);
		assert.strictEqual(await launchesDuring(() => provider.refs.getRefTips(dir)), 0);
	});

	test('a repository with no remotes has no best remotes and is read once', async () => {
		assert.ok((await launchesDuring(() => provider.remotes.getBestRemotesWithProviders(dir))) > 0);
		assert.deepStrictEqual(await provider.remotes.getBestRemotesWithProviders(dir), []);
		assert.strictEqual(await launchesDuring(() => provider.remotes.getBestRemotesWithProviders(dir)), 0);
	});

	test('a repository with no commits has no contributor stats and is read once', async () => {
		assert.ok((await launchesDuring(() => provider.contributors.getContributorsStats(dir))) > 0);
		assert.strictEqual(await provider.contributors.getContributorsStats(dir), undefined);
		assert.strictEqual(await launchesDuring(() => provider.contributors.getContributorsStats(dir)), 0);
	});

	test('a user read from a successful config read is read once', async () => {
		assert.ok((await launchesDuring(() => provider.config.getCurrentUser(dir))) > 0);
		const first = await provider.config.getCurrentUser(dir);
		assert.strictEqual(await launchesDuring(() => provider.config.getCurrentUser(dir)), 0);
		assert.deepStrictEqual(await provider.config.getCurrentUser(dir), first);
	});
});
