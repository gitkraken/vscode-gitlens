import assert from 'node:assert';
import { describe, it } from 'node:test';
import { isLinux } from '@gitlens/utils/platform.js';
import type { FileSystemProvider } from '../../context.js';
import { FileType } from '../../context.js';
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

/** Resolves each read only after every file later in `order` has resolved, so reads complete in reverse order */
function reverseOrderFs(files: Record<string, string>, order: readonly string[]): FileSystemProvider {
	const settled = new Map<string, Promise<void>>();
	const resolvers = new Map<string, () => void>();
	for (const path of order) {
		settled.set(
			path,
			new Promise<void>(resolve => {
				resolvers.set(path, resolve);
			}),
		);
	}

	return {
		readFile: async function (uri) {
			const path = uri.path ?? uri.fsPath;
			const index = order.indexOf(path);
			try {
				for (const later of order.slice(index + 1)) {
					await settled.get(later);
				}
				// Yield a few ticks so a reader that resolved earlier has finished its own work
				await new Promise(resolve => setTimeout(resolve, 5));

				const content = files[path];
				if (content == null) throw new Error(`ENOENT: ${path}`);
				return encoder.encode(content);
			} finally {
				resolvers.get(path)?.();
			}
		},
		stat: async function () {
			return undefined;
		},
		readDirectory: async function () {
			return [];
		},
	};
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

interface StampedFile {
	content: string;
	mtime: number;
}

/**
 * A mutable fs whose stats report each file's `mtime` and content length, recording every path stat'ed and read.
 * While `hold` is set, a stat waits on it.
 */
function stampedFs(files: Map<string, StampedFile>): {
	fs: FileSystemProvider;
	stats: string[];
	reads: string[];
	hold: Promise<void> | undefined;
	/** Called on each read, before the content is taken */
	onRead?: (path: string) => void;
	/** Paths whose stat throws */
	failing: Set<string>;
} {
	const state: ReturnType<typeof stampedFs> = {
		fs: {
			readFile: async function (uri) {
				const path = uri.path ?? uri.fsPath;
				state.reads.push(path);
				state.onRead?.(path);
				const file = files.get(path);
				if (file == null) throw new Error(`ENOENT: ${path}`);
				return encoder.encode(file.content);
			},
			stat: async function (uri) {
				const path = uri.path ?? uri.fsPath;
				state.stats.push(path);
				if (state.hold != null) {
					await state.hold;
				}
				if (state.failing.has(path)) throw new Error('EIO');

				const file = files.get(path);
				return file != null
					? { type: FileType.File, ctime: 0, mtime: file.mtime, size: encoder.encode(file.content).length }
					: undefined;
			},
			readDirectory: async function () {
				return [];
			},
		},
		stats: [],
		reads: [],
		hold: undefined,
		failing: new Set(),
	};
	return state;
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
	describe('case sensitivity', () => {
		it('falls back to the platform default when `core.ignorecase` is unset (case-sensitive on Linux)', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({ '/repo/.gitignore': 'build/\n' }),
				getIgnoreCase: async () => undefined,
			});

			await filter.ready();

			assert.ok(filter.isIgnored('build/x.js'));
			assert.strictEqual(filter.isIgnored('Build/x.js'), !isLinux);
		});

		it('falls back to the platform default when `core.ignorecase` cannot be read', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({ '/repo/.gitignore': 'build/\n' }),
				getIgnoreCase: () => Promise.reject(new Error('git failed')),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('build/x.js'));
			assert.strictEqual(filter.isIgnored('Build/x.js'), !isLinux);
		});

		it('follows `core.ignorecase` over the platform default, in root and nested files alike', async () => {
			const ignoreCase = isLinux;
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({ '/repo/.gitignore': 'build/\n', '/repo/pkg/.gitignore': 'out/\n' }),
				getGitIgnorePaths: async () => ['.gitignore', 'pkg/.gitignore'],
				getIgnoreCase: async () => ignoreCase,
			});

			await filter.ready();

			assert.ok(filter.isIgnored('build/x.js'));
			assert.strictEqual(filter.isIgnored('Build/x.js'), ignoreCase);
			assert.ok(filter.isIgnored('pkg/out/x.js'));
			assert.strictEqual(filter.isIgnored('pkg/Out/x.js'), ignoreCase);
		});
	});

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

	describe('refresh coalescing', () => {
		it('runs refreshes made during a load as one trailing load, which ready() waits for', async () => {
			const loads: (() => void)[] = [];
			let gitignoreContent = 'node_modules\n';
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFsWithReadFile(path => (path === '/repo/.gitignore' ? gitignoreContent : undefined)),
				getGitIgnorePaths: () =>
					new Promise<readonly string[]>(resolve => loads.push(() => resolve(['.gitignore']))),
			});
			assert.strictEqual(loads.length, 1, 'the initial load is in flight');

			gitignoreContent = 'node_modules\ndist\n';
			const refreshes = [
				filter.refresh(),
				filter.refresh(),
				filter.refresh(),
				filter.refresh(),
				filter.refresh(),
			];
			let refreshed = 0;
			const onRefreshed = (): void => {
				refreshed++;
			};
			for (const r of refreshes) {
				void r.then(onRefreshed);
			}
			let ready = false;
			void filter.ready().then(() => (ready = true));

			await delay(10);
			assert.strictEqual(loads.length, 1, 'nothing more starts while a load is in flight');

			loads[0]();
			await delay(10);
			assert.strictEqual(loads.length, 2, 'exactly one trailing load starts once the first settles');
			assert.strictEqual(ready, false, 'ready() waits for the trailing load, not just the first');
			assert.strictEqual(refreshed, 0);

			loads[1]();
			await delay(10);
			assert.strictEqual(ready, true);
			assert.strictEqual(refreshed, 5);
			assert.strictEqual(loads.length, 2);
			assert.ok(filter.isIgnored('dist'));
		});

		it('starts a refresh at once when no load is in flight', async () => {
			let discoveries = 0;
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({}),
				getGitIgnorePaths: async () => {
					discoveries++;
					return [];
				},
			});
			await filter.ready();
			assert.strictEqual(discoveries, 1);

			const refresh = filter.refresh();
			assert.strictEqual(discoveries, 2, 'the reload is not deferred');
			await refresh;
		});
	});

	describe('revalidate', () => {
		const globalPath = '/home/user/.gitignore_global';

		function sourcesFilter(
			setup?: (
				files: Map<string, StampedFile>,
				io: ReturnType<typeof stampedFs>,
				config: { discovery: Promise<void> | undefined },
			) => void,
		) {
			const files = new Map<string, StampedFile>([
				[globalPath, { content: '.DS_Store\n', mtime: 1 }],
				['/repo/.git/info/exclude', { content: '.idea\n', mtime: 1 }],
				['/repo/.gitignore', { content: 'node_modules\n', mtime: 1 }],
				['/repo/pkg/.gitignore', { content: 'out/\n', mtime: 1 }],
			]);
			const io = stampedFs(files);
			const config = {
				globalPath: globalPath as string | undefined,
				infoPath: '/repo/.git/info/exclude' as string | undefined,
				ignoreCase: false as boolean | undefined,
				discoveries: 0,
				/** While set, nested discovery waits on it */
				discovery: undefined as Promise<void> | undefined,
			};
			setup?.(files, io, config);
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: io.fs,
				getGlobalExcludesPath: async () => config.globalPath,
				getInfoExcludePath: async () => config.infoPath,
				getGitIgnorePaths: async () => {
					config.discoveries++;
					if (config.discovery != null) {
						await config.discovery;
					}
					return ['.gitignore', 'pkg/.gitignore'];
				},
				getIgnoreCase: async () => config.ignoreCase,
			});
			return { filter: filter, files: files, io: io, config: config };
		}

		async function loadedFilter(setup?: Parameters<typeof sourcesFilter>[0]) {
			const loaded = sourcesFilter(setup);
			await loaded.filter.ready();
			loaded.io.stats.length = 0;
			loaded.io.reads.length = 0;
			return loaded;
		}

		function gate(): { promise: Promise<void>; release: () => void } {
			let release!: () => void;
			const promise = new Promise<void>(resolve => (release = resolve));
			return { promise: promise, release: release };
		}

		it("resolves false, stat'ing every source and reading none, when nothing changed", async () => {
			const { filter, io, config } = await loadedFilter();

			assert.strictEqual(await filter.revalidate(), false);

			assert.deepStrictEqual(
				[...io.stats].sort(),
				[globalPath, '/repo/.git/info/exclude', '/repo/.gitignore', '/repo/pkg/.gitignore'].sort(),
			);
			assert.deepStrictEqual(io.reads, []);
			assert.strictEqual(config.discoveries, 1, 'nested files are not rediscovered');
		});

		for (const { source, path, content, mtime, ignored } of [
			{
				source: 'the root .gitignore (mtime)',
				path: '/repo/.gitignore',
				content: 'dist/\nbuild/\n',
				mtime: 2,
				ignored: 'dist/a.js',
			},
			{
				source: 'info/exclude (size)',
				path: '/repo/.git/info/exclude',
				content: '.idea\n.vscode\n',
				mtime: 1,
				ignored: '.vscode',
			},
			{
				source: 'the global excludes file (mtime)',
				path: globalPath,
				content: 'Thumbs.db\n',
				mtime: 2,
				ignored: 'Thumbs.db',
			},
			{
				source: 'a nested .gitignore (size)',
				path: '/repo/pkg/.gitignore',
				content: 'out/\ngen/\n',
				mtime: 1,
				ignored: 'pkg/gen/x.ts',
			},
		]) {
			it(`reloads when ${source} changed, and the new rules apply once ready`, async () => {
				const { filter, files, config } = await loadedFilter();
				assert.ok(!filter.isIgnored(ignored));

				files.set(path, { content: content, mtime: mtime });

				assert.strictEqual(await filter.revalidate(), true);
				await filter.ready();
				assert.ok(filter.isIgnored(ignored));
				assert.strictEqual(config.discoveries, 2, 'the reload is a full one');
			});
		}

		it('reloads when a source appears', async () => {
			const { filter, files } = await loadedFilter(files => files.delete('/repo/.gitignore'));
			assert.ok(!filter.isIgnored('node_modules'));

			files.set('/repo/.gitignore', { content: 'node_modules\n', mtime: 1 });

			assert.strictEqual(await filter.revalidate(), true);
			assert.ok(filter.isIgnored('node_modules'));
		});

		it('reloads when `core.ignorecase` changed', async () => {
			const { filter, config } = await loadedFilter();
			assert.ok(!filter.isIgnored('NODE_MODULES'));

			config.ignoreCase = true;

			assert.strictEqual(await filter.revalidate(), true);
			assert.ok(filter.isIgnored('NODE_MODULES'));
		});

		it('reloads when `core.excludesFile` points elsewhere', async () => {
			const { filter, files, config } = await loadedFilter();

			files.set('/home/user/other', { content: 'Thumbs.db\n', mtime: 1 });
			config.globalPath = '/home/user/other';

			assert.strictEqual(await filter.revalidate(), true);
			assert.ok(filter.isIgnored('Thumbs.db'));
			assert.ok(!filter.isIgnored('.DS_Store'));
		});

		it('reloads when `info/exclude` resolves elsewhere', async () => {
			const { filter, files, config } = await loadedFilter();

			files.set('/common/.git/info/exclude', { content: '.vscode\n', mtime: 1 });
			config.infoPath = '/common/.git/info/exclude';

			assert.strictEqual(await filter.revalidate(), true);
			assert.ok(filter.isIgnored('.vscode'));
			assert.ok(!filter.isIgnored('.idea'));
		});

		it("counts a source that can't be stat'ed as changed", async () => {
			const { filter, io } = await loadedFilter();

			io.failing.add('/repo/.gitignore');

			assert.strictEqual(await filter.revalidate(), true);
		});

		it('sees an edit that landed between a load stamping a source and reading it', async () => {
			let edited = false;
			const { filter } = await loadedFilter((files, io) => {
				io.onRead = path => {
					if (path !== '/repo/.gitignore' || edited) return;

					edited = true;
					files.set(path, { content: 'dist/\n', mtime: 2 });
				};
			});
			assert.ok(filter.isIgnored('dist/a.js'), 'the load read the edited content');

			assert.strictEqual(await filter.revalidate(), true);
		});

		it('resolves false without a stat while a load is in flight', async () => {
			const { filter, io, config } = await loadedFilter();
			const discovery = gate();
			config.discovery = discovery.promise;
			const refresh = filter.refresh();

			assert.strictEqual(await filter.revalidate(), false);
			await delay(10);
			assert.ok(!io.stats.includes('/repo/pkg/.gitignore'), 'only the held load has stat-ed, and not yet nested');

			discovery.release();
			await refresh;
		});

		it('resolves false without a stat on a filter that has never loaded', async () => {
			const discovery = gate();
			const { filter, io } = sourcesFilter((_files, _io, config) => (config.discovery = discovery.promise));

			assert.strictEqual(await filter.revalidate(), false);
			await delay(10);
			assert.ok(!io.stats.includes('/repo/pkg/.gitignore'));

			discovery.release();
			await filter.ready();
		});

		it('makes ready() wait for the reload it starts', async () => {
			const { filter, files } = await loadedFilter();
			files.set('/repo/.gitignore', { content: 'dist/\n', mtime: 2 });

			void filter.revalidate();
			await filter.ready();

			assert.ok(filter.isIgnored('dist/a.js'));
		});

		it('shares one revalidation among concurrent calls', async () => {
			const { filter, files, config } = await loadedFilter();
			files.set('/repo/.gitignore', { content: 'dist/\n', mtime: 2 });

			const first = filter.revalidate();
			assert.strictEqual(filter.revalidate(), first);
			assert.strictEqual(await first, true);
			assert.strictEqual(config.discoveries, 2);
		});

		it('lets a refresh made during it land, and reloads nothing more on its behalf', async () => {
			const { filter, files, io, config } = await loadedFilter();
			files.set('/repo/.gitignore', { content: 'dist/\n', mtime: 2 });

			const stats = gate();
			io.hold = stats.promise;
			const revalidation = filter.revalidate();
			io.hold = undefined;

			await filter.refresh();
			assert.ok(filter.isIgnored('dist/a.js'));

			stats.release();
			assert.strictEqual(await revalidation, false, 'the refresh already read the change');
			await filter.ready();
			assert.strictEqual(config.discoveries, 2, 'no reload beyond the refresh');
		});

		it('makes ready() also wait for a refresh made during it', async () => {
			const { filter, files, io, config } = await loadedFilter();

			const stats = gate();
			io.hold = stats.promise;
			void filter.revalidate();
			io.hold = undefined;

			let ready = false;
			void filter.ready().then(() => (ready = true));

			const discovery = gate();
			config.discovery = discovery.promise;
			files.set('/repo/.gitignore', { content: 'dist/\n', mtime: 2 });
			void filter.refresh();

			stats.release();
			await delay(10);
			assert.strictEqual(ready, false, 'the refresh is still loading');

			discovery.release();
			await delay(10);
			assert.strictEqual(ready, true);
			assert.ok(filter.isIgnored('dist/a.js'));
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

	describe('precedence', () => {
		it('applies core.excludesFile < info/exclude < .gitignore regardless of read completion order', async () => {
			const completed: string[] = [];
			const files = {
				'/home/user/.gitignore_global': 'foo.txt\n!baz.txt\n',
				'/repo/.git/info/exclude': '!foo.txt\nbar.txt\nbaz.txt\n',
				'/repo/.gitignore': '!bar.txt\n',
			};
			// `.gitignore` finishes first and the global excludes file last — the reverse of git's order
			const fs = reverseOrderFs(files, [
				'/home/user/.gitignore_global',
				'/repo/.git/info/exclude',
				'/repo/.gitignore',
			]);
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: {
					...fs,
					readFile: async uri => {
						const data = await fs.readFile(uri);
						completed.push(uri.path);
						return data;
					},
				},
				getGlobalExcludesPath: async () => '/home/user/.gitignore_global',
			});

			await filter.ready();

			assert.deepStrictEqual(completed, [
				'/repo/.gitignore',
				'/repo/.git/info/exclude',
				'/home/user/.gitignore_global',
			]);
			// info/exclude re-includes what core.excludesFile ignored
			assert.ok(!filter.isIgnored('foo.txt'));
			// .gitignore re-includes what info/exclude ignored
			assert.ok(!filter.isIgnored('bar.txt'));
			// info/exclude ignores what core.excludesFile re-included
			assert.ok(filter.isIgnored('baz.txt'));
		});

		it('reads info/exclude from getInfoExcludePath instead of gitDirPath', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/worktrees/A',
				gitDirPath: '/repo/.git/worktrees/A',
				fs: mockFs({
					'/repo/.git/worktrees/A/info/exclude': 'wrong\n',
					'/repo/.git/info/exclude': '.idea\n',
				}),
				getInfoExcludePath: async () => '/repo/.git/info/exclude',
			});

			await filter.ready();

			assert.ok(filter.isIgnored('.idea'));
			assert.ok(!filter.isIgnored('wrong'));
		});
	});

	describe('nested .gitignore', () => {
		function nestedFilter(files: Record<string, string>, getGitIgnorePaths?: () => Promise<readonly string[]>) {
			return new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs(files),
				getGitIgnorePaths:
					getGitIgnorePaths ??
					(async () =>
						Object.keys(files)
							.filter(p => p.startsWith('/repo/') && p.endsWith('.gitignore'))
							.map(p => p.slice('/repo/'.length))),
			});
		}

		it('applies a nested pattern only within its directory', async () => {
			const filter = nestedFilter({
				'/repo/.gitignore': 'node_modules\n',
				'/repo/pkg/.gitignore': '*.gen.ts\n',
			});

			await filter.ready();

			assert.ok(filter.isIgnored('pkg/a.gen.ts'));
			assert.ok(filter.isIgnored('pkg/deep/b.gen.ts'));
			assert.ok(!filter.isIgnored('a.gen.ts'));
			assert.ok(!filter.isIgnored('other/a.gen.ts'));
			assert.ok(!filter.isIgnored('pkg/a.ts'));
			// Root patterns still apply below a nested .gitignore
			assert.ok(filter.isIgnored('pkg/node_modules/x.js'));
		});

		it('anchors a leading-slash pattern to the nested directory', async () => {
			const filter = nestedFilter({
				'/repo/pkg/.gitignore': '/out\n',
			});

			await filter.ready();

			assert.ok(filter.isIgnored('pkg/out'));
			assert.ok(filter.isIgnored('pkg/out/x.js'));
			assert.ok(!filter.isIgnored('out'));
			assert.ok(!filter.isIgnored('pkg/sub/out'));
		});

		it('lets a deeper negation re-include a file', async () => {
			const filter = nestedFilter({
				'/repo/.gitignore': '*.log\n',
				'/repo/pkg/.gitignore': '!keep.log\n',
			});

			await filter.ready();

			assert.ok(filter.isIgnored('pkg/other.log'));
			assert.ok(!filter.isIgnored('pkg/keep.log'));
			assert.ok(!filter.isIgnored('pkg/sub/keep.log'));
			assert.ok(filter.isIgnored('keep.log'));
		});

		it('lets a deeper negation re-include a directory a shallower file ignored', async () => {
			const filter = nestedFilter({
				'/repo/.gitignore': 'pkg/build/\n',
				'/repo/pkg/.gitignore': '!build/\n',
			});

			await filter.ready();

			assert.ok(!filter.isIgnored('pkg/build/'));
			assert.ok(!filter.isIgnored('pkg/build/x.txt'));
		});

		it('answers not ignored when a shallower file ignored a directory a deeper file re-included', async () => {
			const filter = nestedFilter({
				'/repo/.gitignore': 'pkg/cache/\n*.txt\n',
				'/repo/pkg/.gitignore': '!cache/\n',
			});

			await filter.ready();

			assert.ok(!filter.isIgnored('pkg/cache/'));
			// Git says ignored (root's `*.txt`), but `ignore` folds root's own verdict for `pkg/cache/` into this
			// result, hiding whether `*.txt` matched — so the filter errs toward keeping the change
			assert.ok(!filter.isIgnored('pkg/cache/x.txt'));
			assert.ok(filter.isIgnored('pkg/x.txt'));
		});

		it('never re-includes below an ignored ancestor directory', async () => {
			const filter = nestedFilter({
				'/repo/.gitignore': 'dist/\n',
				'/repo/pkg/.gitignore': '!dist/keep.js\n',
				// Inside an ignored directory — git never reads it
				'/repo/dist/.gitignore': '!*\n',
			});

			await filter.ready();

			assert.ok(filter.isIgnored('dist/'));
			assert.ok(filter.isIgnored('dist/a.js'));
			assert.ok(filter.isIgnored('dist/sub/b.js'));
			assert.ok(filter.isIgnored('pkg/dist/keep.js'));
		});

		it('matches directory-only patterns against ancestor directories', async () => {
			const filter = nestedFilter({
				'/repo/pkg/.gitignore': 'cache/\n',
			});

			await filter.ready();

			assert.ok(filter.isIgnored('pkg/cache/'));
			assert.ok(filter.isIgnored('pkg/cache/a/b.bin'));
			// A file named `cache` isn't a directory
			assert.ok(!filter.isIgnored('pkg/cache'));
		});

		it('uses the nested semantics in filter()', async () => {
			const filter = nestedFilter({
				'/repo/.gitignore': '*.log\n',
				'/repo/pkg/.gitignore': '!keep.log\n/out\n',
			});

			await filter.ready();

			assert.deepStrictEqual(filter.filter(['a.log', 'pkg/keep.log', 'pkg/out/x.js', 'out/x.js', '']), [
				'pkg/keep.log',
				'out/x.js',
				'',
			]);
		});

		it('keeps root-only behavior without getGitIgnorePaths', async () => {
			const filter = new GitIgnoreFilter({
				repoPath: '/repo',
				gitDirPath: '/repo/.git',
				fs: mockFs({
					'/repo/.gitignore': '*.log\n',
					'/repo/pkg/.gitignore': '!keep.log\n*.gen.ts\n',
				}),
			});

			await filter.ready();

			assert.ok(filter.isIgnored('pkg/keep.log'));
			assert.ok(!filter.isIgnored('pkg/a.gen.ts'));
		});

		it('falls back to root-only when discovery fails', async () => {
			const filter = nestedFilter(
				{
					'/repo/.gitignore': '*.log\n',
					'/repo/pkg/.gitignore': '!keep.log\n*.gen.ts\n',
				},
				async () => {
					throw new Error('git failed');
				},
			);

			await filter.ready();

			assert.ok(filter.isIgnored('pkg/keep.log'));
			assert.ok(filter.isIgnored('a.log'));
			assert.ok(!filter.isIgnored('pkg/a.gen.ts'));
		});

		it('rediscovers nested files on refresh', async () => {
			const paths = ['.gitignore'];
			const filter = nestedFilter(
				{
					'/repo/.gitignore': '*.log\n',
					'/repo/pkg/.gitignore': '!keep.log\n',
				},
				async () => paths,
			);

			await filter.ready();
			assert.ok(filter.isIgnored('pkg/keep.log'));

			paths.push('pkg/.gitignore');
			await filter.refresh();

			assert.ok(!filter.isIgnored('pkg/keep.log'));
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
