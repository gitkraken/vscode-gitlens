import * as assert from 'assert';
import type { PathEntry } from '../trie.js';
import { PathEntryTrie, PathTrie, UriEntryTrie, UriTrie, VisitedPathsTrie } from '../trie.js';
import type { Uri } from '../uri.js';
import { fileUri, parseUri } from '../uri.js';

suite('PathEntryTrie', () => {
	let trie: PathEntryTrie<string>;

	setup(() => {
		trie = new PathEntryTrie<string>();
	});

	test('set and get', () => {
		trie.set('foo/bar/baz', 'v1', false);

		const entry = trie.get('foo/bar/baz', false);
		assert.strictEqual(entry?.value, 'v1');
		assert.strictEqual(entry?.path, 'baz');
		assert.strictEqual(entry?.fullPath, 'foo/bar/baz');
	});

	test('set returns true on add, false on update', () => {
		assert.strictEqual(trie.set('a/b', 'first', false), true);
		assert.strictEqual(trie.set('a/b', 'second', false), false);
		assert.strictEqual(trie.get('a/b', false)?.value, 'second');
	});

	test('get returns undefined for missing paths', () => {
		trie.set('a/b', 'v', false);

		assert.strictEqual(trie.get('a/b/c', false), undefined);
		assert.strictEqual(trie.get('a', false), undefined);
		assert.strictEqual(trie.get('x/y', false), undefined);
	});

	test('has', () => {
		trie.set('a/b', 'v', false);

		assert.strictEqual(trie.has('a/b', false), true);
		assert.strictEqual(trie.has('a', false), false);
		assert.strictEqual(trie.has('a/b/c', false), false);
		assert.strictEqual(trie.has('x', false), false);
	});

	test('delete removes entry', () => {
		trie.set('a/b', 'v', false);

		assert.strictEqual(trie.delete('a/b', false), true);
		assert.strictEqual(trie.has('a/b', false), false);
		assert.strictEqual(trie.get('a/b', false), undefined);
	});

	test('delete returns false for missing path', () => {
		assert.strictEqual(trie.delete('x/y', false), false);
	});

	test('delete preserves sibling entries', () => {
		trie.set('a/b', 'v1', false);
		trie.set('a/c', 'v2', false);

		trie.delete('a/b', false);
		assert.strictEqual(trie.has('a/c', false), true);
	});

	test('clear empties the trie', () => {
		trie.set('a/b', 'v1', false);
		trie.set('x/y', 'v2', false);

		trie.clear();

		assert.strictEqual(trie.has('a/b', false), false);
		assert.strictEqual(trie.has('x/y', false), false);
	});

	test('getClosest returns self by default', () => {
		trie.set('a/b', 'parent', false);
		trie.set('a/b/c/d', 'child', false);

		const entry = trie.getClosest('a/b/c/d', false, undefined, false);
		assert.strictEqual(entry?.value, 'child');
	});

	test('getClosest with excludeSelf returns ancestor', () => {
		trie.set('a/b', 'parent', false);
		trie.set('a/b/c/d', 'child', false);

		const entry = trie.getClosest('a/b/c/d', true, undefined, false);
		assert.strictEqual(entry?.value, 'parent');
	});

	test('getClosest for path beyond stored entries returns nearest ancestor', () => {
		trie.set('a/b', 'parent', false);

		const entry = trie.getClosest('a/b/c/d/e', false, undefined, false);
		assert.strictEqual(entry?.value, 'parent');
	});

	test('getClosest returns undefined when no ancestor exists', () => {
		trie.set('a/b', 'v', false);

		assert.strictEqual(trie.getClosest('x/y/z', false, undefined, false), undefined);
	});

	test('getClosest with predicate filters ancestors', () => {
		trie.set('a', 'skip', false);
		trie.set('a/b', 'match', false);
		trie.set('a/b/c', 'leaf', false);

		const entry = trie.getClosest('a/b/c', true, v => v === 'match', false);
		assert.strictEqual(entry?.value, 'match');

		const skipped = trie.getClosest('a/b/c', true, v => v === 'skip', false);
		assert.strictEqual(skipped?.value, 'skip');
	});

	test('getChildren returns direct children with values', () => {
		trie.set('root/a', 'va', false);
		trie.set('root/b', 'vb', false);
		trie.set('root/a/deep', 'vd', false);

		const children = trie.getChildren('root', false);
		assert.strictEqual(children.length, 2);

		const values = children.map(c => c.value).sort();
		assert.deepStrictEqual(values, ['va', 'vb']);
	});

	test('getChildren returns empty for missing path', () => {
		assert.deepStrictEqual(trie.getChildren('x/y', false), []);
	});

	test('getDescendants yields all nested entries', () => {
		trie.set('r/a', 'va', false);
		trie.set('r/b', 'vb', false);
		trie.set('r/a/c', 'vc', false);

		const descendants = [...trie.getDescendants('r', undefined, false)];
		assert.strictEqual(descendants.length, 3);

		const values = descendants.map(d => d.value).sort();
		assert.deepStrictEqual(values, ['va', 'vb', 'vc']);
	});

	test('getDescendants with predicate filters', () => {
		trie.set('r/a', 'yes', false);
		trie.set('r/b', 'no', false);
		trie.set('r/a/c', 'yes', false);

		const descendants = [...trie.getDescendants('r', v => v === 'yes', false)];
		assert.strictEqual(descendants.length, 2);
	});

	test('ignoreCase=true matches case-insensitively', () => {
		trie.set('Foo/Bar', 'v', true);

		assert.strictEqual(trie.has('foo/bar', true), true);
		assert.strictEqual(trie.has('FOO/BAR', true), true);
		assert.strictEqual(trie.get('foo/bar', true)?.value, 'v');
	});

	test('ignoreCase=false is case-sensitive', () => {
		trie.set('Foo/Bar', 'v', false);

		assert.strictEqual(trie.has('Foo/Bar', false), true);
		assert.strictEqual(trie.has('foo/bar', false), false);
	});
});

