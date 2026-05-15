import * as assert from 'assert';
import * as sinon from 'sinon';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import { resolveBranchRemote } from '../branchRemote.js';

suite('resolveBranchRemote Test Suite', () => {
	function localRef(name: string, upstream: { name: string; remote?: string; local?: boolean }): GitBranchReference {
		return createReference(name, '/repo', {
			refType: 'branch',
			name: name,
			remote: false,
			upstream: { ...upstream, missing: false },
		});
	}

	function providerWith(remoteNames: string[], fresh?: GitBranchReference) {
		const getRemotes = sinon.stub().resolves(remoteNames.map(name => ({ name: name })));
		const getBranch = sinon.stub().resolves(fresh);
		return {
			provider: { remotes: { getRemotes: getRemotes }, branches: { getBranch: getBranch } } as unknown as Pick<
				CliGitProviderInternal,
				'remotes' | 'branches'
			>,
			getRemotes: getRemotes,
			getBranch: getBranch,
		};
	}

	function handBuilt(name: string): GitBranchReference {
		return createReference(name, '/repo', {
			refType: 'branch',
			name: name,
			remote: false,
			upstream: { name: 'release/2.0', missing: false },
		});
	}

	test('a local upstream has no remote and reads no remotes', async () => {
		const { provider, getRemotes } = providerWith(['origin', 'release']);
		const result = await resolveBranchRemote(
			provider,
			'/repo',
			localRef('feature', { name: 'release/2.0', local: true }),
		);
		assert.strictEqual(result.remote, undefined);
		assert.strictEqual(result.upstream, 'release/2.0');
		assert.strictEqual(getRemotes.callCount, 0);
	});

	test('a remote upstream matching a remote is kept', async () => {
		const { provider } = providerWith(['origin']);
		const result = await resolveBranchRemote(
			provider,
			'/repo',
			localRef('feature', { name: 'origin/release/2.0' }),
		);
		assert.strictEqual(result.remote, 'origin');
		assert.strictEqual(result.upstream, 'release/2.0');
	});

	test('a remote reported by git is kept when the repository still has it', async () => {
		const { provider, getRemotes } = providerWith(['origin']);
		const result = await resolveBranchRemote(
			provider,
			'/repo',
			localRef('feature', { name: 'origin/release/2.0', remote: 'origin' }),
		);
		assert.strictEqual(result.remote, 'origin');
		assert.strictEqual(result.upstream, 'release/2.0');
		assert.strictEqual(getRemotes.callCount, 1);
	});

	test('a remote reported by git that the repository no longer has is dropped', async () => {
		const { provider, getRemotes } = providerWith(['origin']);
		const result = await resolveBranchRemote(
			provider,
			'/repo',
			localRef('feature', { name: 'release/feature', remote: 'release' }),
		);
		assert.strictEqual(result.remote, undefined);
		assert.strictEqual(getRemotes.callCount, 1);
	});

	test('a remote inferred from the upstream name that the repository no longer has is dropped', async () => {
		const { provider } = providerWith(['origin']);
		const result = await resolveBranchRemote(provider, '/repo', localRef('feature', { name: 'gone/feature' }));
		assert.strictEqual(result.remote, undefined);
	});

	test('a reported remote is dropped when the remote list is empty', async () => {
		const { provider } = providerWith([]);
		const result = await resolveBranchRemote(
			provider,
			'/repo',
			localRef('feature', { name: 'origin/feature', remote: 'origin' }),
		);
		assert.strictEqual(result.remote, undefined);
	});

	test('a remote-tracking reference is not checked against the remote list', async () => {
		const { provider } = providerWith(['origin']);
		const result = await resolveBranchRemote(
			provider,
			'/repo',
			createReference('gone/feature', '/repo', { refType: 'branch', name: 'gone/feature', remote: true }),
		);
		assert.strictEqual(result.remote, 'gone');
		assert.strictEqual(result.name, 'feature');
	});

	// #4950: the Graph's remote refs carry the remote's own name in `upstream`
	test("a remote-tracking reference has no upstream, even carrying the Graph's remote name in it", async () => {
		const graphRef = (name: string, remote: string) =>
			createReference(name, '/repo', {
				refType: 'branch',
				name: name,
				remote: true,
				upstream: { name: remote, missing: false },
			});

		const { provider } = providerWith(['upstream', 'team', 'team/fork']);
		assert.deepStrictEqual(await resolveBranchRemote(provider, '/repo', graphRef('upstream/main', 'upstream')), {
			name: 'main',
			remote: 'upstream',
			upstream: undefined,
			local: false,
		});

		const nested = await resolveBranchRemote(provider, '/repo', graphRef('team/fork/main', 'team/fork'));
		assert.strictEqual(nested.remote, 'team/fork');
		assert.strictEqual(nested.name, 'main');
		assert.strictEqual(nested.upstream, undefined);
	});

	test('a reference carrying neither local nor remote is looked up, and a fresh local upstream has no remote', async () => {
		const { provider, getRemotes, getBranch } = providerWith(
			['origin', 'release'],
			localRef('feature', { name: 'release/2.0', local: true }),
		);
		const result = await resolveBranchRemote(provider, '/repo', handBuilt('feature'));
		assert.strictEqual(getBranch.callCount, 1);
		assert.strictEqual(result.remote, undefined);
		assert.strictEqual(result.local, true);
		assert.strictEqual(result.upstream, 'release/2.0');
		assert.strictEqual(getRemotes.callCount, 0);
	});

	test('a reference carrying neither local nor remote takes the remote of the fresh branch', async () => {
		const { provider } = providerWith(
			['origin'],
			localRef('feature', { name: 'origin/feature', remote: 'origin' }),
		);
		const result = await resolveBranchRemote(provider, '/repo', handBuilt('feature'));
		assert.strictEqual(result.remote, 'origin');
		assert.strictEqual(result.local, false);
		assert.strictEqual(result.upstream, 'feature');
	});

	test('a reference already carrying remote or local is not looked up', async () => {
		const { provider, getBranch } = providerWith(['origin']);
		await resolveBranchRemote(provider, '/repo', localRef('feature', { name: 'origin/feature', remote: 'origin' }));
		await resolveBranchRemote(provider, '/repo', localRef('feature', { name: 'release/2.0', local: true }));
		assert.strictEqual(getBranch.callCount, 0);
	});

	test('a reference whose branch is gone keeps the name-split fallback', async () => {
		const { provider, getBranch } = providerWith(['release']);
		const result = await resolveBranchRemote(provider, '/repo', handBuilt('feature'));
		assert.strictEqual(getBranch.callCount, 1);
		assert.strictEqual(result.remote, 'release');
		assert.strictEqual(result.upstream, '2.0');
		assert.strictEqual(result.local, false);
	});
});
