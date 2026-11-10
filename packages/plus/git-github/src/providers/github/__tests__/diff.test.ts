import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitHubGitProviderInternal } from '../../githubProvider.js';
import { DiffGitSubProvider } from '../diff.js';

interface ComparisonFile {
	filename: string;
	previous_filename?: string;
	status: string;
	additions: number;
	deletions: number;
	changes: number;
}

function file(filename: string, status: string = 'modified', previous_filename?: string): ComparisonFile {
	return {
		filename: filename,
		previous_filename: previous_filename,
		status: status,
		additions: 1,
		deletions: 0,
		changes: 1,
	};
}

function createSubProvider(files: ComparisonFile[]): { diff: DiffGitSubProvider; calls: () => number } {
	let calls = 0;
	const context = {
		metadata: { repo: { owner: 'owner', name: 'repo' } },
		github: {
			getComparison: () => {
				calls++;
				return Promise.resolve({ files: files });
			},
		},
		session: { accessToken: 'token', cloud: false, type: undefined, scopes: [] },
	};
	const provider = {
		authenticationProviderId: 'github',
		ensureRepositoryContext: () => Promise.resolve(context),
	} as unknown as GitHubGitProviderInternal;

	return { diff: new DiffGitSubProvider({} as unknown as Cache, provider), calls: () => calls };
}

suite('GitHub getDiffStatus paths Test Suite', () => {
	const files = [
		file('src/a.ts'),
		file('src/deep/b.ts'),
		file('docs/readme.md'),
		file('lib/new.ts', 'renamed', 'old/old.ts'),
	];

	test('resolves undefined for an empty list without calling the API', async () => {
		const { diff, calls } = createSubProvider(files);

		const result = await diff.getDiffStatus('/repo', 'main', 'feature', { paths: [] });

		assert.strictEqual(result, undefined);
		assert.strictEqual(calls(), 0);
	});

	test('keeps only the files under the paths, at any depth', async () => {
		const { diff } = createSubProvider(files);

		const result = await diff.getDiffStatus('/repo', 'main', 'feature', { paths: ['src', 'docs/readme.md'] });

		assert.deepStrictEqual(
			result?.map(f => f.path),
			['src/a.ts', 'src/deep/b.ts', 'docs/readme.md'],
		);
	});

	test('keeps a rename when only its old side is among the paths', async () => {
		const { diff } = createSubProvider(files);

		const result = await diff.getDiffStatus('/repo', 'main', 'feature', { paths: ['old'] });

		assert.deepStrictEqual(
			result?.map(f => f.path),
			['lib/new.ts'],
		);
	});

	test('keeps a rename when only its new side is among the paths', async () => {
		const { diff } = createSubProvider(files);

		const result = await diff.getDiffStatus('/repo', 'main', 'feature', { paths: ['lib'] });

		assert.deepStrictEqual(
			result?.map(f => f.path),
			['lib/new.ts'],
		);
	});

	test('returns every file when no paths are given', async () => {
		const { diff } = createSubProvider(files);

		const result = await diff.getDiffStatus('/repo', 'main', 'feature');

		assert.strictEqual(result?.length, files.length);
	});
});
