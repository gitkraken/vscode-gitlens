import { createReadStream } from 'fs';
import { open, readdir, stat } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';

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

interface SummaryCacheEntry {
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
 *  title cache, this needs a ceiling. */
const summaryCacheLimit = 200;
const defaultListLimit = 50;
/** How far past `limit` the top-up scan may read when transcripts turn out empty — a junk-filled
 *  store reads at most `limit + listScanSlack` summaries, staying well under {@link summaryCacheLimit}. */
const listScanSlack = 25;

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
	/** Insertion-ordered LRU — re-inserted on hit, oldest key evicted past {@link summaryCacheLimit}. */
	private readonly _summaries = new Map<string, SummaryCacheEntry>();
	private _nextGen = 0;

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
	 * Lists the transcripts of sessions whose working directory is `cwd`, most-recently-active first,
	 * summarizing until `limit` summarizable transcripts are found (bounded by a small scan slack) —
	 * not just the first `limit` on disk, since junk transcripts (dropped below) would otherwise starve
	 * the result. `excludeSessionIds` is skipped before `limit` applies, but excluded entries still
	 * count toward `total`.
	 *
	 * Claude homes a transcript under the directory encoding the session's *current* cwd, migrating the
	 * file if the session `cd`s — so this directory is exactly the set `claude --resume <id>` can find
	 * when invoked from `cwd`, and every entry is resumable from there. The transcripts' own recorded
	 * `cwd` is per-message and lags the move, so it must NOT be used to filter; the directory decides.
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
		const candidates = exclude?.size ? entries.filter(e => !exclude.has(e.sessionId)) : entries;

		const sessions: TranscriptSessionSummary[] = [];
		const pushSummaries = (settled: PromiseSettledResult<TranscriptSessionSummary | undefined>[]): void => {
			for (const result of settled) {
				if (result.status !== 'fulfilled') continue;

				const summary = result.value;
				if (summary == null || !hasSummaryContent(summary)) continue;

				sessions.push(summary);
			}
		};

		// limit <= 0 means "no ceiling" — summarize every candidate.
		if (limit <= 0) {
			pushSummaries(await Promise.allSettled(candidates.map(e => this.resolveSummary(e))));
			return { sessions: sessions, total: entries.length };
		}

		const ceiling = Math.min(candidates.length, limit + listScanSlack);
		let cursor = 0;
		while (sessions.length < limit && cursor < ceiling) {
			// Clamped to the remaining ceiling budget too — a run of junk entries must not let a
			// need-sized batch read past `limit + listScanSlack`.
			const batch = candidates.slice(cursor, cursor + Math.min(limit - sessions.length, ceiling - cursor));
			cursor += batch.length;
			pushSummaries(await Promise.allSettled(batch.map(e => this.resolveSummary(e))));
		}

		return { sessions: sessions, total: entries.length };
	}

	/** Discovers every transcript in `dir`, newest first. The directory also holds one sibling
	 *  subdirectory per session (`<uuid>/subagents`, `<uuid>/tool-results`), so entries must be filtered
	 *  to files — a busy project has roughly as many subdirectories as transcripts. */
	private async listEntries(dir: string): Promise<TranscriptSessionEntry[]> {
		const cached = this._listings.get(dir);
		if (cached != null && Date.now() - cached.resolvedAt < listingCacheTtlMs) return cached.entries;

		let names: string[];
		try {
			const dirents = await readdir(dir, { withFileTypes: true });
			names = dirents.filter(d => d.isFile() && d.name.endsWith('.jsonl')).map(d => d.name);
		} catch {
			return [];
		}

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

		const entries = settled
			.filter(r => r.status === 'fulfilled')
			.map(r => r.value)
			.sort((a, b) => b.lastActivityMs - a.lastActivityMs);

		this._listings.set(dir, { entries: entries, resolvedAt: Date.now() });
		return entries;
	}

	/** Summarizes one transcript, reusing the cached result while its mtime and size are unchanged. */
	private async resolveSummary(entry: TranscriptSessionEntry): Promise<TranscriptSessionSummary | undefined> {
		const cached = this._summaries.get(entry.sessionId);
		if (cached != null && cached.mtimeMs === entry.lastActivityMs && cached.size === entry.size) {
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
		} catch {
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
		} catch {
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
	} catch {
		return false;
	}
}

async function directoryExists(path: string): Promise<boolean> {
	try {
		const stats = await stat(path);
		return stats.isDirectory();
	} catch {
		return false;
	}
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
