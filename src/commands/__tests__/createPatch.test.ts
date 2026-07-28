import * as assert from 'assert';
import * as sinon from 'sinon';
import type { Uri } from 'vscode';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { ScmResource } from '../../@types/vscode.git.resources.d.js';
import { ScmResourceGroupType, ScmStatus } from '../../@types/vscode.git.resources.enums.js';
import type { Container } from '../../container.js';
import type { CommandScmStatesContext } from '../commandContext.js';
import { getCreatePatchArgsForScmStates } from '../patches.js';

function createMockContainer(): Container {
	return {
		git: { getOrAddRepository: sinon.stub().resolves({ path: '/mock/repo' }) },
	} as unknown as Container;
}

/** `Uri.parse` round-trips these in the builder, so the mock must produce a parseable `toString()`. */
function createMockUri(path: string): Uri {
	return { fsPath: path, scheme: 'file', toString: () => `file://${path}` } as unknown as Uri;
}

function createMockScmResource(opts: {
	path: string;
	originalPath?: string;
	type?: ScmStatus;
	resourceGroupType?: ScmResourceGroupType;
}): ScmResource {
	return {
		resourceUri: createMockUri(opts.path),
		original: createMockUri(opts.originalPath ?? opts.path),
		type: opts.type,
		resourceGroupType: opts.resourceGroupType,
	};
}

function createMockContext(resources: ScmResource[]): CommandScmStatesContext {
	return { type: 'scm-states', scmResourceStates: resources } as unknown as CommandScmStatesContext;
}

function paths(uris: (string | Uri)[] | undefined): string[] {
	return (uris ?? []).map(u => (typeof u === 'string' ? u : u.toString()));
}

suite('getCreatePatchArgsForScmStates Test Suite', () => {
	test('a staged rename contributes BOTH of its paths to the pathspec', async () => {
		const args = await getCreatePatchArgsForScmStates(
			createMockContainer(),
			createMockContext([
				createMockScmResource({
					path: '/mock/repo/new.ts',
					originalPath: '/mock/repo/old.ts',
					type: ScmStatus.INDEX_RENAMED,
					resourceGroupType: ScmResourceGroupType.Index,
				}),
			]),
		);

		assert.deepStrictEqual(paths(args.uris).sort(), ['file:///mock/repo/new.ts', 'file:///mock/repo/old.ts']);
		assert.strictEqual(args.to, uncommittedStaged);
	});

	test('a staged COPY contributes only its target — the source still exists', async () => {
		const args = await getCreatePatchArgsForScmStates(
			createMockContainer(),
			createMockContext([
				createMockScmResource({
					path: '/mock/repo/copy.ts',
					originalPath: '/mock/repo/src.ts',
					type: ScmStatus.INDEX_COPIED,
					resourceGroupType: ScmResourceGroupType.Index,
				}),
			]),
		);

		assert.deepStrictEqual(paths(args.uris), ['file:///mock/repo/copy.ts']);
	});

	test('a non-rename resource does not duplicate its path', async () => {
		const args = await getCreatePatchArgsForScmStates(
			createMockContainer(),
			createMockContext([
				createMockScmResource({
					path: '/mock/repo/a.ts',
					type: ScmStatus.INDEX_MODIFIED,
					resourceGroupType: ScmResourceGroupType.Index,
				}),
			]),
		);

		assert.deepStrictEqual(paths(args.uris), ['file:///mock/repo/a.ts']);
	});

	test('an index-only selection diffs HEAD<->index and names no ref', async () => {
		const args = await getCreatePatchArgsForScmStates(
			createMockContainer(),
			createMockContext([
				createMockScmResource({
					path: '/mock/repo/a.ts',
					type: ScmStatus.INDEX_MODIFIED,
					resourceGroupType: ScmResourceGroupType.Index,
				}),
			]),
		);

		assert.strictEqual(args.to, uncommittedStaged);
		// `--staged` already implies HEAD; naming it would break on an unborn HEAD.
		assert.strictEqual(args.from, undefined);
	});

	test('a working-tree-only selection stays index<->working', async () => {
		const args = await getCreatePatchArgsForScmStates(
			createMockContainer(),
			createMockContext([
				createMockScmResource({
					path: '/mock/repo/a.ts',
					type: ScmStatus.MODIFIED,
					resourceGroupType: ScmResourceGroupType.WorkingTree,
				}),
			]),
		);

		assert.strictEqual(args.to, uncommitted);
		assert.strictEqual(args.from, undefined);
	});

	test('a selection spanning both groups diffs HEAD<->working so the staged half survives', async () => {
		const args = await getCreatePatchArgsForScmStates(
			createMockContainer(),
			createMockContext([
				createMockScmResource({
					path: '/mock/repo/staged.ts',
					type: ScmStatus.INDEX_MODIFIED,
					resourceGroupType: ScmResourceGroupType.Index,
				}),
				createMockScmResource({
					path: '/mock/repo/dirty.ts',
					type: ScmStatus.MODIFIED,
					resourceGroupType: ScmResourceGroupType.WorkingTree,
				}),
			]),
		);

		assert.strictEqual(args.to, uncommitted);
		assert.strictEqual(args.from, 'HEAD');
	});

	test('an untracked resource sets includeUntracked', async () => {
		const args = await getCreatePatchArgsForScmStates(
			createMockContainer(),
			createMockContext([
				createMockScmResource({
					path: '/mock/repo/new.ts',
					type: ScmStatus.UNTRACKED,
					resourceGroupType: ScmResourceGroupType.WorkingTree,
				}),
			]),
		);

		assert.strictEqual(args.includeUntracked, true);
	});
});
