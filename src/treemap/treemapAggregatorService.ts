import type { CancellationToken, Disposable, Event, Uri } from 'vscode';
import { CancellationTokenSource, EventEmitter, RelativePattern, workspace } from 'vscode';
import type { GitLog } from '@gitlens/git/models/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../container.js';
import type {
	CommitFrequencyData,
	TreemapConfig,
	TreemapData,
	TreemapMode,
	TreemapNode,
} from '../webviews/plus/treemap/protocol.js';

const oneYearMs = 365 * 24 * 60 * 60 * 1000;

// Sentinel error used to distinguish caller-initiated aborts from genuine failures. Without
// tagging the abort, the catch in `getCommitFrequencies` would swallow it into an empty-but-
// successful result that the webview caches as a real answer.
class AbortError extends Error {
	constructor() {
		super('Treemap aggregation aborted');
		this.name = 'AbortError';
	}
}
/** Hardcoded exclude pattern for the Files-mode tree walk. Mirrors what most projects' `.gitignore`
 *  covers — `workspace.findFiles(pattern, undefined)` only honors VS Code's `files.exclude`/
 *  `search.exclude` settings (which a user can customize) and DOES NOT consult `.gitignore`, so
 *  passing this glob is the closest we get to "tracked files" without shelling out to
 *  `git ls-files --cached --others --exclude-standard`. Switch to a real git query if this list
 *  proves insufficient. */
const defaultExcludes =
	'**/{node_modules,bower_components,.git,.svn,.hg,dist,out,build,bin,obj,.next,.nuxt,.cache,.turbo,coverage,.nyc_output,.venv,venv,__pycache__,.pytest_cache,.mypy_cache,.tox,target,.vscode-test,.idea,.vs}/**';

/**
 * Per-repo cache of file-tree + commit-frequency aggregates feeding the embedded treemap visualization.
 * Lazily populated on first request for a given repo path.
 *
 * `workspace.findFiles` over a large repo plus the 1-year `git log --name-status` walk is expensive
 * (multi-second on large monorepos). Users will toggle Files ↔ Commits modes and zoom around — caching
 * keeps interactions snappy. The embedded treemap is a snapshot, not live data; the user can refresh
 * the graph webview to rebuild aggregates.
 */
export class TreemapAggregatorService implements Disposable {
	private readonly _entries = new Map<string, TreemapEntry>();
	private readonly _disposables: Disposable[] = [];
	private readonly _onDidInvalidate = new EventEmitter<string>();
	// Per-repo debounce timers for `index`-driven invalidations. Re-staging a hunk fires many
	// repository-change events in a burst; we only want one rebuild after the burst settles.
	private readonly _indexInvalidateTimers = new Map<string, NodeJS.Timeout>();

	get onDidInvalidate(): Event<string> {
		return this._onDidInvalidate.event;
	}

	constructor(private readonly container: Container) {
		this._disposables.push(
			this._onDidInvalidate,
			// Evict cached entries when their repo is removed from the workspace — without this,
			// large resolved file trees and frequency maps stick around for the lifetime of the
			// extension even after the user closes the folder. Funnel through `invalidate` so the
			// onDidInvalidate event fires too (webview clears its cached treemap).
			container.git.onDidChangeRepositories(e => {
				for (const repo of e.removed ?? []) {
					this.invalidate(repo.path);
				}
			}),
			// Invalidate cached per-repo aggregates when workspace files change so the next request
			// rebuilds. Left un-debounced: invalidation is O(1) per event and the rebuild is lazy
			// (deferred until the next `getData` request), so a burst of file events (e.g. a build
			// step) just collapses to a single rebuild at the next user interaction.
			workspace.onDidCreateFiles(e => this.invalidateFromUris(e.files)),
			workspace.onDidDeleteFiles(e => this.invalidateFromUris(e.files)),
			workspace.onDidRenameFiles(e =>
				this.invalidateFromUris([...e.files.map(f => f.newUri), ...e.files.map(f => f.oldUri)]),
			),
			// VS Code's onDidCreate/Delete/RenameFiles only fires for in-editor file ops; terminal
			// commits, external builds, branch switches, pulls, and rebases don't. Subscribing to
			// repository-change events covers those churn sources. `head`/`heads` cover branch
			// checkout/switch; `remotes` covers `git fetch` (advances remote tracking branches
			// without touching the working tree). `index` covers terminal-driven file creates/
			// deletes that bypass VS Code's file watcher — but a single git operation can fire many
			// `index` events in quick succession, so it's debounced to collapse the burst into one
			// rebuild.
			container.git.onDidChangeRepository(e => {
				if (e.changed('head', 'heads', 'remotes')) {
					this.invalidate(e.repository.path);
				} else if (e.changed('index')) {
					this.scheduleIndexInvalidate(e.repository.path);
				}
			}),
		);
	}

