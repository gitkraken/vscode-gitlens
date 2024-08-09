import * as assert from 'assert';
import { basename } from 'path';
import { before, suite, test } from 'mocha';
import { Uri } from 'vscode';
import { isLinux } from '../../env/node/platform';
import { normalizeRepoUri } from '../../repositories';
import type { UriEntry } from '../trie';
import { PathEntryTrie, UriEntryTrie, UriTrie } from '../trie';
import paths from './__mock__/paths.json';

suite.skip('PathEntryTrie Test Suite', () => {
	type Repo = { type: 'repo'; name: string; path: string; fsPath: string };
	type File = { type: 'file'; name: string; path: string };

	const repoGL = {
		type: 'repo',
		name: 'vscode-gitlens',
		path: 'C:/Users/Name/code/gitkraken/vscode-gitlens',
		fsPath: 'C:\\Users\\Name\\code\\gitkraken\\vscode-gitlens',
	} as const satisfies Repo;
	const repoNested = {
		type: 'repo',
		name: 'repo',
		path: 'C:/Users/Name/code/gitkraken/vscode-gitlens/nested/repo',
		fsPath: 'C:\\Users\\Name\\code\\gitkraken\\vscode-gitlens\\nested\\repo',
	} as const satisfies Repo;
	const repoVSC = {
		type: 'repo',
		name: 'vscode',
		path: 'C:/Users/Name/code/microsoft/vscode',
		fsPath: 'C:\\Users\\Name\\code\\microsoft\\vscode',
	} as const satisfies Repo;

	const trie = new PathEntryTrie<Repo | File>();

	before(() => {
		trie.set(repoGL.fsPath, repoGL);
		trie.set(repoNested.fsPath, repoNested);
		trie.set(repoVSC.fsPath, repoVSC);

		let file: File = { type: 'file', name: 'index.ts', path: `${repoNested.fsPath}\\src\\index.ts` };
		trie.set(file.path, file);

		file = { type: 'file', name: 'main.ts', path: `${repoVSC.fsPath}\\src\\main.ts` };
		trie.set(file.path, file);

		for (const path of paths) {
			file = { type: 'file', name: basename(path), path: `C:\\Users\\Name\\code${path}` };
			trie.set(file.path, file);
		}
	});

	test('has: repo', () => {
		assert.strictEqual(trie.has(repoGL.fsPath), true);
		assert.strictEqual(trie.has(repoNested.fsPath), true);
		assert.strictEqual(trie.has(repoVSC.fsPath), true);

		assert.strictEqual(trie.has('C:\\Users\\Name\\code\\company\\repo'), false);
		assert.strictEqual(trie.has('D:\\Users\\Name\\code\\gitkraken\\vscode-gitlens'), false);
	});

	test('has: repo (ignore case)', () => {
		assert.strictEqual(trie.has(repoGL.fsPath.toUpperCase()), true);
		assert.strictEqual(trie.has(repoNested.fsPath.toUpperCase()), true);
		assert.strictEqual(trie.has(repoVSC.fsPath.toUpperCase()), true);
	});

	test('has: file', () => {
		assert.strictEqual(trie.has(`${repoGL.fsPath}\\src\\extension.ts`), true);
		assert.strictEqual(trie.has(`${repoGL.fsPath}\\foo\\bar\\baz.ts`), false);

		assert.strictEqual(trie.has(`${repoNested.fsPath}\\src\\index.ts`), true);
		assert.strictEqual(trie.has(`${repoVSC.fsPath}\\src\\main.ts`), true);
	});

	test('has: file (ignore case)', () => {
		assert.strictEqual(trie.has(`${repoGL.fsPath}\\src\\extension.ts`.toUpperCase()), true);
		assert.strictEqual(trie.has(`${repoGL.fsPath}\\foo\\bar\\baz.ts`.toUpperCase()), false);

		assert.strictEqual(trie.has(`${repoNested.fsPath}\\src\\index.ts`.toUpperCase()), true);
		assert.strictEqual(trie.has(`${repoVSC.fsPath}\\src\\main.ts`.toUpperCase()), true);
	});

	test('has: folder (failure case)', () => {
		assert.strictEqual(trie.has(`${repoGL.fsPath}\\src`), false);
		assert.strictEqual(trie.has(`${repoNested.fsPath}\\src`), false);
		assert.strictEqual(trie.has(`${repoVSC.fsPath}\\src`), false);
	});

	test('get: repo', () => {
		let entry = trie.get(repoGL.fsPath);
		assert.strictEqual(entry?.path, basename(repoGL.path));
		assert.strictEqual(entry?.fullPath, repoGL.path);
		assert.strictEqual(entry?.value?.type, 'repo');
		assert.strictEqual(entry?.value?.path, repoGL.path);

		entry = trie.get(repoNested.fsPath);
		assert.strictEqual(entry?.path, basename(repoNested.path));
		assert.strictEqual(entry?.fullPath, repoNested.path);
		assert.strictEqual(entry?.value?.type, 'repo');
		assert.strictEqual(entry?.value?.path, repoNested.path);

		entry = trie.get(repoVSC.fsPath);
		assert.strictEqual(entry?.path, basename(repoVSC.path));
		assert.strictEqual(entry?.fullPath, repoVSC.path);
		assert.strictEqual(entry?.value?.type, 'repo');
		assert.strictEqual(entry?.value?.path, repoVSC.path);

		assert.strictEqual(trie.get('C:\\Users\\Name\\code\\company\\repo'), undefined);
		assert.strictEqual(trie.get('D:\\Users\\Name\\code\\gitkraken\\vscode-gitlens'), undefined);
	});

	test('get: repo (ignore case)', () => {
		let entry = trie.get(repoGL.fsPath.toUpperCase());
		assert.strictEqual(entry?.path, basename(repoGL.path));
		assert.strictEqual(entry?.fullPath, repoGL.path);
		assert.strictEqual(entry?.value?.type, 'repo');
		assert.strictEqual(entry?.value?.path, repoGL.path);

		entry = trie.get(repoNested.fsPath.toUpperCase());
		assert.strictEqual(entry?.path, basename(repoNested.path));
		assert.strictEqual(entry?.fullPath, repoNested.path);
		assert.strictEqual(entry?.value?.type, 'repo');
		assert.strictEqual(entry?.value?.path, repoNested.path);

		entry = trie.get(repoVSC.fsPath.toUpperCase());
		assert.strictEqual(entry?.path, basename(repoVSC.path));
		assert.strictEqual(entry?.fullPath, repoVSC.path);
		assert.strictEqual(entry?.value?.type, 'repo');
		assert.strictEqual(entry?.value?.path, repoVSC.path);
	});

	test('get: file', () => {
		let entry = trie.get(`${repoGL.fsPath}\\src\\extension.ts`);
		assert.strictEqual(entry?.path, 'extension.ts');
		assert.strictEqual(entry?.fullPath, `${repoGL.path}/src/extension.ts`);
		assert.strictEqual(entry?.value?.path, `${repoGL.fsPath}\\src\\extension.ts`);

		assert.strictEqual(trie.get(`${repoGL.fsPath}\\foo\\bar\\baz.ts`), undefined);

		entry = trie.get(`${repoNested.fsPath}\\src\\index.ts`);
		assert.strictEqual(entry?.path, 'index.ts');
		assert.strictEqual(entry?.fullPath, `${repoNested.path}/src/index.ts`);
		assert.strictEqual(entry?.value?.path, `${repoNested.fsPath}\\src\\index.ts`);

		entry = trie.get(`${repoVSC.fsPath}\\src\\main.ts`);
		assert.strictEqual(entry?.path, 'main.ts');
		assert.strictEqual(entry?.fullPath, `${repoVSC.path}/src/main.ts`);
		assert.strictEqual(entry?.value?.path, `${repoVSC.fsPath}\\src\\main.ts`);
	});

	test('get: file (ignore case)', () => {
		let entry = trie.get(`${repoGL.fsPath}\\src\\extension.ts`.toLocaleUpperCase());
		assert.strictEqual(entry?.path, 'extension.ts');
		assert.strictEqual(entry?.fullPath, `${repoGL.path}/src/extension.ts`);
		assert.strictEqual(entry?.value?.path, `${repoGL.fsPath}\\src\\extension.ts`);

		entry = trie.get(`${repoNested.fsPath}\\src\\index.ts`.toLocaleUpperCase());
		assert.strictEqual(entry?.path, 'index.ts');
		assert.strictEqual(entry?.fullPath, `${repoNested.path}/src/index.ts`);
		assert.strictEqual(entry?.value?.path, `${repoNested.fsPath}\\src\\index.ts`);

		entry = trie.get(`${repoVSC.fsPath}\\src\\main.ts`.toLocaleUpperCase());
		assert.strictEqual(entry?.path, 'main.ts');
		assert.strictEqual(entry?.fullPath, `${repoVSC.path}/src/main.ts`);
		assert.strictEqual(entry?.value?.path, `${repoVSC.fsPath}\\src\\main.ts`);
	});

	test('get: folder (failure case)', () => {
		assert.strictEqual(trie.get(`${repoGL.fsPath}\\src`), undefined);
		assert.strictEqual(trie.get(`${repoNested.fsPath}\\src`), undefined);
		assert.strictEqual(trie.get(`${repoVSC.fsPath}\\src`), undefined);
	});

	test('getClosest: repo file', () => {
		let entry = trie.getClosest(`${repoGL.fsPath}\\src\\extension.ts`, true);
		assert.strictEqual(entry?.path, repoGL.name);
		assert.strictEqual(entry?.fullPath, repoGL.path);
		assert.strictEqual(entry?.value?.path, repoGL.path);

		entry = trie.getClosest(`${repoNested.fsPath}\\src\\index.ts`, true);
		assert.strictEqual(entry?.path, repoNested.name);
		assert.strictEqual(entry?.fullPath, repoNested.path);
		assert.strictEqual(entry?.value?.path, repoNested.path);

		entry = trie.getClosest(`${repoVSC.fsPath}\\src\\main.ts`, true);
		assert.strictEqual(entry?.path, repoVSC.name);
		assert.strictEqual(entry?.fullPath, repoVSC.path);
		assert.strictEqual(entry?.value?.path, repoVSC.path);
	});

	test('getClosest: repo file (ignore case)', () => {
		let entry = trie.getClosest(`${repoGL.fsPath}\\src\\extension.ts`.toUpperCase(), true);
		assert.strictEqual(entry?.path, repoGL.name);
		assert.strictEqual(entry?.fullPath, repoGL.path);
		assert.strictEqual(entry?.value?.path, repoGL.path);

		entry = trie.getClosest(`${repoNested.fsPath}\\src\\index.ts`.toUpperCase(), true);
		assert.strictEqual(entry?.path, repoNested.name);
		assert.strictEqual(entry?.fullPath, repoNested.path);
		assert.strictEqual(entry?.value?.path, repoNested.path);

		entry = trie.getClosest(`${repoVSC.fsPath}\\src\\main.ts`.toUpperCase(), true);
		assert.strictEqual(entry?.path, repoVSC.name);
		assert.strictEqual(entry?.fullPath, repoVSC.path);
		assert.strictEqual(entry?.value?.path, repoVSC.path);
	});

	test('getClosest: missing path but inside repo', () => {
		let entry = trie.getClosest(`${repoGL.fsPath}\\src\\foo\\bar\\baz.ts`.toUpperCase());
		assert.strictEqual(entry?.path, repoGL.name);
		assert.strictEqual(entry?.fullPath, repoGL.path);
		assert.strictEqual(entry?.value?.path, repoGL.path);

		entry = trie.getClosest(`${repoNested.fsPath}\\foo\\bar\\baz.ts`.toUpperCase());
		assert.strictEqual(entry?.path, repoNested.name);
		assert.strictEqual(entry?.fullPath, repoNested.path);
		assert.strictEqual(entry?.value?.path, repoNested.path);

		entry = trie.getClosest(`${repoVSC.fsPath}\\src\\foo\\bar\\baz.ts`.toUpperCase());
		assert.strictEqual(entry?.path, repoVSC.name);
		assert.strictEqual(entry?.fullPath, repoVSC.path);
		assert.strictEqual(entry?.value?.path, repoVSC.path);
	});

	test('getClosest: missing path', () => {
		const entry = trie.getClosest('C:\\Users\\Name\\code\\company\\repo\\foo\\bar\\baz.ts');
		assert.strictEqual(entry, undefined);
	});

	test('getClosest: repo', () => {
		let entry = trie.getClosest(repoGL.fsPath);
		assert.strictEqual(entry?.path, repoGL.name);
		assert.strictEqual(entry?.fullPath, repoGL.path);
		assert.strictEqual(entry?.value?.path, repoGL.path);

		entry = trie.getClosest(repoNested.fsPath);
		assert.strictEqual(entry?.path, repoNested.name);
		assert.strictEqual(entry?.fullPath, repoNested.path);
		assert.strictEqual(entry?.value?.path, repoNested.path);

		entry = trie.getClosest(repoVSC.fsPath);
		assert.strictEqual(entry?.path, repoVSC.name);
		assert.strictEqual(entry?.fullPath, repoVSC.path);
		assert.strictEqual(entry?.value?.path, repoVSC.path);
	});

	test('delete file', () => {
		const file = `${repoVSC.fsPath}\\src\\main.ts`;
		assert.strictEqual(trie.has(file), true);
		assert.strictEqual(trie.delete(file), true);
		assert.strictEqual(trie.has(file), false);
	});

	test('delete repo', () => {
		const repo = repoGL.fsPath;
		assert.strictEqual(trie.has(repo), true);
		assert.strictEqual(trie.delete(repo), true);
		assert.strictEqual(trie.has(repo), false);

		assert.strictEqual(trie.has(repoNested.fsPath), true);
	});

	test('delete missing', () => {
		const file = `${repoGL.fsPath}\\src\\foo\\bar\\baz.ts`;
		assert.strictEqual(trie.has(file), false);
		assert.strictEqual(trie.delete(file), false);
		assert.strictEqual(trie.has(file), false);
	});

	test('clear', () => {
		assert.strictEqual(trie.has(repoVSC.fsPath), true);
		trie.clear();

		assert.strictEqual(trie.has(repoGL.fsPath), false);
		assert.strictEqual(trie.has(repoNested.fsPath), false);
		assert.strictEqual(trie.has(repoVSC.fsPath), false);

		assert.strictEqual(trie.get(repoGL.fsPath), undefined);
		assert.strictEqual(trie.get(repoNested.fsPath), undefined);
		assert.strictEqual(trie.get(repoVSC.fsPath), undefined);

		assert.strictEqual(trie.getClosest(repoGL.fsPath), undefined);
		assert.strictEqual(trie.getClosest(repoNested.fsPath), undefined);
		assert.strictEqual(trie.getClosest(repoVSC.fsPath), undefined);
	});
});

