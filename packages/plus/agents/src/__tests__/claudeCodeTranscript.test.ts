import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { appendFile, mkdir, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
	TranscriptSessionEntry,
	TranscriptSessionSummary,
	TranscriptTitles,
} from '../providers/claudeCodeTranscript.js';
import { ClaudeCodeTranscriptReader, encodeProjectDirName } from '../providers/claudeCodeTranscript.js';

/** A reader subclass that overrides transcript location to point at a temp directory, so tests
 *  don't need to touch `~/.claude/projects/`. */
class TestReader extends ClaudeCodeTranscriptReader {
	constructor(private readonly _fixedPath: string | undefined) {
		super();
	}
	protected override locateTranscript(): Promise<string | undefined> {
		return Promise.resolve(this._fixedPath);
	}
}

function aiTitle(sessionId: string, value: string): string {
	return JSON.stringify({ type: 'ai-title', aiTitle: value, sessionId: sessionId });
}
function customTitle(sessionId: string, value: string): string {
	return JSON.stringify({ type: 'custom-title', customTitle: value, sessionId: sessionId });
}
function agentName(sessionId: string, value: string): string {
	return JSON.stringify({ type: 'agent-name', agentName: value, sessionId: sessionId });
}
function userTurn(sessionId: string): string {
	return JSON.stringify({
		type: 'user',
		sessionId: sessionId,
		message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
	});
}

function jsonl(...lines: string[]): string {
	return `${lines.join('\n')}\n`;
}

