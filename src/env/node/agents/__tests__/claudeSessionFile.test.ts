import * as assert from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyClaudeSessionHost } from '../claudeSessionFile.js';

suite('classifyClaudeSessionHost', () => {
	let dir: string;

	setup(async () => {
		dir = await mkdtemp(join(tmpdir(), 'gitlens-claude-sessions-'));
	});

	teardown(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test('returns undefined when the session file is missing', async () => {
		assert.strictEqual(await classifyClaudeSessionHost(12345, dir), undefined);
	});

	test('classifies entrypoint=claude-vscode as extension', async () => {
		await writeFile(
			join(dir, '111.json'),
			JSON.stringify({ pid: 111, sessionId: 's', entrypoint: 'claude-vscode' }),
		);
		assert.strictEqual(await classifyClaudeSessionHost(111, dir), 'extension');
	});

	test('classifies entrypoint=cli as cli', async () => {
		await writeFile(join(dir, '222.json'), JSON.stringify({ pid: 222, sessionId: 's', entrypoint: 'cli' }));
		assert.strictEqual(await classifyClaudeSessionHost(222, dir), 'cli');
	});

	test('classifies any non-claude-vscode entrypoint (e.g. sdk-ts) as cli', async () => {
		await writeFile(join(dir, '333.json'), JSON.stringify({ pid: 333, sessionId: 's', entrypoint: 'sdk-ts' }));
		assert.strictEqual(await classifyClaudeSessionHost(333, dir), 'cli');
	});

	test('returns undefined when entrypoint is missing', async () => {
		await writeFile(join(dir, '444.json'), JSON.stringify({ pid: 444, sessionId: 's' }));
		assert.strictEqual(await classifyClaudeSessionHost(444, dir), undefined);
	});

	test('returns undefined for malformed JSON', async () => {
		await writeFile(join(dir, '555.json'), '{not json');
		assert.strictEqual(await classifyClaudeSessionHost(555, dir), undefined);
	});

	test('returns undefined when the file claims a different pid than its filename', async () => {
		// Simulates a stale file left behind by a previous Claude run whose pid the OS has
		// since recycled to an unrelated process.
		await writeFile(
			join(dir, '666.json'),
			JSON.stringify({ pid: 999, sessionId: 's', entrypoint: 'claude-vscode' }),
		);
		assert.strictEqual(await classifyClaudeSessionHost(666, dir), undefined);
	});
});