suite.skip('UriEntryTrie Test Suite', () => {
	type Repo = { type: 'repo'; name: string; uri: Uri; fsPath: string };
	type File = { type: 'file'; name: string; uri: Uri };

	const repoGL = {
		type: 'repo',
		name: 'vscode-gitlens',
		uri: Uri.file('c:/Users/Name/code/gitkraken/vscode-gitlens'),
		fsPath: 'c:/Users/Name/code/gitkraken/vscode-gitlens',
	} as const satisfies Repo;
	const repoNested = {
		type: 'repo',
		name: 'repo',
		uri: Uri.file('c:/Users/Name/code/gitkraken/vscode-gitlens/nested/repo'),
		fsPath: 'c:/Users/Name/code/gitkraken/vscode-gitlens/nested/repo',
	} as const satisfies Repo;
	const repoGLvfs = {
		type: 'repo',
		name: 'vscode-gitlens',
		uri: Uri.parse('vscode-vfs://github/gitkraken/vscode-gitlens'),
		fsPath: 'github/gitkraken/vscode-gitlens',
	} as const satisfies Repo;
	const repoVSCvfs = {
		type: 'repo',
		name: 'vscode',
		uri: Uri.parse('vscode-vfs://github/microsoft/vscode'),
		fsPath: 'github/microsoft/vscode',
	} as const satisfies Repo;

	const trie = new UriEntryTrie<Repo | File>(_ => ({ ignoreCase: false, path: '' }));

	function assertRepoEntry(actual: UriEntry<Repo | File> | undefined, expected: Repo): void {
		assert.strictEqual(actual?.path, expected.name);
		assert.strictEqual(actual?.fullPath, expected.fsPath);
		assert.strictEqual(actual?.value?.type, 'repo');
		assert.strictEqual(actual?.value?.uri.toString(), expected.uri.toString());
	}

	function assertRepoEntryIgnoreCase(actual: UriEntry<Repo | File> | undefined, expected: Repo): void {
		if (isLinux) {
			assert.strictEqual(actual, undefined);
		} else {
			assert.strictEqual(actual?.path, expected.name);
			assert.strictEqual(actual?.fullPath, expected.fsPath);
			assert.strictEqual(actual?.value?.type, 'repo');
			assert.strictEqual(actual?.value?.uri.toString(), expected.uri.toString());
		}
	}

	function assertFileEntry(actual: UriEntry<Repo | File> | undefined, expected: Uri): void {
		assert.strictEqual(actual?.path, basename(expected.path));
		if (expected.scheme === 'file' || expected.scheme === 'git' || expected.scheme === 'gitlens') {
			assert.strictEqual(actual?.fullPath, expected.path.slice(1));
		} else {
			assert.strictEqual(actual?.fullPath, `${expected.authority}${expected.path}`);
		}
		assert.strictEqual(actual?.value?.type, 'file');
		assert.strictEqual(actual?.value?.uri.toString(), expected.toString());
	}

	before(() => {
		trie.set(repoGL.uri, repoGL);
		trie.set(repoNested.uri, repoNested);
		trie.set(repoGLvfs.uri, repoGLvfs);
		trie.set(repoVSCvfs.uri, repoVSCvfs);

		let file: File = { type: 'file', name: 'index.ts', uri: Uri.joinPath(repoNested.uri, 'src\\index.ts') };
		trie.set(file.uri, file);

		file = { type: 'file', name: 'main.ts', uri: Uri.joinPath(repoVSCvfs.uri, 'src/main.ts') };
		trie.set(file.uri, file);

		for (const path of paths) {
			file = { type: 'file', name: basename(path), uri: Uri.file(`C:\\Users\\Name\\code${path}`) };
			trie.set(file.uri, file);
			file = { type: 'file', name: basename(path), uri: repoGLvfs.uri.with({ path: path.replace(/\\/g, '/') }) };
			trie.set(file.uri, file);
		}
	});

	test('has(file://): repo', () => {
		assert.strictEqual(trie.has(repoGL.uri), true);
		assert.strictEqual(trie.has(repoGL.uri.with({ path: repoGL.uri.path.toUpperCase() })), !isLinux);
		assert.strictEqual(trie.has(repoNested.uri), true);
		assert.strictEqual(trie.has(repoNested.uri.with({ path: repoGL.uri.path.toUpperCase() })), !isLinux);

		assert.strictEqual(trie.has(Uri.file('C:\\Users\\Name\\code\\company\\repo')), false);
		assert.strictEqual(trie.has(Uri.file('D:\\Users\\Name\\code\\gitkraken\\vscode-gitlens')), false);
	});

	test('has(file://): file', () => {
		assert.strictEqual(trie.has(Uri.file(`${repoGL.fsPath}/src/extension.ts`)), true);
		assert.strictEqual(trie.has(Uri.file(`${repoGL.fsPath}/foo/bar/baz.ts`)), false);

		assert.strictEqual(trie.has(Uri.file(`${repoNested.fsPath}/src/index.ts`)), true);
	});

	test('has(vscode-vfs://): repo', () => {
		assert.strictEqual(trie.has(repoGLvfs.uri), true);
		assert.strictEqual(trie.has(repoGLvfs.uri.with({ path: repoGLvfs.uri.path.toUpperCase() })), false);
		assert.strictEqual(trie.has(repoVSCvfs.uri), true);
		assert.strictEqual(trie.has(repoVSCvfs.uri.with({ path: repoVSCvfs.uri.path.toUpperCase() })), false);

		assert.strictEqual(trie.has(Uri.parse('vscode-vfs://github/company/repo')), false);
		assert.strictEqual(trie.has(repoGLvfs.uri.with({ authority: 'azdo' })), false);
	});

	test('has(vscode-vfs://): file', () => {
		assert.strictEqual(trie.has(Uri.joinPath(repoGLvfs.uri, 'src/extension.ts')), true);
		assert.strictEqual(trie.has(Uri.joinPath(repoGLvfs.uri, 'foo/bar/baz.ts')), false);
		assert.strictEqual(trie.has(Uri.joinPath(repoVSCvfs.uri, 'src/main.ts')), true);

		assert.strictEqual(trie.has(Uri.parse('vscode-vfs://github/company/repo/foo/bar/baz.ts')), false);
		assert.strictEqual(
			trie.has(
				repoGLvfs.uri.with({ authority: 'azdo', path: Uri.joinPath(repoGLvfs.uri, 'src/extension.ts').path }),
			),
			false,
		);
	});

	test('has(github://): repo', () => {
		assert.strictEqual(trie.has(repoGLvfs.uri.with({ scheme: 'github' })), true);
		assert.strictEqual(
			trie.has(repoGLvfs.uri.with({ scheme: 'github', path: repoGLvfs.uri.path.toUpperCase() })),
			false,
		);
		assert.strictEqual(trie.has(repoVSCvfs.uri.with({ scheme: 'github' })), true);
		assert.strictEqual(
			trie.has(repoVSCvfs.uri.with({ scheme: 'github', path: repoVSCvfs.uri.path.toUpperCase() })),
			false,
		);

		assert.strictEqual(trie.has(Uri.parse('github://github/company/repo')), false);
		assert.strictEqual(trie.has(repoGLvfs.uri.with({ scheme: 'github', authority: 'azdo' })), false);
	});

	test('has(github://): file', () => {
		assert.strictEqual(trie.has(Uri.joinPath(repoGLvfs.uri, 'src/extension.ts').with({ scheme: 'github' })), true);
		assert.strictEqual(trie.has(Uri.joinPath(repoGLvfs.uri, 'foo/bar/baz.ts').with({ scheme: 'github' })), false);
		assert.strictEqual(trie.has(Uri.joinPath(repoVSCvfs.uri, 'src/main.ts').with({ scheme: 'github' })), true);

		assert.strictEqual(
			trie.has(Uri.parse('vscode-vfs://github/company/repo/foo/bar/baz.ts').with({ scheme: 'github' })),
			false,
		);
		assert.strictEqual(
			trie.has(
				repoGLvfs.uri.with({
					scheme: 'github',
					authority: 'azdo',
					path: Uri.joinPath(repoGLvfs.uri, 'src/extension.ts').path,
				}),
			),
			false,
		);
	});

	// test('has(gitlens://): repo', () => {
	// 	assert.strictEqual(
	// 		trie.has(
	// 			repoGL.uri.with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		true,
	// 	);
	// 	assert.strictEqual(
	// 		trie.has(
	// 			Uri.parse(
	// 				repoGL.uri
	// 					.with({
	// 						scheme: 'gitlens',
	// 						authority: 'abcd',
	// 						query: JSON.stringify({ ref: '1234567890' }),
	// 					})
	// 					.toString()
	// 					.toUpperCase(),
	// 			),
	// 		),
	// 		!isLinux,
	// 	);
	// 	assert.strictEqual(
	// 		trie.has(
	// 			repoNested.uri.with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		true,
	// 	);
	// 	assert.strictEqual(
	// 		trie.has(
	// 			Uri.parse(
	// 				repoNested.uri
	// 					.with({
	// 						scheme: 'gitlens',
	// 						authority: 'abcd',
	// 						query: JSON.stringify({ ref: '1234567890' }),
	// 					})
	// 					.toString()
	// 					.toUpperCase(),
	// 			),
	// 		),
	// 		!isLinux,
	// 	);

	// 	assert.strictEqual(
	// 		trie.has(
	// 			Uri.file('C:\\Users\\Name\\code\\company\\repo').with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		false,
	// 	);
	// });

	// test('has(gitlens://): file', () => {
	// 	assert.strictEqual(
	// 		trie.has(
	// 			Uri.joinPath(repoGL.uri, 'src/extension.ts').with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		true,
	// 	);
	// 	assert.strictEqual(
	// 		trie.has(
	// 			Uri.joinPath(repoGL.uri, 'foo/bar/baz.ts').with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		false,
	// 	);
	// 	assert.strictEqual(
	// 		trie.has(
	// 			Uri.joinPath(repoNested.uri, 'src/index.ts').with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		true,
	// 	);
	// });

	test('get(file://): repo', () => {
		assertRepoEntry(trie.get(repoGL.uri), repoGL);
		assertRepoEntry(trie.get(repoNested.uri), repoNested);

		assert.strictEqual(trie.get(Uri.file('C:\\Users\\Name\\code\\company\\repo')), undefined);
		assert.strictEqual(trie.get(Uri.file('D:\\Users\\Name\\code\\gitkraken\\vscode-gitlens')), undefined);
	});

	test('get(vscode-vfs://): repo', () => {
		assertRepoEntry(trie.get(repoGLvfs.uri), repoGLvfs);
		assertRepoEntry(trie.get(repoVSCvfs.uri), repoVSCvfs);

		assert.strictEqual(trie.get(Uri.file('C:\\Users\\Name\\code\\company\\repo')), undefined);
		assert.strictEqual(trie.get(Uri.file('D:\\Users\\Name\\code\\gitkraken\\vscode-gitlens')), undefined);
	});

	test('get(github://): repo', () => {
		assertRepoEntry(trie.get(repoGLvfs.uri.with({ scheme: 'github' })), repoGLvfs);
		assertRepoEntry(trie.get(repoVSCvfs.uri.with({ scheme: 'github' })), repoVSCvfs);
	});

	// test('get(gitlens://): repo', () => {
	// 	assertRepoEntry(
	// 		trie.get(
	// 			repoGL.uri.with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		repoGL,
	// 	);

	// 	assertRepoEntry(
	// 		trie.get(
	// 			repoNested.uri.with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		repoNested,
	// 	);
	// });

	test('get(file://): repo (ignore case)', () => {
		assertRepoEntryIgnoreCase(trie.get(repoGL.uri.with({ path: repoGL.uri.path.toUpperCase() })), repoGL);
		assertRepoEntryIgnoreCase(
			trie.get(repoNested.uri.with({ path: repoNested.uri.path.toUpperCase() })),
			repoNested,
		);
	});

	test('get(vscode://): repo (ignore case)', () => {
		assertRepoEntry(trie.get(repoGLvfs.uri.with({ scheme: 'VSCODE-VFS' })), repoGLvfs);

		assert.strictEqual(
			trie.get(repoGLvfs.uri.with({ authority: repoGLvfs.uri.authority.toUpperCase() })),
			undefined,
		);
		assert.strictEqual(trie.get(repoGLvfs.uri.with({ path: repoGLvfs.uri.path.toUpperCase() })), undefined);
	});

	test('get(github://): repo (ignore case)', () => {
		assertRepoEntry(trie.get(repoGLvfs.uri.with({ scheme: 'GITHUB' })), repoGLvfs);

		assert.strictEqual(
			trie.get(repoGLvfs.uri.with({ scheme: 'github', authority: repoGLvfs.uri.authority.toUpperCase() })),
			undefined,
		);
		assert.strictEqual(
			trie.get(repoGLvfs.uri.with({ scheme: 'github', path: repoGLvfs.uri.path.toUpperCase() })),
			undefined,
		);
	});

	// test('get(gitlens://): repo (ignore case)', () => {
	// 	assertRepoEntry(
	// 		trie.get(
	// 			repoGL.uri.with({
	// 				scheme: 'GITLENS',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		repoGL,
	// 	);

	// 	assertRepoEntryIgnoreCase(
	// 		trie.get(
	// 			Uri.parse(
	// 				repoGL.uri
	// 					.with({
	// 						scheme: 'gitlens',
	// 						authority: 'abcd',
	// 						query: JSON.stringify({ ref: '1234567890' }),
	// 					})
	// 					.toString()
	// 					.toUpperCase(),
	// 			),
	// 		),
	// 		repoGL,
	// 	);
	// });

	test('get(file://): file', () => {
		let uri = Uri.joinPath(repoGL.uri, 'src/extension.ts');
		assertFileEntry(trie.get(uri), uri);

		assert.strictEqual(trie.get(Uri.joinPath(repoGL.uri, 'foo/bar/baz.ts')), undefined);

		uri = Uri.joinPath(repoNested.uri, 'src/index.ts');
		assertFileEntry(trie.get(uri), uri);
	});

	test('get(vscode-vfs://): file', () => {
		const uri = Uri.joinPath(repoGLvfs.uri, 'src/extension.ts');
		assertFileEntry(trie.get(uri), uri);
	});

	test('get(github://): file', () => {
		const uri = Uri.joinPath(repoGLvfs.uri, 'src/extension.ts');
		assertFileEntry(trie.get(uri.with({ scheme: 'github' })), uri);
	});

	// test('get(gitlens://): file', () => {
	// 	const uri = Uri.joinPath(repoGL.uri, 'src/extension.ts');
	// 	assertFileEntry(
	// 		trie.get(
	// 			uri.with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		uri,
	// 	);
	// });

	test('get: missing file', () => {
		assert.strictEqual(trie.get(Uri.joinPath(repoGL.uri, 'foo/bar/baz.ts')), undefined);
	});

	test('getClosest(file://): repo', () => {
		assertRepoEntry(trie.getClosest(repoGL.uri), repoGL);
		assertRepoEntry(trie.getClosest(repoNested.uri), repoNested);
	});

	test('getClosest(vscode-vfs://): repo', () => {
		assertRepoEntry(trie.getClosest(repoGLvfs.uri), repoGLvfs);
		assertRepoEntry(trie.getClosest(repoVSCvfs.uri), repoVSCvfs);
	});

	test('getClosest(file://): file', () => {
		assertRepoEntry(trie.getClosest(Uri.joinPath(repoGL.uri, 'src/extension.ts'), true), repoGL);
	});

	test('getClosest(vscode-vfs://): file', () => {
		assertRepoEntry(trie.getClosest(Uri.joinPath(repoGLvfs.uri, 'src/extension.ts'), true), repoGLvfs);
	});

	test('getClosest(github://): file', () => {
		assertRepoEntry(
			trie.getClosest(Uri.joinPath(repoGLvfs.uri, 'src/extension.ts').with({ scheme: 'github' }), true),
			repoGLvfs,
		);
	});

	// test('getClosest(gitlens://): file', () => {
	// 	assertRepoEntry(
	// 		trie.getClosest(
	// 			Uri.joinPath(repoGL.uri, 'src/extension.ts').with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 			true,
	// 		),
	// 		repoGL,
	// 	);
	// });

	test('getClosest(file://): missing repo file', () => {
		assertRepoEntry(trie.getClosest(Uri.joinPath(repoGL.uri, 'foo/bar/baz.ts'), true), repoGL);
	});

	test('getClosest(vscode-vfs://): missing repo file', () => {
		assertRepoEntry(trie.getClosest(Uri.joinPath(repoGLvfs.uri, 'foo/bar/baz.ts'), true), repoGLvfs);
	});

	test('getClosest(github://): missing repo file', () => {
		assertRepoEntry(
			trie.getClosest(Uri.joinPath(repoGLvfs.uri, 'foo/bar/baz.ts').with({ scheme: 'github' }), true),
			repoGLvfs,
		);
	});

	// test('getClosest(gitlens://): missing repo file', () => {
	// 	assertRepoEntry(
	// 		trie.getClosest(
	// 			Uri.joinPath(repoGL.uri, 'src/extension.ts').with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 			true,
	// 		),
	// 		repoGL,
	// 	);

	// 	assertRepoEntry(
	// 		trie.getClosest(
	// 			Uri.joinPath(repoGL.uri, 'foo/bar/baz.ts').with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		repoGL,
	// 	);

	// 	assertRepoEntry(
	// 		trie.getClosest(
	// 			Uri.joinPath(repoNested.uri, 'foo/bar/baz.ts').with({
	// 				scheme: 'gitlens',
	// 				authority: 'abcd',
	// 				query: JSON.stringify({ ref: '1234567890' }),
	// 			}),
	// 		),
	// 		repoNested,
	// 	);
	// });

	test("getClosest: path doesn't exists anywhere", () => {
		assert.strictEqual(
			trie.getClosest(Uri.file('C:\\Users\\Name\\code\\company\\repo\\foo\\bar\\baz.ts')),
			undefined,
		);
	});
});