suite('PathTrie', () => {
	let trie: PathTrie<string>;

	setup(() => {
		trie = new PathTrie<string>();
	});

	test('set/get/has basic operations', () => {
		assert.strictEqual(trie.set('a/b', 'v1', false), true);
		assert.strictEqual(trie.get('a/b', false), 'v1');
		assert.strictEqual(trie.has('a/b', false), true);
		assert.strictEqual(trie.has('a', false), false);
		assert.strictEqual(trie.get('x', false), undefined);
	});

	test('set returns false on update', () => {
		trie.set('a/b', 'first', false);
		assert.strictEqual(trie.set('a/b', 'second', false), false);
		assert.strictEqual(trie.get('a/b', false), 'second');
	});

	test('delete removes entry and returns true', () => {
		trie.set('a/b', 'v', false);
		assert.strictEqual(trie.delete('a/b', false), true);
		assert.strictEqual(trie.has('a/b', false), false);
	});

	test('delete calls dispose on value', () => {
		let disposed = false;
		const value = { dispose: () => (disposed = true) };

		const disposeTrie = new PathTrie<typeof value>();
		disposeTrie.set('a/b', value, false);
		disposeTrie.delete('a/b', false, true);

		assert.strictEqual(disposed, true);
	});

	test('delete with dispose=false does not call dispose', () => {
		let disposed = false;
		const value = { dispose: () => (disposed = true) };

		const disposeTrie = new PathTrie<typeof value>();
		disposeTrie.set('a/b', value, false);
		disposeTrie.delete('a/b', false, false);

		assert.strictEqual(disposed, false);
	});

	test('set disposes old value on update', () => {
		let disposed = false;
		type Disposable = { dispose(): void };
		const old: Disposable = {
			dispose: () => {
				disposed = true;
			},
		};
		const replacement: Disposable = { dispose: () => {} };

		const disposeTrie = new PathTrie<Disposable>();
		disposeTrie.set('a/b', old, false);
		disposeTrie.set('a/b', replacement, false);

		assert.strictEqual(disposed, true);
	});

	test('getClosest with excludeSelf', () => {
		trie.set('a/b', 'parent', false);
		trie.set('a/b/c', 'child', false);

		assert.strictEqual(trie.getClosest('a/b/c', false, undefined, false), 'child');
		assert.strictEqual(trie.getClosest('a/b/c', true, undefined, false), 'parent');
		assert.strictEqual(trie.getClosest('a/b/c/d/e', false, undefined, false), 'child');
	});

	test('getClosest with predicate', () => {
		trie.set('a', 'skip', false);
		trie.set('a/b', 'match', false);

		assert.strictEqual(
			trie.getClosest('a/b/c', false, v => v === 'skip', false),
			'skip',
		);
	});

	test('getChildren returns direct child values', () => {
		trie.set('r/a', 'va', false);
		trie.set('r/b', 'vb', false);
		trie.set('r/a/deep', 'vd', false);

		const children = trie.getChildren('r', false);
		assert.deepStrictEqual(children.sort(), ['va', 'vb']);
	});

	test('getDescendants yields all nested values', () => {
		trie.set('r/a', 'va', false);
		trie.set('r/b', 'vb', false);
		trie.set('r/a/c', 'vc', false);

		const values = [...trie.getDescendants('r', undefined, false)].sort();
		assert.deepStrictEqual(values, ['va', 'vb', 'vc']);
	});

	test('clear empties the trie', () => {
		trie.set('a/b', 'v', false);
		trie.clear();
		assert.strictEqual(trie.has('a/b', false), false);
	});

	test('ignoreCase', () => {
		trie.set('Foo/Bar', 'v', true);
		assert.strictEqual(trie.get('foo/bar', true), 'v');
		assert.strictEqual(trie.has('FOO/BAR', true), true);
	});
});