	dispose(): void {
		// Cancel any pending debounced invalidations so they don't fire after our event emitter
		// has been disposed (which would throw).
		for (const timer of this._indexInvalidateTimers.values()) {
			clearTimeout(timer);
		}
		this._indexInvalidateTimers.clear();
		// Abort in-flight builds in each entry so they don't keep running past dispose.
		for (const entry of this._entries.values()) {
			entry.dispose();
		}
		this._entries.clear();
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;
	}

	async getData(
		repoPath: string,
		mode: TreemapMode,
		config: TreemapConfig,
		signal?: AbortSignal,
	): Promise<TreemapData> {
		if (signal?.aborted) throw new AbortError();

		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return { root: undefined, frequencies: undefined };

		let entry = this._entries.get(repoPath);
		if (entry == null) {
			entry = new TreemapEntry(this.container, repoPath, repo.uri, repo.virtual);
			this._entries.set(repoPath, entry);
		}

		// Race the cached entry promises against THIS caller's signal — the cached promise itself
		// is unconditional so a second concurrent caller (with a healthy signal) joining a build
		// triggered by an earlier-cancelled caller still gets a result.
		const root = await raceAbort(entry.getTree(), signal);
		// Tree builds can be multi-second on monorepos — re-check the abort signal before doing
		// the (also-expensive) frequency walk so a stale request doesn't pay for both halves.
		if (signal?.aborted) throw new AbortError();

		const frequencies =
			mode === 'commits' && !repo.virtual
				? await raceAbort(entry.getCommitFrequencies(config), signal)
				: undefined;

		return { root: root, frequencies: frequencies };
	}

	/** Force a rebuild for the given repo on next request. */
	invalidate(repoPath: string): void {
		const entry = this._entries.get(repoPath);
		if (entry == null) return;

		// Abort any in-flight builds inside the entry so they don't continue resolving with stale
		// data after the entry has been evicted. The `onDidInvalidate` event below ensures the
		// webview clears its own cached fingerprints, so abort-rejected callers won't retry-loop.
		entry.dispose();
		this._entries.delete(repoPath);
		this._onDidInvalidate.fire(repoPath);
	}

	private scheduleIndexInvalidate(repoPath: string): void {
		const existing = this._indexInvalidateTimers.get(repoPath);
		if (existing != null) {
			clearTimeout(existing);
		}
		const timer = setTimeout(() => {
			this._indexInvalidateTimers.delete(repoPath);
			this.invalidate(repoPath);
		}, 500);
		this._indexInvalidateTimers.set(repoPath, timer);
	}

	private invalidateFromUris(uris: readonly Uri[]): void {
		// Snapshot open repos so the early-exit counter ignores closed-but-still-tracked repos
		// (which we can never invalidate anyway). `repositoryCount` includes closed repos and
		// would cause us to walk the entire URI batch when only a subset of repos are open.
		const openRepoCount = this.container.git.openRepositoryCount;
		const seen = new Set<string>();
		for (const uri of uris) {
			const repo = this.container.git.getRepository(uri);
			if (repo == null || seen.has(repo.path)) continue;

			seen.add(repo.path);
			this.invalidate(repo.path);
			// Once every open repo's cache is invalidated, additional URIs in this batch can
			// only re-hit repos we've already invalidated — avoid walking 10k URIs through
			// `getRepository` for no additional work.
			if (seen.size >= openRepoCount) return;
		}
	}
}