suite('ClaudeCodeTranscriptReader', () => {
	let tmpRoot: string;
	let transcriptPath: string;
	const sessionId = 'abc-123';

	setup(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), 'gl-transcript-'));
		transcriptPath = join(tmpRoot, `${sessionId}.jsonl`);
	});

	teardown(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	test('parses all three title types', async () => {
		await writeFile(
			transcriptPath,
			jsonl(
				userTurn(sessionId),
				aiTitle(sessionId, 'Fix the build'),
				customTitle(sessionId, 'fix-build-slug'),
				agentName(sessionId, 'reviewer-agent'),
			),
		);

		const reader = new TestReader(transcriptPath);
		const titles = await reader.resolve(sessionId, undefined);
		assert.deepStrictEqual(titles, {
			custom: 'fix-build-slug',
			ai: 'Fix the build',
			agent: 'reviewer-agent',
		});
	});

	test('last occurrence wins per type', async () => {
		await writeFile(transcriptPath, jsonl(aiTitle(sessionId, 'First take'), aiTitle(sessionId, 'Second take')));

		const reader = new TestReader(transcriptPath);
		const titles = await reader.resolve(sessionId, undefined);
		assert.strictEqual(titles?.ai, 'Second take');
	});

	test('ignores entries belonging to other sessions', async () => {
		await writeFile(transcriptPath, jsonl(aiTitle('other-session', 'Wrong'), aiTitle(sessionId, 'Right')));

		const reader = new TestReader(transcriptPath);
		const titles = await reader.resolve(sessionId, undefined);
		assert.strictEqual(titles?.ai, 'Right');
	});

	test('skips malformed lines without throwing', async () => {
		await writeFile(
			transcriptPath,
			jsonl(
				'{not valid json}',
				'',
				aiTitle(sessionId, 'Survived'),
				`{"type":"ai-title","sessionId":"${sessionId}"`, // unterminated
			),
		);

		const reader = new TestReader(transcriptPath);
		const titles = await reader.resolve(sessionId, undefined);
		assert.strictEqual(titles?.ai, 'Survived');
	});

	test('returns undefined when no transcript file is present', async () => {
		const reader = new TestReader(undefined);
		const titles = await reader.resolve(sessionId, undefined);
		assert.strictEqual(titles, undefined);
	});

	test('mtime cache: second call with unchanged file does not re-read', async () => {
		await writeFile(transcriptPath, jsonl(aiTitle(sessionId, 'Cached')));

		const reader = new TrackingReader(transcriptPath);
		await reader.resolve(sessionId, undefined);
		assert.strictEqual(reader.readCount, 1);

		await reader.resolve(sessionId, undefined);
		assert.strictEqual(reader.readCount, 1, 'second resolve should hit cache');
	});

	test('mtime cache: bumping mtime forces a re-read', async () => {
		await writeFile(transcriptPath, jsonl(aiTitle(sessionId, 'First')));

		const reader = new TrackingReader(transcriptPath);
		const first = await reader.resolve(sessionId, undefined);
		assert.strictEqual(first?.ai, 'First');
		assert.strictEqual(reader.readCount, 1);

		// Append a new title and bump mtime; cache must pick it up.
		await appendFile(transcriptPath, jsonl(aiTitle(sessionId, 'Second')));
		await bumpMtime(transcriptPath);

		const second = await reader.resolve(sessionId, undefined);
		assert.strictEqual(second?.ai, 'Second');
		assert.strictEqual(reader.readCount, 2, 'mtime change should trigger a re-read');
	});

	test('tail read: previously-discovered titles are preserved when appended chunk lacks them', async () => {
		await writeFile(transcriptPath, jsonl(customTitle(sessionId, 'my-slug'), aiTitle(sessionId, 'First')));

		const reader = new TestReader(transcriptPath);
		const first = await reader.resolve(sessionId, undefined);
		assert.strictEqual(first?.custom, 'my-slug');
		assert.strictEqual(first?.ai, 'First');
		assert.strictEqual(first?.agent, undefined);

		// Append only a new ai-title — custom should survive in the merged result.
		await appendFile(transcriptPath, jsonl(aiTitle(sessionId, 'Second')));
		await bumpMtime(transcriptPath);

		const second = await reader.resolve(sessionId, undefined);
		assert.strictEqual(second?.custom, 'my-slug', 'tail read must merge with prior titles');
		assert.strictEqual(second?.ai, 'Second');
	});

	test('truncation: file shrinking below cursor triggers a full re-scan', async () => {
		await writeFile(transcriptPath, jsonl(aiTitle(sessionId, 'Old'), customTitle(sessionId, 'old-slug')));

		const reader = new TestReader(transcriptPath);
		const first = await reader.resolve(sessionId, undefined);
		assert.strictEqual(first?.custom, 'old-slug');

		// Rewrite from scratch with a smaller, different content set.
		await writeFile(transcriptPath, jsonl(aiTitle(sessionId, 'Fresh')));
		await bumpMtime(transcriptPath);

		const second = await reader.resolve(sessionId, undefined);
		assert.strictEqual(second?.ai, 'Fresh');
		assert.strictEqual(second?.custom, undefined, 'truncation must drop old titles');
	});

	test('partial-line safety: trailing unterminated line is re-read once the newline arrives', async () => {
		await writeFile(transcriptPath, jsonl(aiTitle(sessionId, 'First')));

		const reader = new TestReader(transcriptPath);
		const initial = await reader.resolve(sessionId, undefined);
		assert.strictEqual(initial?.ai, 'First');

		// Simulate a writer that has flushed bytes but not the terminating newline yet.
		const partial = aiTitle(sessionId, 'Second');
		await appendFile(transcriptPath, partial); // no trailing \n
		await bumpMtime(transcriptPath);

		const midway = await reader.resolve(sessionId, undefined);
		assert.strictEqual(midway?.ai, 'First', 'partial line must NOT be consumed yet');

		// Now flush the newline; the same bytes should be re-read and parsed.
		await appendFile(transcriptPath, '\n');
		await bumpMtime(transcriptPath);

		const final = await reader.resolve(sessionId, undefined);
		assert.strictEqual(final?.ai, 'Second');
	});

	test('forget clears cache so the next resolve re-reads', async () => {
		await writeFile(transcriptPath, jsonl(aiTitle(sessionId, 'Initial')));

		const reader = new TrackingReader(transcriptPath);
		await reader.resolve(sessionId, undefined);
		assert.strictEqual(reader.readCount, 1);

		reader.forget(sessionId);
		await reader.resolve(sessionId, undefined);
		assert.strictEqual(reader.readCount, 2, 'forget should force a fresh read');
	});

	test('forget mid-resolve does not resurrect a cache entry for a forgotten session', async () => {
		await writeFile(transcriptPath, jsonl(aiTitle(sessionId, 'In-flight')));

		// Reader that yields control between locate and the cache write, letting the test sneak
		// `forget` in. Without the generation guard, the resolved entry would land in the cache
		// after `forget` had already cleared it — a per-session leak.
		class PausableReader extends ClaudeCodeTranscriptReader {
			constructor(private readonly _path: string) {
				super();
			}
			protected override locateTranscript(): Promise<string | undefined> {
				return Promise.resolve(this._path);
			}
			cache(): Map<string, unknown> {
				return (this as unknown as { _cache: Map<string, unknown> })._cache;
			}
		}
		const reader = new PausableReader(transcriptPath);

		// Kick off resolve but don't await it yet.
		const pending = reader.resolve(sessionId, undefined);

		// Call forget while the resolve is mid-await.
		reader.forget(sessionId);

		const titles = await pending;
		assert.strictEqual(titles?.ai, 'In-flight', 'in-flight resolve still returns its read result');
		assert.strictEqual(reader.cache().has(sessionId), false, 'forget must beat a concurrent resolve write');
	});

	test('locator: resolves through the encoded cwd directory', async () => {
		// Seed a *literal* dir name — deriving it from `encodeProjectDirName` would make this pass
		// under any encoding. The dot in `.worktrees` is what a separators-only rule leaves intact.
		const projects = await seedProject(tmpRoot, '-Users-me-repo-worktrees-bug-graph-wip', sessionId, 'Located');

		const reader = new RootedReader(projects);
		const titles = await reader.resolve(sessionId, '/Users/me/repo.worktrees/bug/graph-wip');
		assert.strictEqual(titles?.ai, 'Located');
	});

	test('locator: matches the encoded directory case-insensitively', async () => {
		// Claude encodes the OS-native cwd (`C:\Users\me\repo`), but our paths carry a lower-cased
		// drive letter — an exact-name probe misses on every Windows path.
		const projects = await seedProject(tmpRoot, 'C--Users-me-repo', sessionId, 'Windows');

		const reader = new RootedReader(projects);
		const titles = await reader.resolve(sessionId, 'c:/Users/me/repo');
		assert.strictEqual(titles?.ai, 'Windows');
	});

	test('locator: falls back to scanning every project dir when the encoded cwd misses', async () => {
		// Covers cwd drift: the session was launched elsewhere and `cd`'d, so its recorded cwd no
		// longer encodes to the directory it actually lives in.
		const projects = await seedProject(tmpRoot, '-somewhere-else-entirely', sessionId, 'Found by scan');

		const reader = new RootedReader(projects);
		const titles = await reader.resolve(sessionId, '/Users/me/drifted');
		assert.strictEqual(titles?.ai, 'Found by scan');
	});

	test('locator: returns undefined when no project dir holds the session', async () => {
		const projects = await seedProject(tmpRoot, '-Users-me-repo', 'a-different-session', 'Nope');

		const reader = new RootedReader(projects);
		const titles = await reader.resolve(sessionId, '/Users/me/repo');
		assert.strictEqual(titles, undefined);
	});
});