suite('UriEntryTrie', () => {
	function normalize(uri: Uri): { path: string; ignoreCase: boolean } {
		// For file:// URIs, use fsPath-like path and case-insensitive
		// For other schemes, use authority + path and case-sensitive
		if (uri.scheme === 'file') {
			return { path: uri.path, ignoreCase: true };
		}
		return { path: `${uri.authority}${uri.path}`, ignoreCase: false };
	}

	test('set/get/has with file URIs', () => {
		const trie = new UriEntryTrie<string, Uri>(normalize);
		const uri = fileUri('/code/project/src/file.ts');

		trie.set(uri, 'v1');

		assert.strictEqual(trie.has(uri), true);
		assert.strictEqual(trie.get(uri)?.value, 'v1');
	});

	test('getClosest finds ancestor entry', () => {
		const trie = new UriEntryTrie<string, Uri>(normalize);
		const repoUri = fileUri('/code/project');
		const fileUriVal = fileUri('/code/project/src/file.ts');

		trie.set(repoUri, 'repo');

		const entry = trie.getClosest(fileUriVal);
		assert.strictEqual(entry?.value, 'repo');
	});

	test('different schemes are isolated', () => {
		const trie = new UriEntryTrie<string, Uri>(normalize);
		const fileU = fileUri('/code/project');
		const vfsU = parseUri('vscode-vfs://github/code/project');

		trie.set(fileU, 'file-val');
		trie.set(vfsU, 'vfs-val');

		assert.strictEqual(trie.get(fileU)?.value, 'file-val');
		assert.strictEqual(trie.get(vfsU)?.value, 'vfs-val');
	});

	test('delete removes entry', () => {
		const trie = new UriEntryTrie<string, Uri>(normalize);
		const uri = fileUri('/code/project');

		trie.set(uri, 'v');
		assert.strictEqual(trie.delete(uri), true);
		assert.strictEqual(trie.has(uri), false);
	});
});

suite('UriTrie', () => {
	function normalize(uri: Uri): { path: string; ignoreCase: boolean } {
		if (uri.scheme === 'file') {
			return { path: uri.path, ignoreCase: true };
		}
		return { path: `${uri.authority}${uri.path}`, ignoreCase: false };
	}

	test('set/get/has with file URIs', () => {
		const trie = new UriTrie<string, Uri>(normalize);
		const uri = fileUri('/code/project');

		trie.set(uri, 'repo');

		assert.strictEqual(trie.has(uri), true);
		assert.strictEqual(trie.get(uri), 'repo');
	});

	test('getClosest returns value directly', () => {
		const trie = new UriTrie<string, Uri>(normalize);
		trie.set(fileUri('/code/project'), 'repo');

		assert.strictEqual(trie.getClosest(fileUri('/code/project/src/file.ts')), 'repo');
	});

	test('getClosest with excludeSelf', () => {
		const trie = new UriTrie<string, Uri>(normalize);
		trie.set(fileUri('/code/project'), 'parent');
		trie.set(fileUri('/code/project/nested'), 'child');

		assert.strictEqual(trie.getClosest(fileUri('/code/project/nested'), true), 'parent');
		assert.strictEqual(trie.getClosest(fileUri('/code/project'), true), undefined);
	});

	test('getDescendants yields all values', () => {
		const trie = new UriTrie<string, Uri>(normalize);
		trie.set(fileUri('/code/a'), 'va');
		trie.set(fileUri('/code/b'), 'vb');

		const values = [...trie.getDescendants()].sort();
		assert.deepStrictEqual(values, ['va', 'vb']);
	});
});