// Wrap a cached entry promise so each caller can abandon their wait via their own signal without
// disturbing the shared promise (which other callers may still be awaiting). Without this, the
// first caller's signal would be the only one observed by the cached promise.
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (signal == null) return promise;
	if (signal.aborted) return Promise.reject(new AbortError());
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new AbortError());
		signal.addEventListener('abort', onAbort, { once: true });
		promise.then(
			v => {
				signal.removeEventListener('abort', onAbort);
				resolve(v);
			},
			(e: unknown) => {
				signal.removeEventListener('abort', onAbort);
				reject(e instanceof Error ? e : new Error(String(e)));
			},
		);
	});
}

class TreemapEntry {
	// Internal abort controller fired on `dispose()` so any in-flight build inside this entry can
	// be cancelled when the entry is invalidated or the service is disposed. Distinct from any
	// caller's signal — caller cancellation is handled at the wrapper layer via `raceAbort`.
	private readonly _abortController = new AbortController();
	private _treePromise?: Promise<TreemapNode | undefined>;
	private _frequencyPromise?: Promise<CommitFrequencyData>;
	private _frequencyKey?: string;
	// Bounded retry counter for the virtual-workspace empty-tree case. Virtual repos can boot with
	// no files visible yet; without retry the entry would cache the empty tree forever. Cap at a
	// small number so a truly-empty virtual repo doesn't retry-loop.
	private _emptyTreeRetries = 0;
	private static readonly maxEmptyTreeRetries = 5;

	constructor(
		private readonly container: Container,
		private readonly repoPath: string,
		private readonly repoUri: Uri,
		private readonly repoVirtual: boolean,
	) {}

	getTree(): Promise<TreemapNode | undefined> {
		this._treePromise ??= this.buildTree(this._abortController.signal)
			.then(tree => {
				// Virtual workspaces (vscode.dev, GitHub Codespaces) sometimes boot with an empty
				// file tree before the remote provider populates the workspace. Don't cache that
				// empty result — clear the promise so the next request retries. Bounded so a truly-
				// empty virtual repo doesn't retry-loop forever.
				if (
					this.repoVirtual &&
					tree != null &&
					(tree.children?.length ?? 0) === 0 &&
					this._emptyTreeRetries < TreemapEntry.maxEmptyTreeRetries
				) {
					this._emptyTreeRetries++;
					this._treePromise = undefined;
				}
				return tree;
			})
			.catch((ex: unknown) => {
				this._treePromise = undefined;
				if (ex instanceof Error && ex.name === 'AbortError') throw ex;

				Logger.error(ex, 'TreemapAggregator.buildTree');
				return undefined;
			});
		return this._treePromise;
	}

	getCommitFrequencies(config: TreemapConfig): Promise<CommitFrequencyData> {
		// Cache by the full scope/window fingerprint so toggling viz modes is free, but a scope or
		// branches-visibility change re-fetches. Sort `additionalBranches` so order doesn't churn the key.
		// Discretize `loadedSpanMs` to whole days — the client computes it from `Date.now()` and
		// passes a value that drifts every millisecond, which would otherwise rotate the cache key
		// on every call and defeat the cache.
		const additionalKey = config.additionalBranches?.toSorted().join(',') ?? '';
		const spanDays = config.loadedSpanMs != null ? Math.floor(config.loadedSpanMs / 86_400_000) : '';
		const key = `${config.showAllBranches ? 1 : 0}::${config.head ?? ''}::${additionalKey}::${spanDays}`;
		if (this._frequencyPromise == null || this._frequencyKey !== key) {
			this._frequencyKey = key;
			// Capture THIS attempt's promise locally so the catch handler only clears the cached
			// promise field when it's still pointing at us. Without this capture, an earlier
			// rejected attempt can clobber a newer in-flight attempt's promise on the way out,
			// forcing the next caller to redundantly re-fire the build.
			const attempt: Promise<CommitFrequencyData> = this.buildCommitFrequencies(
				config,
				this._abortController.signal,
			).catch((ex: unknown) => {
				if (this._frequencyPromise === attempt) {
					this._frequencyPromise = undefined;
				}
				// On cancellation, re-throw so callers see a rejected promise instead of an
				// empty-but-successful CommitFrequencyData (the webview would otherwise cache
				// the empty stub as a real result and lock the fingerprint).
				if (ex instanceof Error && ex.name === 'AbortError') throw ex;

				Logger.error(ex, 'TreemapAggregator.buildCommitFrequencies');
				return { frequencies: {}, folderFrequencies: {}, maxFrequency: 0, totalCommits: 0 };
			});
			this._frequencyPromise = attempt;
		}
		return this._frequencyPromise;
	}

