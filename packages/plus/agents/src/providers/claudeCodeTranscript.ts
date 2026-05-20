import { createReadStream } from 'fs';
import { readdir, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export interface TranscriptTitles {
	custom?: string;
	ai?: string;
	agent?: string;
}

interface CacheEntry {
	path: string;
	mtimeMs: number;
	size: number;
	nextOffset: number;
	titles: TranscriptTitles;
}

interface TitleEntry {
	type: string;
	sessionId?: string;
	customTitle?: string;
	aiTitle?: string;
	agentName?: string;
}

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

	protected async locateTranscript(sessionId: string, cwd: string | undefined): Promise<string | undefined> {
		const root = join(homedir(), '.claude', 'projects');
		const fileName = `${sessionId}.jsonl`;

		if (cwd != null && cwd.length > 0) {
			const encoded = cwd.replace(/[/\\:]/g, '-');
			const candidate = join(root, encoded, fileName);
			if (await fileExists(candidate)) return candidate;
		}

		let dirs: string[];
		try {
			dirs = await readdir(root);
		} catch {
			return undefined;
		}

		const candidates = await Promise.all(
			dirs.map(async dir => {
				const candidate = join(root, dir, fileName);
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

function isLikelyTitleLine(line: string): boolean {
	if (!line.includes('"type"')) return false;
	return line.includes('-title') || line.includes('agent-name');
}

async function fileExists(path: string): Promise<boolean> {
	try {
		const stats = await stat(path);
		return stats.isFile();
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