suite('VisitedPathsTrie', () => {
	suite('with root marker (repo found)', () => {
		let trie: VisitedPathsTrie;

		setup(() => {
			trie = new VisitedPathsTrie();
			// Simulate: searched /code/foo/bar/baz/file.ts, found repo at /code/foo
			trie.set('/code/foo/bar/baz/file.ts', '/code/foo');
		});

		test('has: exact path returns true', () => {
			assert.strictEqual(trie.has('/code/foo/bar/baz/file.ts'), true);
		});

		test('has: path on same branch returns true', () => {
			assert.strictEqual(trie.has('/code/foo/bar/baz'), true);
			assert.strictEqual(trie.has('/code/foo/bar'), true);
			assert.strictEqual(trie.has('/code/foo'), true);
		});

		test('has: path above root returns false', () => {
			assert.strictEqual(trie.has('/code'), false);
		});

		test('has: diverging path returns false', () => {
			assert.strictEqual(trie.has('/code/foo/sibling'), false);
			assert.strictEqual(trie.has('/code/other'), false);
		});

		test('hasParent: file in same directory returns true', () => {
			assert.strictEqual(trie.hasParent('/code/foo/bar/baz/other.ts'), true);
		});

		test('hasParent: file in ancestor directory returns true', () => {
			assert.strictEqual(trie.hasParent('/code/foo/bar/other.ts'), true);
			assert.strictEqual(trie.hasParent('/code/foo/other.ts'), true);
		});

		test('hasParent: file in sibling directory returns false', () => {
			assert.strictEqual(trie.hasParent('/code/foo/sibling/file.ts'), false);
			assert.strictEqual(trie.hasParent('/code/foo/bar/sibling/file.ts'), false);
		});

		test('hasParent: file above root returns false', () => {
			assert.strictEqual(trie.hasParent('/code/other.ts'), false);
		});

		test('hasParent: completely different path returns false', () => {
			assert.strictEqual(trie.hasParent('/other/path/file.ts'), false);
		});
	});

	suite('without root marker (no repo found)', () => {
		let trie: VisitedPathsTrie;

		setup(() => {
			trie = new VisitedPathsTrie();
			// Simulate: searched /outside/deep/file.ts, found no repo
			trie.set('/outside/deep/file.ts', undefined);
		});

		test('has: exact path returns false (no root marker)', () => {
			// The path exists but has no root marker, so has() returns false
			// unless there are leaf children at the final node
			assert.strictEqual(trie.has('/outside/deep/file.ts'), false);
		});

		test('hasParent: file in same directory returns true (leaf child exists)', () => {
			// /outside/deep has a leaf child (file.ts), so we know we searched here
			assert.strictEqual(trie.hasParent('/outside/deep/other.ts'), true);
		});

		test('hasParent: file in different directory returns false', () => {
			assert.strictEqual(trie.hasParent('/outside/other/file.ts'), false);
			assert.strictEqual(trie.hasParent('/outside/deep/nested/file.ts'), false);
		});
	});

	suite('multiple paths', () => {
		let trie: VisitedPathsTrie;

		setup(() => {
			trie = new VisitedPathsTrie();
			// Two files in same repo
			trie.set('/code/foo/bar/file1.ts', '/code/foo');
			trie.set('/code/foo/other/file2.ts', '/code/foo');
		});

		test('hasParent: both branches covered', () => {
			assert.strictEqual(trie.hasParent('/code/foo/bar/new.ts'), true);
			assert.strictEqual(trie.hasParent('/code/foo/other/new.ts'), true);
		});

		test('hasParent: uncovered sibling returns false', () => {
			assert.strictEqual(trie.hasParent('/code/foo/uncovered/file.ts'), false);
		});
	});

	suite('deeply nested repo', () => {
		let trie: VisitedPathsTrie;

		setup(() => {
			trie = new VisitedPathsTrie();
			// Repo is at the deepest level
			trie.set('/code/foo/bar/baz/file.ts', '/code/foo/bar/baz');
		});

		test('hasParent: file in repo directory returns true', () => {
			assert.strictEqual(trie.hasParent('/code/foo/bar/baz/other.ts'), true);
		});

		test('hasParent: file above repo returns false', () => {
			assert.strictEqual(trie.hasParent('/code/foo/bar/other.ts'), false);
			assert.strictEqual(trie.hasParent('/code/foo/other.ts'), false);
		});
	});

	suite('clear', () => {
		test('clear removes all entries', () => {
			const trie = new VisitedPathsTrie();
			trie.set('/code/foo/file.ts', '/code/foo');
			assert.strictEqual(trie.hasParent('/code/foo/other.ts'), true);

			trie.clear();
			assert.strictEqual(trie.hasParent('/code/foo/other.ts'), false);
		});
	});
});
