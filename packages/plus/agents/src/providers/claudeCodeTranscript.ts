import { createReadStream } from 'fs';
import { open, readdir, readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import { createInterface } from 'readline';

export interface TranscriptTitles {
	custom?: string;
	ai?: string;
	agent?: string;
}

/** A transcript file discovered by {@link ClaudeCodeTranscriptReader.listSessions}, before its
 *  contents are read — everything here comes from `readdir` + `stat`. */
export interface TranscriptSessionEntry {
	readonly sessionId: string;
	readonly path: string;
	readonly lastActivityMs: number;
	readonly size: number;
}

/** A {@link TranscriptSessionEntry} enriched with the fields recovered from the file's head/tail. */
export interface TranscriptSessionSummary extends TranscriptSessionEntry {
	readonly titles: TranscriptTitles;
	readonly lastPrompt?: string;
}

export interface TranscriptSessionListing {
	readonly sessions: TranscriptSessionSummary[];
	/** Every transcript in the directory, not just the summarized slice — drives "Showing N of M". */
	readonly total: number;
}

/** A transcript found outside the queried cwd's project directory, plus the directory Claude
 *  actually uses to resolve it for `--resume`. */
export interface ResumableTranscriptSessionSummary extends TranscriptSessionSummary {
	readonly cwd: string;
}

export interface ResumableTranscriptSessionListing {
	readonly sessions: ResumableTranscriptSessionSummary[];
	readonly total: number;
}

export interface EndedTranscriptDetails {
	titles: TranscriptTitles;
	firstPrompt?: string;
	lastPrompt?: string;
}

interface CacheEntry {
	path: string;
	mtimeMs: number;
	size: number;
	nextOffset: number;
	titles: TranscriptTitles;
}

interface ListingCacheEntry {
	entries: TranscriptSessionEntry[];
	resolvedAt: number;
}

interface NameCacheEntry {
	names: string[];
	resolvedAt: number;
}

interface SummaryCacheEntry {
	path: string;
	mtimeMs: number;
	size: number;
	summary: TranscriptSessionSummary;
}

interface TitleEntry {
	type: string;
	sessionId?: string;
	customTitle?: string;
	aiTitle?: string;
	agentName?: string;
	lastPrompt?: string;
}

/** Bytes read from each end of a transcript when summarizing. Titles and prompts cluster at both
 *  extremes, and files run to tens of MB, so reading whole files is not an option. */
const summaryWindowSize = 64 * 1024;
/** Listings are cheap (readdir + stat) but re-run per panel/sheet open; a short TTL absorbs bursts.
 *  Time-based rather than dir-mtime-based because appends move file mtimes without touching the dir. */
const listingCacheTtlMs = 10 * 1000;
/** Summaries are keyed by session, and a busy project has hundreds — unlike the per-live-session
 *  title cache, this needs a ceiling. Sized to hold a whole junk-heavy store: the listing scan runs
 *  to exhaustion, and each entry is tiny (a path plus a few short strings), so a cap below the
 *  store's size would evict-and-re-read the junk tail on every listing instead of paying its
 *  windowed reads once. */
const summaryCacheLimit = 1000;
const defaultListLimit = 50;

/**
 * Reads Claude Code transcript JSONL files at `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`
 * to surface `custom-title`, `ai-title`, and `agent-name` entries as fallback session names.
 *
 * Maintains a per-session cache keyed by mtime + last-read byte offset, so repeated calls only
 * read the appended tail. Last occurrence per type wins.
 *
 * `resolve` is async, so a `forget` (or a newer `resolve`) for the same session can land between
 * its `await`s. A per-session generation counter is stamped at entry and re-checked before the
 * final cache write, so a stale `resolve` can't resurrect a forgotten entry or clobber a newer
 * resolve's result.
 */
export class ClaudeCodeTranscriptReader {
	private readonly _cache = new Map<string, CacheEntry>();
	private readonly _generations = new Map<string, number>();
	private readonly _listings = new Map<string, ListingCacheEntry>();
	/** Transcript file names per project directory — the readdir behind both the plain listing and
	 *  the by-id scan, which sweeps every project directory. */
	private readonly _names = new Map<string, NameCacheEntry>();
	/** Project directories under {@link getProjectsRoot}, re-scanned by every by-id recovery. */
	private _projectDirs: { dirs: string[]; resolvedAt: number } | undefined;
	/** Insertion-ordered LRU — re-inserted on hit, oldest key evicted past {@link summaryCacheLimit}. */
	private readonly _summaries = new Map<string, SummaryCacheEntry>();
	/** Resolved project path per transcript path, bounded like {@link _summaries}. */
	private readonly _transcriptCwds = new Map<string, string>();
	private _nextGen = 0;
	/** Bumped by {@link invalidateListings}; async listing scans capture it at entry and skip their
	 *  cache write when it moved, so a stale in-flight result can't re-seed a just-cleared cache. */
	private _listingGen = 0;

	/** Drops the directory-listing caches (entries, names, project dirs) so the next listing re-reads
	 *  the store. Called when a session ends or is removed: its transcript may have appeared inside
	 *  the TTL window, and a cached listing would hide the new file from the very fetch meant to
	 *  surface it. Summary and cwd caches are keyed by file identity and stay valid, so they're kept.
	 *  The generation bump makes any in-flight listing skip its own cache write — otherwise a scan
	 *  started before the invalidation would re-seed the caches with pre-end results, freshly
	 *  timestamped (same discipline as `resolve`'s per-session generations). */
	invalidateListings(): void {
		this._listingGen++;
		this._listings.clear();
		this._names.clear();
		this._projectDirs = undefined;
	}

	async resolve(sessionId: string, cwd: string | undefined): Promise<TranscriptTitles | undefined> {
		const gen = ++this._nextGen;
		this._generations.set(sessionId, gen);

		const cached = this._cache.get(sessionId);
		const path = cached?.path ?? (await this.locateTranscript(sessionId, cwd));
		if (path == null) return undefined;

		let stats;
		try {
			stats = await stat(path);
		} catch {
			// File disappeared; drop any stale cache entry so a future call retries discovery.
			// Skip the delete if a newer resolve/forget claimed the slot — their state is fresher.
			if (this._generations.get(sessionId) === gen) {
				this._cache.delete(sessionId);
				this._generations.delete(sessionId);
			}
			return undefined;
		}

		if (stats.mtimeMs === cached?.mtimeMs && stats.size === cached?.size) {
			return cached.titles;
		}

		// Truncation or rewrite: stat shrank below our read cursor or mtime moved backward → full re-scan.
		const startFromScratch = cached == null || stats.size < cached.nextOffset || stats.mtimeMs < cached.mtimeMs;
		const startOffset = startFromScratch ? 0 : cached.nextOffset;
		const baseTitles: TranscriptTitles = startFromScratch ? {} : { ...cached.titles };

		const { titles, consumedEnd } =
			stats.size > startOffset
				? await this.readRange(path, startOffset, stats.size, sessionId, baseTitles)
				: { titles: baseTitles, consumedEnd: startOffset };

		// If `forget` ran or a newer `resolve` started while we were awaiting, skip the cache write
		// — the entry we'd be writing reflects stale state.
		if (this._generations.get(sessionId) !== gen) return titles;

		const entry: CacheEntry = {
			path: path,
			mtimeMs: stats.mtimeMs,
			size: stats.size,
			nextOffset: consumedEnd,
			titles: titles,
		};
		this._cache.set(sessionId, entry);
		return titles;
	}

	forget(sessionId: string): void {
		this._cache.delete(sessionId);
		this._generations.delete(sessionId);
	}

	/**
	 * One-shot read for an *ended* (terminal, static) session: extracts the transcript titles plus
	 * the first and last user prompts. Unlike {@link resolve}, it bypasses the tail cache — a finished
	 * transcript never grows, so it's read once on demand (when an ended row is opened) and the
	 * result applied to the session. `last-prompt` entries carry the prompt as of that point; the first
	 * one bearing a value is the session's opening prompt, the last its most recent. Returns `undefined`
	 * when no transcript is found (archived/purged) — the caller keeps whatever durable-store fields it
	 * already has.
	 *
	 * Streams the file line-by-line rather than buffering it whole: a finished transcript can run to
	 * tens of MB, but this keeps only one line resident at a time. A *full* scan (not a head/tail
	 * window) is required for correctness — when the first turn is large the opening `last-prompt` sits
	 * past any fixed head window, and a windowed read would then mistake a later prompt for the first,
	 * poisoning the derived session name.
	 */
	async resolveEndedDetails(sessionId: string, cwd: string | undefined): Promise<EndedTranscriptDetails | undefined> {
		const path = await this.locateTranscript(sessionId, cwd);
		if (path == null) return undefined;

		let stats;
		try {
			stats = await stat(path);
		} catch (ex) {
			// A transcript that vanished is terminal; an I/O or permission failure must propagate so
			// the caller retries rather than caching this session as permanently unresolvable.
			if (!isMissingEntry(ex)) throw ex;

			return undefined;
		}
		if (stats.size === 0) return undefined;

		const titles: TranscriptTitles = {};
		let firstPrompt: string | undefined;
		let lastPrompt: string | undefined;

		const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
		try {
			for await (const line of rl) {
				applyTitleLine(line, sessionId, titles);
				if (!line.includes('last-prompt')) continue;

				const entry = parseSummaryLine(line, sessionId);
				if (entry?.type === 'last-prompt' && entry.lastPrompt != null && entry.lastPrompt.length > 0) {
					firstPrompt ??= entry.lastPrompt;
					lastPrompt = entry.lastPrompt;
				}
			}
		} finally {
			rl.close();
		}

		return { titles: titles, firstPrompt: firstPrompt, lastPrompt: lastPrompt };
	}

	/**
	 * Lists the transcripts of sessions whose working directory is `cwd`, most-recently-active first,
	 * summarizing until `limit` summarizable transcripts are found — not just the first `limit` on
	 * disk, since junk transcripts (dropped below) would otherwise starve the result.
	 * `excludeSessionIds` is skipped before `limit` applies, and excluded entries are also dropped
	 * from `total` — they're already shown elsewhere (e.g. as live sessions), so a caller's "N of M"
	 * count must not double-count them.
	 *
	 * Claude homes a transcript under the directory encoding the cwd from which the session started.
	 * That directory is authoritative for where `claude --resume <id>` can find the transcript, but
	 * Claude does not reliably move it when the session later changes worktrees. Callers that have a
	 * durable session-to-worktree association can recover those moved sessions with
	 * {@link listSessionsByIds}; this method intentionally remains the cheap legacy directory listing.
	 *
	 * Discovery (readdir + stat) covers the whole directory and is cheap; summarizing is not, so it's
	 * capped. Entries whose summary yields neither a title nor a prompt are dropped — those are aborted
	 * or empty transcripts with nothing to show or search on.
	 */
	async listSessions(
		cwd: string,
		options?: { limit?: number; excludeSessionIds?: ReadonlySet<string> },
	): Promise<TranscriptSessionListing> {
		const dir = await this.resolveProjectDir(cwd);
		if (dir == null) return { sessions: [], total: 0 };

		const entries = await this.listEntries(dir);
		if (entries.length === 0) return { sessions: [], total: 0 };

		const limit = options?.limit ?? defaultListLimit;
		const exclude = options?.excludeSessionIds;
		// Zero-byte transcripts can never summarize — skip the read entirely and keep them out of
		// `total`, which otherwise counts sessions no `limit` could ever surface.
		const candidates = entries.filter(e => e.size > 0 && exclude?.has(e.sessionId) !== true);
		const { sessions, exhausted } = await this.collectSessions(candidates, limit, async entry => {
			const summary = await this.resolveSummary(entry);
			return summary != null && hasSummaryContent(summary) ? summary : undefined;
		});

		// An exhausted scan proved the exact valid count; otherwise unscanned candidates keep
		// `total` an upper bound so paging knows more MAY exist.
		return { sessions: sessions, total: exhausted ? sessions.length : candidates.length };
	}

	/**
	 * Finds a known set of session ids across every Claude project directory except `excludeCwd`'s.
	 * This is the recovery path for durable CLI records whose worktree changed after Claude chose the
	 * transcript's project directory. The caller supplies the association; transcript contents alone
	 * are deliberately not used to guess which current worktree owns an arbitrary old session.
	 *
	 * Each result carries the project path encoded by the directory that actually holds the transcript,
	 * so resuming it does not repeat discovery from the wrong worktree. Duplicate ids are counted once,
	 * with the newest transcript winning.
	 */
	async listSessionsByIds(
		sessionIds: ReadonlySet<string>,
		options?: { limit?: number; excludeCwd?: string },
	): Promise<ResumableTranscriptSessionListing> {
		if (sessionIds.size === 0) return { sessions: [], total: 0 };

		const excludeDir = await this.resolveProjectDir(options?.excludeCwd);
		// Same zero-byte drop as `listSessions` — see the rationale there.
		const entries = (await this.listEntriesByIds(sessionIds, excludeDir)).filter(e => e.size > 0);
		if (entries.length === 0) return { sessions: [], total: 0 };

		const limit = options?.limit ?? defaultListLimit;
		const { sessions, exhausted } = await this.collectSessions(entries, limit, async entry => {
			const summary = await this.resolveSummary(entry);
			if (summary == null || !hasSummaryContent(summary)) return undefined;

			const cwd = await this.resolveTranscriptCwd(entry);
			return cwd != null ? { ...summary, cwd: cwd } : undefined;
		});

		// Exhausted scans prove the exact count — see `listSessions`.
		return { sessions: sessions, total: exhausted ? sessions.length : entries.length };
	}

	/** Discovers every transcript in `dir`, newest first. The directory also holds one sibling
	 *  subdirectory per session (`<uuid>/subagents`, `<uuid>/tool-results`), so entries must be filtered
	 *  to files — a busy project has roughly as many subdirectories as transcripts. */
	private async listEntries(dir: string): Promise<TranscriptSessionEntry[]> {
		const cached = this._listings.get(dir);
		if (cached != null && Date.now() - cached.resolvedAt < listingCacheTtlMs) return cached.entries;

		const gen = this._listingGen;
		let names: string[];
		try {
			names = await this.listTranscriptNames(dir);
		} catch {
			return [];
		}

		const entries = (await this.statEntries(dir, names)).sort((a, b) => b.lastActivityMs - a.lastActivityMs);

		if (gen === this._listingGen) {
			this._listings.set(dir, { entries: entries, resolvedAt: Date.now() });
		}

		return entries;
	}

	/** Stats `names` in `dir`, dropping the ones that failed — a transcript can vanish (or be
	 *  archived) between the readdir and the stat. Unsorted; callers order as they need.
	 *  Protected (like {@link readSummary}) so tests can interleave against the listing flow. */
	protected async statEntries(dir: string, names: string[]): Promise<TranscriptSessionEntry[]> {
		const settled = await Promise.allSettled(
			names.map(async (name): Promise<TranscriptSessionEntry> => {
				const path = join(dir, name);
				const stats = await stat(path);
				return {
					sessionId: basename(name, '.jsonl'),
					path: path,
					lastActivityMs: stats.mtimeMs,
					size: stats.size,
				};
			}),
		);

		return settled.filter(r => r.status === 'fulfilled').map(r => r.value);
	}

	/** The `.jsonl` file names in `dir`, cached for {@link listingCacheTtlMs}. Failures propagate
	 *  uncached: an unreadable directory means different things to different callers, and the next
	 *  call must be free to get a real answer. */
	private async listTranscriptNames(dir: string): Promise<string[]> {
		const cached = this._names.get(dir);
		if (cached != null && Date.now() - cached.resolvedAt < listingCacheTtlMs) return cached.names;

		const gen = this._listingGen;
		const dirents = await readdir(dir, { withFileTypes: true });
		const names = dirents.filter(d => d.isFile() && d.name.endsWith('.jsonl')).map(d => d.name);
		if (gen === this._listingGen) {
			this._names.set(dir, { names: names, resolvedAt: Date.now() });
		}

		return names;
	}

	/** Every project directory under the projects root, cached for {@link listingCacheTtlMs} — a
	 *  by-id recovery sweeps all of them, once per queried worktree. */
	private async listProjectDirs(): Promise<string[]> {
		const cached = this._projectDirs;
		if (cached != null && Date.now() - cached.resolvedAt < listingCacheTtlMs) return cached.dirs;

		const gen = this._listingGen;
		const root = this.getProjectsRoot();
		const dirents = await readdir(root, { withFileTypes: true });
		const dirs = dirents.filter(d => d.isDirectory()).map(d => join(root, d.name));
		if (gen === this._listingGen) {
			this._projectDirs = { dirs: dirs, resolvedAt: Date.now() };
		}

		return dirs;
	}

	/** Scans project directory names once, then stats only requested transcript ids. */
	private async listEntriesByIds(
		sessionIds: ReadonlySet<string>,
		excludeDir: string | undefined,
	): Promise<TranscriptSessionEntry[]> {
		let idsToFind = sessionIds;
		if (excludeDir != null) {
			try {
				const names = await this.listTranscriptNames(excludeDir);
				const idsInExcludedDir = new Set(names.map(name => basename(name, '.jsonl')));
				idsToFind = new Set([...sessionIds].filter(id => !idsInExcludedDir.has(id)));
				if (idsToFind.size === 0) return [];
			} catch {
				// If the exact directory can't be inspected, don't risk returning a duplicate from a
				// stale transcript copy elsewhere. The ordinary listing still owns the exact path.
				return [];
			}
		}

		let dirs: string[];
		try {
			dirs = await this.listProjectDirs();
		} catch (ex) {
			if (!isMissingEntry(ex)) throw ex;

			return [];
		}

		const settledDirs = await Promise.allSettled(
			dirs.map(async dir => {
				if (dir === excludeDir) return [];

				const names = (await this.listTranscriptNames(dir)).filter(name =>
					idsToFind.has(basename(name, '.jsonl')),
				);
				return this.statEntries(dir, names);
			}),
		);

		const bySessionId = new Map<string, TranscriptSessionEntry>();
		for (const settledDir of settledDirs) {
			if (settledDir.status !== 'fulfilled') continue;

			for (const entry of settledDir.value) {
				const existing = bySessionId.get(entry.sessionId);
				if (existing == null || entry.lastActivityMs > existing.lastActivityMs) {
					bySessionId.set(entry.sessionId, entry);
				}
			}
		}

		return [...bySessionId.values()].sort((a, b) => b.lastActivityMs - a.lastActivityMs);
	}

	/** `exhausted` reports whether every candidate was scanned — an exhausted scan has proven the
	 *  exact valid count, so callers can report it instead of an upper bound that would keep a
	 *  "Show More" affordance alive with nothing left to show. */
	private async collectSessions<T>(
		candidates: readonly TranscriptSessionEntry[],
		limit: number,
		resolve: (entry: TranscriptSessionEntry) => Promise<T | undefined>,
	): Promise<{ sessions: T[]; exhausted: boolean }> {
		const sessions: T[] = [];
		const pushResolved = (settled: PromiseSettledResult<T | undefined>[]): void => {
			for (const result of settled) {
				if (result.status !== 'fulfilled' || result.value == null) continue;

				sessions.push(result.value);
			}
		};

		// limit <= 0 means "no ceiling" — resolve every candidate.
		if (limit <= 0) {
			pushResolved(await Promise.allSettled(candidates.map(resolve)));
			return { sessions: sessions, exhausted: true };
		}

		// Scans until `limit` results or the candidates run out — a fixed scan ceiling would let a run
		// of junk transcripts hide every older real session behind it (and the picker then claims there
		// are none at all). The cost stays bounded: callers pre-drop zero-byte candidates read-free, and
		// a junk summary is windowed, tiny, and LRU-cached, so the sweep is paid in syscalls, once.
		let cursor = 0;
		while (sessions.length < limit && cursor < candidates.length) {
			// Batched by remaining need so a hit-rich head stops the scan early instead of resolving
			// every candidate up front.
			const batch = candidates.slice(cursor, cursor + (limit - sessions.length));
			cursor += batch.length;
			pushResolved(await Promise.allSettled(batch.map(resolve)));
		}

		return { sessions: sessions, exhausted: cursor >= candidates.length };
	}

	/** Summarizes one transcript, reusing the cached result while its mtime and size are unchanged. */
	private async resolveSummary(entry: TranscriptSessionEntry): Promise<TranscriptSessionSummary | undefined> {
		const cached = this._summaries.get(entry.sessionId);
		if (
			cached != null &&
			cached.path === entry.path &&
			cached.mtimeMs === entry.lastActivityMs &&
			cached.size === entry.size
		) {
			// Refresh recency for the LRU.
			this._summaries.delete(entry.sessionId);
			this._summaries.set(entry.sessionId, cached);
			return cached.summary;
		}

		let summary: TranscriptSessionSummary;
		try {
			summary = await this.readSummary(entry);
		} catch {
			return undefined;
		}

		this._summaries.set(entry.sessionId, {
			path: entry.path,
			mtimeMs: entry.lastActivityMs,
			size: entry.size,
			summary: summary,
		});
		if (this._summaries.size > summaryCacheLimit) {
			const oldest = this._summaries.keys().next();
			if (!oldest.done) {
				this._summaries.delete(oldest.value);
			}
		}
		return summary;
	}

	/** Recovers the project path represented by the transcript's containing directory. A resolved
	 *  answer is cached: it's a line-scan of the whole transcript, and the directory holding a given
	 *  path never changes. A miss isn't cached — a `cwd` line can still land on append. */
	private async resolveTranscriptCwd(entry: TranscriptSessionEntry): Promise<string | undefined> {
		const cached = this._transcriptCwds.get(entry.path);
		if (cached != null) return cached;

		const projectDir = dirname(entry.path);
		const projectDirName = basename(projectDir);
		const matchesProjectDir = (cwd: string): boolean =>
			encodeProjectDirName(cwd).toLowerCase() === projectDirName.toLowerCase();

		try {
			const index = JSON.parse(await readFile(join(projectDir, 'sessions-index.json'), 'utf8')) as {
				entries?: { sessionId?: unknown; projectPath?: unknown }[];
			};
			if (Array.isArray(index.entries)) {
				const indexed = index.entries.find(item => item?.sessionId === entry.sessionId);
				if (typeof indexed?.projectPath === 'string' && matchesProjectDir(indexed.projectPath)) {
					this.rememberTranscriptCwd(entry.path, indexed.projectPath);
					return indexed.projectPath;
				}
			}
		} catch {
			// The index is optional and can lag or be malformed. The transcript is authoritative below.
		}

		const rl = createInterface({ input: createReadStream(entry.path, { encoding: 'utf8' }), crlfDelay: Infinity });
		try {
			for await (const line of rl) {
				if (!line.includes('"cwd"')) continue;

				let parsed: { cwd?: unknown; sessionId?: unknown };
				try {
					parsed = JSON.parse(line) as { cwd?: unknown; sessionId?: unknown };
				} catch {
					continue;
				}
				if (parsed.sessionId != null && parsed.sessionId !== entry.sessionId) continue;

				if (typeof parsed.cwd === 'string' && matchesProjectDir(parsed.cwd)) {
					this.rememberTranscriptCwd(entry.path, parsed.cwd);
					return parsed.cwd;
				}
			}
		} finally {
			rl.close();
		}

		return undefined;
	}

	private rememberTranscriptCwd(path: string, cwd: string): void {
		this._transcriptCwds.set(path, cwd);
		if (this._transcriptCwds.size > summaryCacheLimit) {
			const oldest = this._transcriptCwds.keys().next();
			if (!oldest.done) {
				this._transcriptCwds.delete(oldest.value);
			}
		}
	}

	/**
	 * Reads a summary from the first and last {@link summaryWindowSize} bytes of the transcript.
	 *
	 * Deliberately does not reuse `resolve` — that scans from the last-read offset and buffers the whole
	 * range, which for a cold multi-MB transcript means loading the entire file. Titles are written early
	 * and re-written as they're refined, while prompts land at the tail, so the two windows recover both
	 * at a fraction of the bytes. The tail is parsed second so the newest value wins.
	 */
	protected async readSummary(entry: TranscriptSessionEntry): Promise<TranscriptSessionSummary> {
		const titles: TranscriptTitles = {};
		let lastPrompt: string | undefined;

		const apply = (buffer: Buffer, dropPartialFirstLine: boolean): void => {
			const text = buffer.toString('utf8');
			const lines = text.split('\n');
			// A window starting mid-file almost always opens mid-line; that fragment can't be parsed.
			if (dropPartialFirstLine) {
				lines.shift();
			}
			for (const line of lines) {
				const parsed = parseSummaryLine(line, entry.sessionId);
				if (parsed == null) continue;

				applyTitleEntry(parsed, titles);
				if (parsed.lastPrompt != null && parsed.lastPrompt.length > 0) {
					lastPrompt = parsed.lastPrompt;
				}
			}
		};

		const handle = await open(entry.path, 'r');
		try {
			if (entry.size <= summaryWindowSize * 2) {
				const whole = Buffer.alloc(entry.size);
				await handle.read(whole, 0, entry.size, 0);
				apply(whole, false);
			} else {
				const head = Buffer.alloc(summaryWindowSize);
				await handle.read(head, 0, summaryWindowSize, 0);
				apply(head, false);

				const tail = Buffer.alloc(summaryWindowSize);
				await handle.read(tail, 0, summaryWindowSize, entry.size - summaryWindowSize);
				apply(tail, true);
			}
		} finally {
			await handle.close();
		}

		return {
			...entry,
			titles: titles,
			lastPrompt: lastPrompt,
		};
	}

	protected getProjectsRoot(): string {
		return join(homedir(), '.claude', 'projects');
	}

	/** Resolves the `~/.claude/projects` directory holding the sessions whose working directory is
	 *  `cwd`, or `undefined` when none exists. Falls back to a case-insensitive name match because on
	 *  Windows our
	 *  paths carry a lower-cased drive letter (`normalizePath`) while Claude encodes the OS-native
	 *  `C:\...` — so the exact name never matches by case. */
	protected async resolveProjectDir(cwd: string | undefined): Promise<string | undefined> {
		if (cwd == null || cwd.length === 0) return undefined;

		const root = this.getProjectsRoot();
		const encoded = encodeProjectDirName(cwd);

		const exact = join(root, encoded);
		if (await directoryExists(exact)) return exact;

		let dirs: string[];
		try {
			dirs = await readdir(root);
		} catch (ex) {
			// Only a missing projects root means "no transcript". A transient failure propagates so the
			// caller retries instead of caching a permanent miss.
			if (!isMissingEntry(ex)) throw ex;

			return undefined;
		}

		const lowered = encoded.toLowerCase();
		const match = dirs.find(d => d !== encoded && d.toLowerCase() === lowered);
		return match != null ? join(root, match) : undefined;
	}

	protected async locateTranscript(sessionId: string, cwd: string | undefined): Promise<string | undefined> {
		const fileName = `${sessionId}.jsonl`;

		const dir = await this.resolveProjectDir(cwd);
		if (dir != null) {
			const candidate = join(dir, fileName);
			if (await fileExists(candidate)) return candidate;
		}

		// The recorded cwd drifts whenever the agent `cd`s, so it can encode to a directory the session
		// doesn't actually live in — scan every project for the file as a last resort.
		const root = this.getProjectsRoot();
		let dirs: string[];
		try {
			dirs = await readdir(root);
		} catch (ex) {
			if (!isMissingEntry(ex)) throw ex;

			return undefined;
		}

		const candidates = await Promise.all(
			dirs.map(async d => {
				const candidate = join(root, d, fileName);
				return (await fileExists(candidate)) ? candidate : undefined;
			}),
		);
		return candidates.find(c => c != null);
	}

	/**
	 * Reads bytes `[start, end)` from `path` and applies any title entries it finds to a copy of
	 * `baseTitles`. Returns the merged titles and the byte position immediately after the last
	 * newline observed — partial trailing lines (writer hasn't flushed `\n` yet) are intentionally
	 * left unconsumed so they're re-read on the next pass.
	 */
	protected async readRange(
		path: string,
		start: number,
		end: number,
		sessionId: string,
		baseTitles: TranscriptTitles,
	): Promise<{ titles: TranscriptTitles; consumedEnd: number }> {
		const buffer = await readSlice(path, start, end);
		const titles: TranscriptTitles = { ...baseTitles };

		let lastNewlineEnd = start;
		let lineStart = 0;
		for (let i = 0; i < buffer.length; i++) {
			if (buffer[i] !== 0x0a) continue;

			// Slice the line (trim a trailing \r for CRLF files), then advance the cursor past the \n
			// regardless of whether the line yielded anything — we've fully observed those bytes.
			const lineEnd = i > lineStart && buffer[i - 1] === 0x0d ? i - 1 : i;
			if (lineEnd > lineStart) {
				const line = buffer.toString('utf8', lineStart, lineEnd);
				applyTitleLine(line, sessionId, titles);
			}
			lineStart = i + 1;
			lastNewlineEnd = start + i + 1;
		}

		return { titles: titles, consumedEnd: lastNewlineEnd };
	}
}

function applyTitleLine(line: string, sessionId: string, titles: TranscriptTitles): void {
	if (!isLikelyTitleLine(line)) return;

	let entry: TitleEntry;
	try {
		entry = JSON.parse(line) as TitleEntry;
	} catch {
		return;
	}
	if (entry.sessionId != null && entry.sessionId !== sessionId) return;

	applyTitleEntry(entry, titles);
}

/** Parses one transcript line for {@link ClaudeCodeTranscriptReader.readSummary}, rejecting entries
 *  that belong to another session. Can't use the `-title` prefilter that {@link isLikelyTitleLine}
 *  applies: `last-prompt` matches neither of its markers. */
function parseSummaryLine(line: string, sessionId: string): TitleEntry | undefined {
	if (line.length === 0 || !line.includes('"type"')) return undefined;

	let entry: TitleEntry;
	try {
		entry = JSON.parse(line) as TitleEntry;
	} catch {
		return undefined;
	}
	if (entry.sessionId != null && entry.sessionId !== sessionId) return undefined;

	return entry;
}

function applyTitleEntry(entry: TitleEntry, titles: TranscriptTitles): void {
	switch (entry.type) {
		case 'custom-title':
			if (typeof entry.customTitle === 'string' && entry.customTitle.length > 0) {
				titles.custom = entry.customTitle;
			}
			break;
		case 'ai-title':
			if (typeof entry.aiTitle === 'string' && entry.aiTitle.length > 0) {
				titles.ai = entry.aiTitle;
			}
			break;
		case 'agent-name':
			if (typeof entry.agentName === 'string' && entry.agentName.length > 0) {
				titles.agent = entry.agentName;
			}
			break;
	}
}

/** Encodes a working directory into its `~/.claude/projects` directory name. Claude replaces every
 *  non-alphanumeric character — not just separators — preserving runs (`/home/e/.claude` →
 *  `-home-e--claude`) and case. Separators-only would leave the dot in our own worktree convention
 *  (`<repo>.worktrees/<name>`) intact and compute a directory that never exists. */
export function encodeProjectDirName(cwd: string): string {
	return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function isLikelyTitleLine(line: string): boolean {
	if (!line.includes('"type"')) return false;
	return line.includes('-title') || line.includes('agent-name');
}

/** A transcript with no title and no prompt is an aborted or empty session — nothing to name it by,
 *  nothing to search it on. */
function hasSummaryContent(summary: TranscriptSessionSummary): boolean {
	const { custom, ai, agent } = summary.titles;
	return custom != null || ai != null || agent != null || summary.lastPrompt != null;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		const stats = await stat(path);
		return stats.isFile();
	} catch (ex) {
		// See {@link isMissingEntry}: only a genuine absence is an answer.
		if (!isMissingEntry(ex)) throw ex;

		return false;
	}
}

async function directoryExists(path: string): Promise<boolean> {
	try {
		const stats = await stat(path);
		return stats.isDirectory();
	} catch (ex) {
		// "Not there" is an answer; anything else (EACCES, EIO, a mount hiccup) is a transient
		// failure the caller must be able to tell apart — see {@link isMissingEntry}.
		if (isMissingEntry(ex)) return false;

		throw ex;
	}
}

/** True for the "path simply isn't there" errno codes, as opposed to a transient I/O or permission
 *  failure. Callers cache a genuine absence as terminal, so a transient failure must not look like
 *  one — it would pin a session to its fallback name until the window reloads. */
function isMissingEntry(ex: unknown): boolean {
	const code = (ex as NodeJS.ErrnoException | undefined)?.code;
	return code === 'ENOENT' || code === 'ENOTDIR';
}

function readSlice(path: string, start: number, end: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		const stream = createReadStream(path, { start: start, end: end - 1 });
		stream.on('data', chunk => chunks.push(chunk as Buffer));
		stream.on('end', () => resolve(Buffer.concat(chunks)));
		stream.on('error', reject);
	});
}