suite.skip('UriTrie(Repositories) Test Suite', () => {
	type Repo = { type: 'repo'; name: string; uri: Uri; fsPath: string };

	const repoGL = {
		type: 'repo',
		name: 'vscode-gitlens',
		uri: Uri.file('c:/Users/Name/code/gitkraken/vscode-gitlens'),
		fsPath: 'c:/Users/Name/code/gitkraken/vscode-gitlens',
	} as const satisfies Repo;
	const repoNested = {
		type: 'repo',
		name: 'repo',
		uri: Uri.file('c:/Users/Name/code/gitkraken/vscode-gitlens/nested/repo'),
		fsPath: 'c:/Users/Name/code/gitkraken/vscode-gitlens/nested/repo',
	} as const satisfies Repo;
	const repoGLvfs = {
		type: 'repo',
		name: 'vscode-gitlens',
		uri: Uri.parse('vscode-vfs://github/gitkraken/vscode-gitlens'),
		fsPath: 'github/gitkraken/vscode-gitlens',
	} as const satisfies Repo;
	const repoVSCvfs = {
		type: 'repo',
		name: 'vscode',
		uri: Uri.parse('vscode-vfs://github/microsoft/vscode'),
		fsPath: 'github/microsoft/vscode',
	} as const satisfies Repo;

	const trie = new UriTrie<Repo>(normalizeRepoUri);

	function assertRepoEntry(actual: Repo | undefined, expected: Repo): void {
		// assert.strictEqual(actual?.path, expected.name);
		// assert.strictEqual(actual?.fullPath, expected.fsPath);
		assert.strictEqual(actual?.type, 'repo');
		assert.strictEqual(actual?.uri.toString(), expected.uri.toString());
	}

	function assertRepoEntryIgnoreCase(actual: Repo | undefined, expected: Repo): void {
		if (isLinux) {
			assert.strictEqual(actual, undefined);
		} else {
			// assert.strictEqual(actual?.path, expected.name);
			// assert.strictEqual(actual?.fullPath, expected.fsPath);
			assert.strictEqual(actual?.type, 'repo');
			assert.strictEqual(actual?.uri.toString(), expected.uri.toString());
		}
	}

	before(() => {
		trie.set(repoGL.uri, repoGL);
		trie.set(repoNested.uri, repoNested);
		trie.set(repoGLvfs.uri, repoGLvfs);
		trie.set(repoVSCvfs.uri, repoVSCvfs);
	});

	test('has(file://)', () => {
		assert.strictEqual(trie.has(repoGL.uri), true);
		assert.strictEqual(trie.has(repoGL.uri.with({ path: repoGL.uri.path.toUpperCase() })), !isLinux);
		assert.strictEqual(trie.has(repoNested.uri), true);
		assert.strictEqual(trie.has(repoNested.uri.with({ path: repoGL.uri.path.toUpperCase() })), !isLinux);

		assert.strictEqual(trie.has(Uri.file('C:\\Users\\Name\\code\\company\\repo')), false);
		assert.strictEqual(trie.has(Uri.file('D:\\Users\\Name\\code\\gitkraken\\vscode-gitlens')), false);
	});

	test('has(vscode-vfs://)', () => {
		assert.strictEqual(trie.has(repoGLvfs.uri), true);
		assert.strictEqual(trie.has(repoGLvfs.uri.with({ path: repoGLvfs.uri.path.toUpperCase() })), false);
		assert.strictEqual(trie.has(repoVSCvfs.uri), true);
		assert.strictEqual(trie.has(repoVSCvfs.uri.with({ path: repoVSCvfs.uri.path.toUpperCase() })), false);

		assert.strictEqual(trie.has(Uri.parse('vscode-vfs://github/company/repo')), false);
		assert.strictEqual(trie.has(repoGLvfs.uri.with({ authority: 'azdo' })), false);
	});

	test('has(github://)', () => {
		assert.strictEqual(trie.has(repoGLvfs.uri.with({ scheme: 'github' })), true);
		assert.strictEqual(
			trie.has(repoGLvfs.uri.with({ scheme: 'github', path: repoGLvfs.uri.path.toUpperCase() })),
			false,
		);
		assert.strictEqual(trie.has(repoVSCvfs.uri.with({ scheme: 'github' })), true);
		assert.strictEqual(
			trie.has(repoVSCvfs.uri.with({ scheme: 'github', path: repoVSCvfs.uri.path.toUpperCase() })),
			false,
		);

		assert.strictEqual(trie.has(Uri.parse('github://github/company/repo')), false);
		assert.strictEqual(trie.has(repoGLvfs.uri.with({ scheme: 'github', authority: 'azdo' })), false);
	});

	test('has(gitlens://)', () => {
		assert.strictEqual(
			trie.has(
				repoGL.uri.with({
					scheme: 'gitlens',
					authority: 'abcd',
					query: JSON.stringify({ ref: '1234567890' }),
				}),
			),
			true,
		);
		assert.strictEqual(
			trie.has(
				Uri.parse(
					repoGL.uri
						.with({
							scheme: 'gitlens',
							authority: 'abcd',
							query: JSON.stringify({ ref: '1234567890' }),
						})
						.toString()
						.toUpperCase(),
				),
			),
			!isLinux,
		);
		assert.strictEqual(
			trie.has(
				repoNested.uri.with({
					scheme: 'gitlens',
					authority: 'abcd',
					query: JSON.stringify({ ref: '1234567890' }),
				}),
			),
			true,
		);
		assert.strictEqual(
			trie.has(
				Uri.parse(
					repoNested.uri
						.with({
							scheme: 'gitlens',
							authority: 'abcd',
							query: JSON.stringify({ ref: '1234567890' }),
						})
						.toString()
						.toUpperCase(),
				),
			),
			!isLinux,
		);

		assert.strictEqual(
			trie.has(
				Uri.file('C:\\Users\\Name\\code\\company\\repo').with({
					scheme: 'gitlens',
					authority: 'abcd',
					query: JSON.stringify({ ref: '1234567890' }),
				}),
			),
			false,
		);
	});

	test('get(file://)', () => {
		assertRepoEntry(trie.get(repoGL.uri), repoGL);
		assertRepoEntry(trie.get(repoNested.uri), repoNested);

		assert.strictEqual(trie.get(Uri.file('C:\\Users\\Name\\code\\company\\repo')), undefined);
		assert.strictEqual(trie.get(Uri.file('D:\\Users\\Name\\code\\gitkraken\\vscode-gitlens')), undefined);
	});

	test('get(vscode-vfs://)', () => {
		assertRepoEntry(trie.get(repoGLvfs.uri), repoGLvfs);
		assertRepoEntry(trie.get(repoVSCvfs.uri), repoVSCvfs);

		assert.strictEqual(trie.get(Uri.file('C:\\Users\\Name\\code\\company\\repo')), undefined);
		assert.strictEqual(trie.get(Uri.file('D:\\Users\\Name\\code\\gitkraken\\vscode-gitlens')), undefined);
	});

	test('get(github://)', () => {
		assertRepoEntry(trie.get(repoGLvfs.uri.with({ scheme: 'github' })), repoGLvfs);
		assertRepoEntry(trie.get(repoVSCvfs.uri.with({ scheme: 'github' })), repoVSCvfs);
	});

	test('get(gitlens://)', () => {
		assertRepoEntry(
			trie.get(
				repoGL.uri.with({
					scheme: 'gitlens',
					authority: 'abcd',
					query: JSON.stringify({ ref: '1234567890' }),
				}),
			),
			repoGL,
		);

		assertRepoEntry(
			trie.get(
				repoNested.uri.with({
					scheme: 'gitlens',
					authority: 'abcd',
					query: JSON.stringify({ ref: '1234567890' }),
				}),
			),
			repoNested,
		);
	});

	test('get(file://) (ignore case)', () => {
		assertRepoEntryIgnoreCase(trie.get(repoGL.uri.with({ path: repoGL.uri.path.toUpperCase() })), repoGL);
		assertRepoEntryIgnoreCase(
			trie.get(repoNested.uri.with({ path: repoNested.uri.path.toUpperCase() })),
			repoNested,
		);
	});

	test('get(vscode://) (ignore case)', () => {
		assertRepoEntry(trie.get(repoGLvfs.uri.with({ scheme: 'VSCODE-VFS' })), repoGLvfs);

		assert.strictEqual(
			trie.get(repoGLvfs.uri.with({ authority: repoGLvfs.uri.authority.toUpperCase() })),
			undefined,
		);
		assert.strictEqual(trie.get(repoGLvfs.uri.with({ path: repoGLvfs.uri.path.toUpperCase() })), undefined);
	});

	test('get(github://) (ignore case)', () => {
		assertRepoEntry(trie.get(repoGLvfs.uri.with({ scheme: 'GITHUB' })), repoGLvfs);

		assert.strictEqual(
			trie.get(repoGLvfs.uri.with({ scheme: 'github', authority: repoGLvfs.uri.authority.toUpperCase() })),
			undefined,
		);
		assert.strictEqual(
			trie.get(repoGLvfs.uri.with({ scheme: 'github', path: repoGLvfs.uri.path.toUpperCase() })),
			undefined,
		);
	});

	test('get(gitlens://) (ignore case)', () => {
		assertRepoEntry(
			trie.get(
				repoGL.uri.with({
					scheme: 'GITLENS',
					authority: 'abcd',
					query: JSON.stringify({ ref: '1234567890' }),
				}),
			),
			repoGL,
		);

		assertRepoEntryIgnoreCase(
			trie.get(
				Uri.parse(
					repoGL.uri
						.with({
							scheme: 'gitlens',
							authority: 'abcd',
							query: JSON.stringify({ ref: '1234567890' }),
						})
						.toString()
						.toUpperCase(),
				),
			),
			repoGL,
		);
	});

	test('getClosest(file://)', () => {
		assertRepoEntry(trie.getClosest(repoGL.uri), repoGL);
		assert.strictEqual(trie.getClosest(repoGL.uri, true), undefined);
		assertRepoEntry(trie.getClosest(repoNested.uri), repoNested);
		assertRepoEntry(trie.getClosest(repoNested.uri, true), repoGL);

		assertRepoEntry(trie.getClosest(Uri.joinPath(repoGL.uri, 'src/extension.ts')), repoGL);
		assertRepoEntry(trie.getClosest(Uri.joinPath(repoNested.uri, 'src/index.ts')), repoNested);
	});

	test('getClosest(vscode-vfs://)', () => {
		assertRepoEntry(trie.getClosest(repoGLvfs.uri), repoGLvfs);
		assert.strictEqual(trie.getClosest(repoGLvfs.uri, true), undefined);
		assertRepoEntry(trie.getClosest(repoVSCvfs.uri), repoVSCvfs);
		assert.strictEqual(trie.getClosest(repoVSCvfs.uri, true), undefined);

		assertRepoEntry(trie.getClosest(Uri.joinPath(repoGLvfs.uri, 'src/extension.ts'), true), repoGLvfs);
		assertRepoEntry(trie.getClosest(Uri.joinPath(repoVSCvfs.uri, 'src/main.ts'), true), repoVSCvfs);
	});

	test('getClosest(github://)', () => {
		const repoGLvfsUri = repoGLvfs.uri.with({ scheme: 'github' });
		const repoVSCvfsUri = repoVSCvfs.uri.with({ scheme: 'github' });

		assertRepoEntry(trie.getClosest(repoGLvfsUri), repoGLvfs);
		assert.strictEqual(trie.getClosest(repoGLvfsUri, true), undefined);
		assertRepoEntry(trie.getClosest(repoVSCvfsUri), repoVSCvfs);
		assert.strictEqual(trie.getClosest(repoVSCvfsUri, true), undefined);

		assertRepoEntry(trie.getClosest(Uri.joinPath(repoGLvfsUri, 'src/extension.ts'), true), repoGLvfs);
		assertRepoEntry(trie.getClosest(Uri.joinPath(repoVSCvfsUri, 'src/main.ts'), true), repoVSCvfs);
	});

	test('getClosest(gitlens://)', () => {
		const repoGLUri = Uri.joinPath(repoGL.uri, 'src/extension.ts').with({
			scheme: 'gitlens',
			authority: 'abcd',
			query: JSON.stringify({ ref: '1234567890' }),
		});
		const repoNestedUri = Uri.joinPath(repoNested.uri, 'src/index.ts').with({
			scheme: 'gitlens',
			authority: 'abcd',
			query: JSON.stringify({ ref: '1234567890' }),
		});

		assertRepoEntry(trie.getClosest(repoGLUri), repoGL);
		assertRepoEntry(trie.getClosest(repoNestedUri), repoNested);
	});

	test('getClosest: missing', () => {
		assert.strictEqual(
			trie.getClosest(Uri.file('C:\\Users\\Name\\code\\company\\repo\\foo\\bar\\baz.ts')),
			undefined,
		);
	});

	test('getDescendants', () => {
		const descendants = [...trie.getDescendants()];
		assert.strictEqual(descendants.length, 4);
	});
});