	dispose(): void {
		this._abortController.abort();
	}

	private async buildTree(signal: AbortSignal): Promise<TreemapNode> {
		if (signal.aborted) throw new AbortError();

		const rootFsPath = this.repoUri.fsPath;
		const rootNode: TreemapNode = {
			name: 'root',
			path: rootFsPath,
			size: 0,
			type: 'folder',
			children: [],
		};

		// Bridge our AbortSignal to a VS Code CancellationToken so a large-monorepo `findFiles`
		// walk can be interrupted by an invalidate (or by service disposal). Without this, an
		// aborted refresh would still have to wait for the full file scan to drain.
		const tokenSource = new CancellationTokenSource();
		const onAbort = () => tokenSource.cancel();
		signal.addEventListener('abort', onAbort, { once: true });

		let files: Uri[];
		try {
			const pattern = new RelativePattern(this.repoUri, '**/*');
			const token: CancellationToken = tokenSource.token;
			files = await workspace.findFiles(pattern, defaultExcludes, undefined, token);
		} finally {
			signal.removeEventListener('abort', onAbort);
			tokenSource.dispose();
		}

		if (signal.aborted) throw new AbortError();

		// Use a separator-anchored prefix when stripping the root so a sibling like `/repo-bak`
		// can't be sliced into `/repo`'s tree as `bak/...`. The trailing-separator check is
		// platform-agnostic; on Windows VS Code's fsPath uses backslash.
		const rootPrefix = `${rootFsPath}${rootFsPath.endsWith('/') || rootFsPath.endsWith('\\') ? '' : rootFsPath.includes('\\') ? '\\' : '/'}`;

		// Check `signal.aborted` every N files rather than every iteration — `findFiles` can
		// return 100k+ entries on large monorepos and an aborted-check on every iteration would
		// be measurable. Bucket size tuned for sub-second abort responsiveness on large repos
		// while keeping per-iteration overhead negligible.
		let i = 0;
		for (const file of files) {
			if ((i++ & 0xff) === 0 && signal.aborted) throw new AbortError();

			const filePath = file.fsPath;
			const relativePath = filePath.startsWith(rootPrefix) ? filePath.slice(rootPrefix.length) : filePath;
			const parts = relativePath.split(/[\\/]/);

			let currentNode = rootNode;
			for (let p = 0; p < parts.length; p++) {
				const part = parts[p];
				if (!part) continue;

				const isFile = p === parts.length - 1;
				currentNode.children ??= [];

				let child = currentNode.children.find(c => c.name === part);
				if (child == null) {
					const parentPath = currentNode.path;
					// Skip the joiner when the parent path already ends in a separator (e.g. a
					// containerized workspace rooted at `/` would otherwise produce `//src`).
					const sep = parentPath.endsWith('/') || parentPath.endsWith('\\') ? '' : '/';
					child = {
						name: part,
						path: isFile ? filePath : `${parentPath}${sep}${part}`,
						size: isFile ? 10 : 0,
						type: isFile ? 'file' : 'folder',
					};
					if (!isFile) {
						child.children = [];
					}
					currentNode.children.push(child);
				}

				currentNode = child;
			}
		}

		return rootNode;
	}

