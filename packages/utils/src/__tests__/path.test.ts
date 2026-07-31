import * as assert from 'assert';
import { makeHierarchical } from '../array.js';
import { normalizePath, trimTrailingSlash } from '../path.js';

// Git reports an untracked directory that is itself a repository as a single entry with a trailing
// slash, since it can't recurse past the embedded repository boundary.
const nestedRepo = 'nested-repo/';

suite('path', () => {
	suite('trimTrailingSlash', () => {
		test('trims a single trailing slash', () => {
			assert.strictEqual(trimTrailingSlash(nestedRepo), 'nested-repo');
			assert.strictEqual(trimTrailingSlash('a/b/nested-repo/'), 'a/b/nested-repo');
		});

		test('leaves an ordinary path untouched', () => {
			assert.strictEqual(trimTrailingSlash('src/foo.ts'), 'src/foo.ts');
			assert.strictEqual(trimTrailingSlash('foo.ts'), 'foo.ts');
			assert.strictEqual(trimTrailingSlash(''), '');
		});

		test('preserves a backslash as a literal filename character', () => {
			// Git paths always use `/`, so a backslash is part of a (POSIX-legal) filename. This is the
			// distinction from `normalizePath`, which would rewrite it into a separator.
			assert.strictEqual(trimTrailingSlash('weird\\name.ts'), 'weird\\name.ts');
			assert.strictEqual(trimTrailingSlash('a/weird\\name.ts'), 'a/weird\\name.ts');
			assert.strictEqual(normalizePath('weird\\name.ts'), 'weird/name.ts');
		});

		test('trims only the last of repeated trailing slashes', () => {
			assert.strictEqual(trimTrailingSlash('a//'), 'a/');
		});
	});

	suite('trimTrailingSlash + makeHierarchical', () => {
		const join = (...parts: string[]) => parts.join('/');
		const split = (i: { path: string }) => trimTrailingSlash(i.path).split('/');

		test('yields one leaf for a trailing-slash entry, not a folder with an empty-named child', () => {
			const root = makeHierarchical([{ path: nestedRepo }], split, join, true);

			const children = [...(root.children?.values() ?? [])];
			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].name, 'nested-repo');
			assert.ok(children[0].value != null, 'should carry the entry itself (a leaf)');
			assert.strictEqual(children[0].children, undefined, 'should have no empty-named child');
		});

		test('nests a trailing-slash entry under its folders', () => {
			const root = makeHierarchical([{ path: 'a/b/nested-repo/' }], split, join, false);

			const a = root.children?.get('a');
			const b = a?.children?.get('b');
			const leaf = b?.children?.get('nested-repo');
			assert.ok(leaf != null, 'expected a leaf named nested-repo');
			assert.ok(leaf.value != null);
			assert.strictEqual(leaf.children, undefined);
		});

		test('still splits an ordinary path into folders', () => {
			const root = makeHierarchical([{ path: 'src/foo.ts' }], split, join, false);

			const src = root.children?.get('src');
			assert.ok(src != null);
			assert.strictEqual(src.value, undefined, 'folder node carries no value');
			assert.ok(src.children?.get('foo.ts')?.value != null);
		});

		test('treats a backslash as part of the filename, not a separator', () => {
			const root = makeHierarchical([{ path: 'weird\\name.ts' }], split, join, false);

			const children = [...(root.children?.values() ?? [])];
			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].name, 'weird\\name.ts');
			assert.ok(children[0].value != null);
		});
	});
});
