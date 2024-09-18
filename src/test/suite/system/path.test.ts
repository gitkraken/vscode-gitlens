import * as assert from 'assert';
import { splitPath } from '../../../system/vscode/command';

describe('Path Test Suite', () => {
	function assertSplitPath(actual: [string, string], expected: [string, string]) {
		assert.strictEqual(actual[0], expected[0]);
		assert.strictEqual(actual[1], expected[1]);
	}

	it('splitPath: no repoPath', () => {
		assertSplitPath(splitPath('C:\\User\\Name\\code\\gitkraken\\vscode-gitlens', ''), [
			'c:/User/Name/code/gitkraken/vscode-gitlens',
			'',
		]);

		assertSplitPath(splitPath('C:\\User\\Name\\code\\gitkraken\\vscode-gitlens\\', ''), [
			'c:/User/Name/code/gitkraken/vscode-gitlens',
			'',
		]);

		assertSplitPath(splitPath('C:/User/Name/code/gitkraken/vscode-gitlens', ''), [
			'c:/User/Name/code/gitkraken/vscode-gitlens',
			'',
		]);

		assertSplitPath(splitPath('C:/User/Name/code/gitkraken/vscode-gitlens/', ''), [
			'c:/User/Name/code/gitkraken/vscode-gitlens',
			'',
		]);
	});

	it('splitPath: no repoPath (split base)', () => {
		assertSplitPath(splitPath('C:\\User\\Name\\code\\gitkraken\\vscode-gitlens', '', true), [
			'vscode-gitlens',
			'c:/User/Name/code/gitkraken',
		]);

		assertSplitPath(splitPath('C:\\User\\Name\\code\\gitkraken\\vscode-gitlens\\', '', true), [
			'vscode-gitlens',
			'c:/User/Name/code/gitkraken',
		]);

		assertSplitPath(splitPath('C:/User/Name/code/gitkraken/vscode-gitlens', '', true), [
			'vscode-gitlens',
			'c:/User/Name/code/gitkraken',
		]);

		assertSplitPath(splitPath('C:/User/Name/code/gitkraken/vscode-gitlens/', '', true), [
			'vscode-gitlens',
			'c:/User/Name/code/gitkraken',
		]);
	});

	it('splitPath: match', () => {
		assertSplitPath(
			splitPath(
				'C:\\User\\Name\\code\\gitkraken\\vscode-gitlens\\foo\\bar\\baz.ts',
				'C:\\User\\Name\\code\\gitkraken\\vscode-gitlens',
			),
			['foo/bar/baz.ts', 'c:/User/Name/code/gitkraken/vscode-gitlens'],
		);

		assertSplitPath(
			splitPath(
				'C:\\User\\Name\\code\\gitkraken\\vscode-gitlens\\foo\\bar\\baz.ts',
				'C:\\User\\Name\\code\\gitkraken\\vscode-gitlens\\',
			),
			['foo/bar/baz.ts', 'c:/User/Name/code/gitkraken/vscode-gitlens'],
		);

		assertSplitPath(
			splitPath(
				'C:\\User\\Name\\code\\gitkraken\\vscode-gitlens\\foo\\bar\\baz.ts',
				'c:/User/Name/code/gitkraken/vscode-gitlens',
			),
			['foo/bar/baz.ts', 'c:/User/Name/code/gitkraken/vscode-gitlens'],
		);

		assertSplitPath(
			splitPath(
				'C:\\User\\Name\\code\\gitkraken\\vscode-gitlens\\foo\\bar\\baz.ts',
				'c:/User/Name/code/gitkraken/vscode-gitlens/',
			),
			['foo/bar/baz.ts', 'c:/User/Name/code/gitkraken/vscode-gitlens'],
		);

		assertSplitPath(
			splitPath(
				'C:/User/Name/code/gitkraken/vscode-gitlens/foo/bar/baz.ts',
				'c:/User/Name/code/gitkraken/vscode-gitlens',
			),
			['foo/bar/baz.ts', 'c:/User/Name/code/gitkraken/vscode-gitlens'],
		);

		assertSplitPath(
			splitPath(
				'C:/User/Name/code/gitkraken/vscode-gitlens/foo/bar/baz.ts',
				'c:/User/Name/code/gitkraken/vscode-gitlens/',
			),
			['foo/bar/baz.ts', 'c:/User/Name/code/gitkraken/vscode-gitlens'],
		);
	});

	it('splitPath: match (casing)', () => {
		assertSplitPath(
			splitPath(
				'C:/USER/NAME/CODE/GITKRAKEN/VSCODE-GITLENS/FOO/BAR/BAZ.TS',
				'c:/User/Name/code/gitkraken/vscode-gitlens/',
				undefined,
				true,
			),
			['FOO/BAR/BAZ.TS', 'c:/USER/NAME/CODE/GITKRAKEN/VSCODE-GITLENS'],
		);

		assertSplitPath(
			splitPath(
				'C:/USER/NAME/CODE/GITKRAKEN/VSCODE-GITLENS/FOO/BAR/BAZ.TS',
				'c:/User/Name/code/gitkraken/vscode-gitlens/',
				undefined,
				false,
			),
			['USER/NAME/CODE/GITKRAKEN/VSCODE-GITLENS/FOO/BAR/BAZ.TS', 'c:'],
		);

		assertSplitPath(
			splitPath(
				'/USER/NAME/CODE/GITKRAKEN/VSCODE-GITLENS/FOO/BAR/BAZ.TS',
				'/User/Name/code/gitkraken/vscode-gitlens/',
				undefined,
				true,
			),
			['FOO/BAR/BAZ.TS', '/USER/NAME/CODE/GITKRAKEN/VSCODE-GITLENS'],
		);

		assertSplitPath(
			splitPath(
				'/USER/NAME/CODE/GITKRAKEN/VSCODE-GITLENS/FOO/BAR/BAZ.TS',
				'/User/Name/code/gitkraken/vscode-gitlens/',
				undefined,
				false,
			),
			['/USER/NAME/CODE/GITKRAKEN/VSCODE-GITLENS/FOO/BAR/BAZ.TS', '/User/Name/code/gitkraken/vscode-gitlens'],
		);
	});

	it('splitPath: no match', () => {
		assertSplitPath(
			splitPath(
				'/foo/User/Name/code/gitkraken/vscode-gitlens/foo/bar/baz.ts',
				'/User/Name/code/gitkraken/vscode-gitlens',
			),
			['/foo/User/Name/code/gitkraken/vscode-gitlens/foo/bar/baz.ts', '/User/Name/code/gitkraken/vscode-gitlens'],
		);
	});
});
