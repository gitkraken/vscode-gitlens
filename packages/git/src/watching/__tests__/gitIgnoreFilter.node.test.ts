import assert from 'node:assert';
import { describe, it } from 'node:test';
import type { FileSystemProvider } from '../../context.js';
import { GitIgnoreFilter } from '../gitIgnoreFilter.js';

const encoder = new TextEncoder();

function mockFs(files: Record<string, string>): FileSystemProvider {
	return {
		readFile: async function (uri) {
			const path = uri.path ?? uri.fsPath;
			const content = files[path];
			if (content == null) throw new Error(`ENOENT: ${path}`);
			return encoder.encode(content);
		},
		stat: async function () {
			return undefined;
		},
		readDirectory: async function () {
			return [];
		},
	};
}

function mockFsWithReadFile(readFileFn: (path: string) => string | undefined): FileSystemProvider {
	return {
		readFile: async function (uri) {
			const path = uri.path ?? uri.fsPath;
			const content = readFileFn(path);
			if (content == null) throw new Error(`ENOENT: ${path}`);
			return encoder.encode(content);
		},
		stat: async function () {
			return undefined;
		},
		readDirectory: async function () {
			return [];
		},
	};
}

function throwingFs(): FileSystemProvider {
	return {
		readFile: async function () {
			throw new Error('disk error');
		},
		stat: async function () {
			return undefined;
		},
		readDirectory: async function () {
			return [];
		},
	};
}

describe('GitIgnoreFilter', () => {
	describe('pattern loading', () => {
		it('loads patterns from .gitignore', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': 'node_modules\n*.log\n',
				}),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('node_modules'));
			assert.ok(filter.isIgnored('node_modules/foo/bar.js'));
			assert.ok(filter.isIgnored('error.log'));
			assert.ok(!filter.isIgnored('src/index.ts'));
		});

		it('loads patterns from .git/info/exclude', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.git/info/exclude': '.idea\n*.swp\n',
				}),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('.idea'));
			assert.ok(filter.isIgnored('src/file.swp'));
			assert.ok(!filter.isIgnored('src/index.ts'));
		});

		it('loads patterns from global excludes (core.excludesFile)', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/home/user/.gitignore_global': '.DS_Store\nThumbs.db\n',
				}),
				getGlobalExcludesPath: async () => '/home/user/.gitignore_global',
			});

			await filter.ready();

			assert.ok(filter.isIgnored('.DS_Store'));
			assert.ok(filter.isIgnored('Thumbs.db'));
			assert.ok(!filter.isIgnored('src/index.ts'));
		});

		it('combines patterns from all sources', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': 'node_modules\n',
					'/repo/.git/info/exclude': '.idea\n',
					'/home/user/.gitignore_global': '.DS_Store\n',
				}),
				getGlobalExcludesPath: async () => '/home/user/.gitignore_global',
			});

			await filter.ready();

			assert.ok(filter.isIgnored('node_modules'));
			assert.ok(filter.isIgnored('.idea'));
			assert.ok(filter.isIgnored('.DS_Store'));
			assert.ok(!filter.isIgnored('src/index.ts'));
		});

		it('handles missing files gracefully', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({}), // No files exist
			});

			await filter.ready();

			// Nothing is ignored when no patterns are loaded
			assert.ok(!filter.isIgnored('node_modules'));
			assert.ok(!filter.isIgnored('src/index.ts'));
		});

		it('handles getGlobalExcludesPath returning undefined', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({}),
				getGlobalExcludesPath: async () => undefined,
			});

			await filter.ready();

			// Should not throw
			assert.ok(!filter.isIgnored('anything'));
		});

		it('handles readFile throwing errors gracefully', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: throwingFs(),
			});

			await filter.ready();

			// Should not throw, nothing is ignored
			assert.ok(!filter.isIgnored('anything'));
		});
	});

	describe('isIgnored', () => {
		it('returns false for empty paths', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': '*\n',
				}),
			});

			await filter.ready();

			assert.ok(!filter.isIgnored(''));
		});

		it('supports negation patterns', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': '*.log\n!important.log\n',
				}),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('error.log'));
			assert.ok(!filter.isIgnored('important.log'));
		});

		it('supports directory patterns', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': 'build/\ndist/\n',
				}),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('build/output.js'));
			assert.ok(filter.isIgnored('dist/bundle.js'));
			assert.ok(!filter.isIgnored('src/build.ts'));
		});

		it('supports wildcard patterns', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': '*.min.js\n**/*.map\n',
				}),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('bundle.min.js'));
			assert.ok(filter.isIgnored('src/deep/file.map'));
			assert.ok(!filter.isIgnored('bundle.js'));
		});

		it('handles comments and blank lines', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': '# This is a comment\n\nnode_modules\n\n# Another comment\n*.log\n',
				}),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('node_modules'));
			assert.ok(filter.isIgnored('error.log'));
			assert.ok(!filter.isIgnored('src/index.ts'));
		});
	});

	describe('filter', () => {
		it('returns only non-ignored paths', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': 'node_modules\n*.log\n',
				}),
			});

			await filter.ready();

			const result = filter.filter(['src/index.ts', 'node_modules/foo/bar.js', 'error.log', 'src/utils.ts']);

			assert.deepStrictEqual(result, ['src/index.ts', 'src/utils.ts']);
		});
	});

	describe('refresh', () => {
		it('reloads patterns from all sources', async () => {
			let gitignoreContent = 'node_modules\n';

			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFsWithReadFile((path: string) => {
					if (path === '/repo/.gitignore') return gitignoreContent;
					return undefined;
				}),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('node_modules'));
			assert.ok(!filter.isIgnored('dist'));

			// Update the file content and refresh
			gitignoreContent = 'node_modules\ndist\n';
			await filter.refresh();

			assert.ok(filter.isIgnored('node_modules'));
			assert.ok(filter.isIgnored('dist'));
		});

		it('handles refresh when patterns were previously empty', async () => {
			let gitignoreContent: string | undefined;

			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFsWithReadFile((path: string) => {
					if (path === '/repo/.gitignore') return gitignoreContent;
					return undefined;
				}),
			});

			await filter.ready();
			assert.ok(!filter.isIgnored('node_modules'));

			// Now create the .gitignore
			gitignoreContent = 'node_modules\n';
			await filter.refresh();

			assert.ok(filter.isIgnored('node_modules'));
		});
	});

	describe('ready', () => {
		it('is safe to call multiple times', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': 'node_modules\n',
				}),
			});

			await filter.ready();
			await filter.ready();
			await filter.ready();

			assert.ok(filter.isIgnored('node_modules'));
		});
	});

	describe('worktree git dir', () => {
		it('loads info/exclude from the correct git dir path', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/worktrees/A',
				gitDirPath: '/repo/.git/worktrees/A',
				fs: mockFs({
					'/worktrees/A/.gitignore': 'node_modules\n',
					'/repo/.git/worktrees/A/info/exclude': '.idea\n',
				}),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('node_modules'));
			assert.ok(filter.isIgnored('.idea'));
		});
	});
});
