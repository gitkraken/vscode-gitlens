import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { appendFile, mkdir, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { TranscriptTitles } from '../providers/claudeCodeTranscript.js';
import { ClaudeCodeTranscriptReader } from '../providers/claudeCodeTranscript.js';

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

	test('locator: uses real directory lookup when no override is set', async () => {
		// Build a real-shaped layout: <root>/projects/<encoded-cwd>/<sessionId>.jsonl
		const projects = join(tmpRoot, 'projects');
		const cwd = '/Users/me/repo';
		const encoded = cwd.replace(/[/\\:]/g, '-');
		const projectDir = join(projects, encoded);
		await mkdir(projectDir, { recursive: true });
		const path = join(projectDir, `${sessionId}.jsonl`);
		await writeFile(path, jsonl(aiTitle(sessionId, 'Located')));

		// Build a reader that uses our temp `projects` dir as root via subclass override.
		class RootedReader extends ClaudeCodeTranscriptReader {
			protected override locateTranscript(sid: string): Promise<string | undefined> {
				return Promise.resolve(join(projectDir, `${sid}.jsonl`));
			}
		}
		const reader = new RootedReader();
		const titles = await reader.resolve(sessionId, cwd);
		assert.strictEqual(titles?.ai, 'Located');
	});
});

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