suite('ClaudeCodeTranscriptReader.listSessions', () => {
	let tmpRoot: string;
	const cwd = '/Users/me/repo.worktrees/bug/x';
	const dirName = '-Users-me-repo-worktrees-bug-x';

	setup(() => {
		tmpRoot = mkdtempSync(join(tmpdir(), 'gl-transcript-list-'));
	});
	teardown(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	async function seed(name: string, body: string, mtime?: number): Promise<string> {
		const dir = join(tmpRoot, 'projects', dirName);
		await mkdir(dir, { recursive: true });
		const path = join(dir, name);
		await writeFile(path, body);
		if (mtime != null) {
			await utimes(path, new Date(mtime), new Date(mtime));
		}
		return path;
	}

	test('returns an empty listing for a cwd with no project dir', async () => {
		await seed('a.jsonl', jsonl(aiTitle('a', 'A')));
		const reader = new RootedReader(join(tmpRoot, 'projects'));
		assert.deepStrictEqual(await reader.listSessions('/Users/me/elsewhere'), { sessions: [], total: 0 });
	});

	test('orders by last activity, newest first', async () => {
		await seed('old.jsonl', jsonl(aiTitle('old', 'Older')), Date.now() - 60_000);
		await seed('new.jsonl', jsonl(aiTitle('new', 'Newest')), Date.now());

		const reader = new RootedReader(join(tmpRoot, 'projects'));
		const { sessions } = await reader.listSessions(cwd);
		assert.deepStrictEqual(
			sessions.map(s => s.titles.ai),
			['Newest', 'Older'],
		);
	});

	test('ignores sibling subdirectories and non-jsonl files', async () => {
		await seed('real.jsonl', jsonl(aiTitle('real', 'Real')));
		// Claude keeps a per-session subdir (`<uuid>/subagents`) alongside each transcript.
		await mkdir(join(tmpRoot, 'projects', dirName, 'real', 'subagents'), { recursive: true });
		await writeFile(join(tmpRoot, 'projects', dirName, 'notes.txt'), 'nope');

		const reader = new RootedReader(join(tmpRoot, 'projects'));
		const { sessions, total } = await reader.listSessions(cwd);
		assert.strictEqual(total, 1, 'subdirs and non-jsonl files must not count');
		assert.deepStrictEqual(
			sessions.map(s => s.titles.ai),
			['Real'],
		);
	});

	test('drops transcripts carrying neither a title nor a prompt', async () => {
		await seed('junk.jsonl', jsonl(JSON.stringify({ type: 'last-prompt', sessionId: 'junk' })));
		await seed('good.jsonl', jsonl(aiTitle('good', 'Good')));

		const reader = new RootedReader(join(tmpRoot, 'projects'));
		const { sessions, total } = await reader.listSessions(cwd);
		assert.strictEqual(total, 2, 'total counts every transcript, including dropped ones');
		assert.deepStrictEqual(
			sessions.map(s => s.titles.ai),
			['Good'],
		);
	});

	test('keeps a prompt-only transcript and recovers its newest prompt', async () => {
		await seed(
			'p.jsonl',
			jsonl(
				JSON.stringify({ type: 'last-prompt', sessionId: 'p', lastPrompt: 'first ask' }),
				JSON.stringify({ type: 'last-prompt', sessionId: 'p', lastPrompt: 'latest ask' }),
			),
		);

		const reader = new RootedReader(join(tmpRoot, 'projects'));
		const { sessions } = await reader.listSessions(cwd);
		assert.strictEqual(sessions.length, 1);
		assert.strictEqual(sessions[0].lastPrompt, 'latest ask', 'newest prompt wins');
	});

	test('summarizes only up to `limit`, but totals the whole directory', async () => {
		for (let i = 0; i < 5; i++) {
			await seed(`s${i}.jsonl`, jsonl(aiTitle(`s${i}`, `S${i}`)), Date.now() - i * 1000);
		}

		const reader = new RootedReader(join(tmpRoot, 'projects'));
		const { sessions, total } = await reader.listSessions(cwd, { limit: 2 });
		assert.strictEqual(total, 5);
		assert.strictEqual(sessions.length, 2);
	});

	test('tops up past junk transcripts to still satisfy `limit`', async () => {
		const now = Date.now();
		// Junk carries the newest mtimes, so a slice-then-filter approach would starve on it.
		await seed('junk0.jsonl', jsonl(JSON.stringify({ type: 'last-prompt', sessionId: 'junk0' })), now);
		await seed('junk1.jsonl', jsonl(JSON.stringify({ type: 'last-prompt', sessionId: 'junk1' })), now - 1000);
		await seed('s0.jsonl', jsonl(aiTitle('s0', 'S0')), now - 2000);
		await seed('s1.jsonl', jsonl(aiTitle('s1', 'S1')), now - 3000);
		await seed('s2.jsonl', jsonl(aiTitle('s2', 'S2')), now - 4000);

		const reader = new RootedReader(join(tmpRoot, 'projects'));
		const { sessions, total } = await reader.listSessions(cwd, { limit: 3 });
		assert.strictEqual(total, 5);
		assert.deepStrictEqual(
			sessions.map(s => s.titles.ai),
			['S0', 'S1', 'S2'],
		);
	});

	test('excludes ids before `limit` applies, but still counts them toward total', async () => {
		const now = Date.now();
		await seed('live.jsonl', jsonl(aiTitle('live', 'Live')), now);
		await seed('s0.jsonl', jsonl(aiTitle('s0', 'S0')), now - 1000);
		await seed('s1.jsonl', jsonl(aiTitle('s1', 'S1')), now - 2000);
		await seed('s2.jsonl', jsonl(aiTitle('s2', 'S2')), now - 3000);

		const reader = new RootedReader(join(tmpRoot, 'projects'));
		const { sessions, total } = await reader.listSessions(cwd, {
			limit: 3,
			excludeSessionIds: new Set(['live']),
		});
		assert.strictEqual(total, 4, 'excluded entries still count toward total');
		assert.deepStrictEqual(
			sessions.map(s => s.titles.ai),
			['S0', 'S1', 'S2'],
		);
		assert.ok(!sessions.some(s => s.sessionId === 'live'), 'excluded id must not appear in sessions');
	});

	test('bounds the top-up scan to `limit + scan slack` when transcripts are all junk', async () => {
		const limit = 2;
		const scanSlack = 25; // mirrors listScanSlack in claudeCodeTranscript.ts
		const junkCount = limit + scanSlack + 5; // comfortably past the ceiling
		const now = Date.now();
		for (let i = 0; i < junkCount; i++) {
			await seed(
				`junk${i}.jsonl`,
				jsonl(JSON.stringify({ type: 'last-prompt', sessionId: `junk${i}` })),
				now - i * 1000,
			);
		}

		const reader = new CountingSummaryReader(join(tmpRoot, 'projects'));
		const { sessions, total } = await reader.listSessions(cwd, { limit: limit });
		assert.strictEqual(sessions.length, 0);
		assert.strictEqual(total, junkCount);
		assert.ok(
			reader.readCount <= limit + scanSlack,
			`expected at most ${limit + scanSlack} reads, got ${reader.readCount}`,
		);
	});

	test('does not over-read once `limit` valid summaries are found', async () => {
		const now = Date.now();
		for (let i = 0; i < 5; i++) {
			await seed(`s${i}.jsonl`, jsonl(aiTitle(`s${i}`, `S${i}`)), now - i * 1000);
		}

		const reader = new CountingSummaryReader(join(tmpRoot, 'projects'));
		const { sessions } = await reader.listSessions(cwd, { limit: 2 });
		assert.strictEqual(sessions.length, 2);
		assert.strictEqual(reader.readCount, 2);
	});

	test('recovers titles from a file far larger than the read windows', async () => {
		// Titles land early and prompts land at the tail; the middle is never read.
		const filler = `${JSON.stringify({ type: 'assistant', sessionId: 'big', text: 'x'.repeat(4000) })}\n`;
		const body =
			jsonl(aiTitle('big', 'Head Title')) +
			filler.repeat(60) + // ~240KB of unread middle
			jsonl(JSON.stringify({ type: 'last-prompt', sessionId: 'big', lastPrompt: 'tail prompt' }));
		await seed('big.jsonl', body);

		const reader = new RootedReader(join(tmpRoot, 'projects'));
		const { sessions } = await reader.listSessions(cwd);
		assert.strictEqual(sessions[0].titles.ai, 'Head Title', 'title must come from the head window');
		assert.strictEqual(sessions[0].lastPrompt, 'tail prompt', 'prompt must come from the tail window');
	});
});

suite('encodeProjectDirName', () => {
	const cases: [cwd: string, expected: string][] = [
		['/Users/me/repo', '-Users-me-repo'],
		// Our own worktree convention — the dot must collapse, or we compute a dir that never exists
		['/Users/me/repo.worktrees/bug/graph-wip', '-Users-me-repo-worktrees-bug-graph-wip'],
		// Runs are preserved, not collapsed
		['/Users/me/.claude', '-Users-me--claude'],
		// Case is preserved
		['/Users/me/GitKrakenComponents', '-Users-me-GitKrakenComponents'],
		// Every non-alphanumeric goes, not just separators
		['/Users/me/repo+branch', '-Users-me-repo-branch'],
		['/Users/me/my_repo', '-Users-me-my-repo'],
		['C:\\Users\\me\\repo', 'C--Users-me-repo'],
	];

	for (const [cwd, expected] of cases) {
		test(`encodes ${cwd}`, () => {
			assert.strictEqual(encodeProjectDirName(cwd), expected);
		});
	}
});

/** Reader rooted at a temp `projects` dir so the real locator runs without touching `~/.claude`. */
class RootedReader extends ClaudeCodeTranscriptReader {
	constructor(private readonly _root: string) {
		super();
	}
	protected override getProjectsRoot(): string {
		return this._root;
	}
}

/** Rooted reader that counts `readSummary` calls, for asserting `listSessions`'s scan bounds. */
class CountingSummaryReader extends RootedReader {
	readCount = 0;
	protected override async readSummary(entry: TranscriptSessionEntry): Promise<TranscriptSessionSummary> {
		this.readCount++;
		return super.readSummary(entry);
	}
}

/** Builds `<tmpRoot>/projects/<dirName>/<sessionId>.jsonl` carrying `title`; returns the projects root. */
async function seedProject(tmpRoot: string, dirName: string, sessionId: string, title: string): Promise<string> {
	const projects = join(tmpRoot, 'projects');
	const dir = join(projects, dirName);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${sessionId}.jsonl`), jsonl(aiTitle(sessionId, title)));
	return projects;
}

/** Subclass that exposes a read counter for cache assertions. */
class TrackingReader extends ClaudeCodeTranscriptReader {
	readCount = 0;
	constructor(private readonly _fixedPath: string) {
		super();
	}
	protected override locateTranscript(): Promise<string | undefined> {
		return Promise.resolve(this._fixedPath);
	}
	protected override readRange(
		path: string,
		start: number,
		end: number,
		sessionId: string,
		baseTitles: TranscriptTitles,
	): Promise<{ titles: TranscriptTitles; consumedEnd: number }> {
		this.readCount++;
		return super.readRange(path, start, end, sessionId, baseTitles);
	}
}

/** Push mtime forward by 1s. Some filesystems have 1s resolution, so a bare `utimes(now)` after
 *  a sub-second write may not bump the value the cache compares against. */
async function bumpMtime(path: string): Promise<void> {
	const future = Date.now() + 2000;
	await utimes(path, new Date(future), new Date(future));
}
