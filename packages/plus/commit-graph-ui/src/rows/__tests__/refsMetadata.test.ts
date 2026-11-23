import * as assert from 'assert';
import type { CommitGraphRef } from '../../contracts/rows.js';
import type { GraphRefMetadataType } from '../../contracts/state.js';
import { collectMissingRefsMetadata, rowShasForRefsMetadata } from '../refsMetadata.js';

type Ref = Pick<CommitGraphRef, 'kind' | 'id' | 'upstreamId'>;

const rows = Array.from({ length: 100 }, (_, i) => ({ sha: `sha${i}` }));
const refsBySha = new Map<string, Ref[]>(
	rows.map(({ sha }, i) => [sha, [{ kind: 'head', id: `branch${i}`, upstreamId: `origin/branch${i}` }]]),
);
const refsOf = (sha: string): Ref[] | undefined => refsBySha.get(sha);

suite('collectMissingRefsMetadata', () => {
	test('asks only for refs on the rendered rows, and asks for a ref scrolled into view once', () => {
		const requested = new Map<string, Set<GraphRefMetadataType>>();
		const scan = (first: number, last: number) =>
			collectMissingRefsMetadata({
				rows: rows,
				first: first,
				last: last,
				refsOf: refsOf,
				types: ['pullRequest'],
				metadata: {},
				requested: requested,
				trackingLocalId: () => undefined,
			});

		assert.deepStrictEqual(scan(10, 12), {
			branch10: ['pullRequest'],
			branch11: ['pullRequest'],
			branch12: ['pullRequest'],
		});
		assert.deepStrictEqual(scan(11, 13), { branch13: ['pullRequest'] });
		assert.strictEqual(scan(10, 13), undefined);
	});
});

suite('collectMissingRefsMetadata pull request rows', () => {
	test('the loaded range asks for pull requests on off-screen refs; the rendered range does not', () => {
		const scan = (pullRequestRows: readonly { sha: string }[] | undefined) =>
			collectMissingRefsMetadata({
				rows: rows,
				first: 0,
				last: 1,
				refsOf: refsOf,
				types: ['pullRequest', 'upstream'],
				metadata: {},
				requested: new Map(),
				trackingLocalId: () => undefined,
				pullRequestRows: pullRequestRows,
			});

		const rendered = scan(undefined);
		assert.deepStrictEqual(Object.keys(rendered ?? {}), ['branch0', 'branch1']);

		const loaded = scan(rows);
		assert.deepStrictEqual(loaded?.branch1, ['pullRequest', 'upstream']);
		assert.deepStrictEqual(loaded?.branch99, ['pullRequest']);
		assert.strictEqual(Object.keys(loaded ?? {}).length, 100);
	});
});

suite('rowShasForRefsMetadata', () => {
	test('an answer for one branch touches its row and its upstream row only', () => {
		const refRowIndex = new Map([
			['branch1', { sha: 'local' }],
			['origin/branch1', { sha: 'remote' }],
			['branch2', { sha: 'other' }],
		]);
		const refs = new Map<string, Ref[]>([
			['local', [{ kind: 'head', id: 'branch1', upstreamId: 'origin/branch1' }]],
			['remote', [{ kind: 'remote', id: 'origin/branch1' }]],
			['other', [{ kind: 'head', id: 'branch2' }]],
		]);

		assert.deepStrictEqual([...rowShasForRefsMetadata(['branch1'], refRowIndex, sha => refs.get(sha))].sort(), [
			'local',
			'remote',
		]);
	});
});