	private async buildCommitFrequencies(config: TreemapConfig, signal: AbortSignal): Promise<CommitFrequencyData> {
		const windowMs = config.loadedSpanMs ?? oneYearMs;
		const since = new Date(Date.now() - windowMs).toISOString();
		const svc = this.container.git.getRepositoryService(this.repoPath);

		const frequencies: Record<string, number> = {};
		let maxFrequency = 0;
		// Walking the same SHA twice (e.g., a commit reachable from multiple included branches) would
		// double-count files for that commit — track seen SHAs and only count each once.
		const seenShas = new Set<string>();
		// Per-folder SHA set — track which unique commits touched each ancestor folder. Naive
		// "sum the per-file counts" inflates folder totals because a commit touching N files in a
		// folder gets counted N times. After the walk we materialize each set to its `.size`.
		// Empty string `''` is the repo root; every commit contributes to it.
		const folderShas = new Map<string, Set<string>>();
		const addFolderSha = (folder: string, sha: string) => {
			let set = folderShas.get(folder);
			if (set == null) {
				set = new Set();
				folderShas.set(folder, set);
			}
			set.add(sha);
		};

		// Inline tally — closes over `frequencies`, `maxFrequency`, `seenShas`, `folderShas`,
		// `signal` so we can call it with logs from each ref walk below without re-passing.
		const tally = (log: GitLog) => {
			for (const commit of log.commits.values()) {
				// Throw (rather than `return`) so the partial tally is never returned and cached —
				// the catch in `getCommitFrequencies` clears `_frequencyPromise` so a later request
				// re-builds from a clean slate.
				if (signal.aborted) throw new AbortError();
				if (seenShas.has(commit.sha)) continue;

				seenShas.add(commit.sha);
				addFolderSha('', commit.sha);
				const files = commit.fileset?.files;
				if (files == null) continue;

				for (const file of files) {
					const count = (frequencies[file.path] ?? 0) + 1;
					frequencies[file.path] = count;
					if (count > maxFrequency) {
						maxFrequency = count;
					}
					// Walk ancestor folders (forward-slash normalized) and tag each with this commit's
					// SHA. The set dedupes automatically so a single commit touching 10 files in
					// `src/foo` only counts once for `src/foo` (and once for `src`, once for root).
					const normalized = file.path.replace(/\\/g, '/');
					let slash = normalized.lastIndexOf('/');
					while (slash > 0) {
						addFolderSha(normalized.slice(0, slash), commit.sha);
						slash = normalized.lastIndexOf('/', slash - 1);
					}
				}
			}
		};

		if (config.showAllBranches) {
			// `--all` covers every branch the graph would include in its "All Branches" mode.
			const log = await svc.commits.getLog(
				undefined,
				{ limit: 0, includeFiles: true, since: since, all: true },
				signal,
			);
			if (log != null) {
				tally(log);
			}
		} else {
			// Walk head + each additional ref. Mirrors the timeline's per-ref iteration pattern so the
			// treemap reflects exactly the refs the Graph's scope picker / visibility filter is showing.
			// IMPORTANT: when `config.head` is undefined we still need to walk HEAD (passing
			// `undefined` to `getLog` defaults to HEAD). Filtering only nulls/empty strings from
			// `additionalBranches` and keeping a single `undefined` for the missing head ensures
			// commits reachable only from HEAD aren't dropped from the count.
			const explicitAdditional = (config.additionalBranches ?? []).filter(
				(r): r is string => r != null && r !== '',
			);
			const headValue = config.head != null && config.head !== '' ? config.head : undefined;
			// Dedup the head ref out of `additionalBranches` so we don't pay for a second `git log`
			// subprocess walking the same ref (the in-memory `seenShas` filter dedupes results, but
			// the duplicated subprocess is wasted work).
			const additionalDeduped = explicitAdditional.filter(ref => ref !== headValue);
			const headRefs: (string | undefined)[] = [headValue, ...additionalDeduped];
			for (const ref of headRefs) {
				if (signal.aborted) throw new AbortError();

				const log = await svc.commits.getLog(ref, { limit: 0, includeFiles: true, since: since }, signal);
				if (log != null) {
					tally(log);
				}
			}
		}

		// Materialize per-folder SHA sets to counts. The root folder's count == total unique
		// commits walked; preserved separately so the webview's unscoped-root description doesn't
		// have to look up the empty-string key.
		const folderFrequencies: Record<string, number> = {};
		for (const [folder, shaSet] of folderShas) {
			folderFrequencies[folder] = shaSet.size;
		}

		return {
			frequencies: frequencies,
			folderFrequencies: folderFrequencies,
			maxFrequency: maxFrequency,
			totalCommits: seenShas.size,
		};
	}
}
