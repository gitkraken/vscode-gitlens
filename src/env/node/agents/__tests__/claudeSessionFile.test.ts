import * as assert from 'node:assert';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyClaudeSessionHost, getLiveClaudeSessions } from '../claudeSessionFile.js';

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

suite('getLiveClaudeSessions', () => {
	let dir: string;

	setup(async () => {
		dir = await mkdtemp(join(tmpdir(), 'gitlens-claude-agents-'));
	});

	teardown(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	/** Writes an executable stand-in for the `claude` binary at `<dir>/<name>` and returns its
	 *  path. `body` is the Node source run when it's spawned with `agents --json`. */
	async function writeFixture(name: string, body: string): Promise<string> {
		const path = join(dir, name);
		await writeFile(path, `#!/usr/bin/env node\n${body}\n`);
		await chmod(path, 0o755);
		return path;
	}

	test('returns an empty map when the binary is missing', async () => {
		const result = await getLiveClaudeSessions(join(dir, 'does-not-exist'));
		assert.strictEqual(result.size, 0);
	});

	test('returns an empty map when the command exits non-zero', async () => {
		const cmd = await writeFixture('nonzero.js', `process.exit(1);`);
		const result = await getLiveClaudeSessions(cmd);
		assert.strictEqual(result.size, 0);
	});

	test('returns an empty map for unparseable output', async () => {
		const cmd = await writeFixture('badjson.js', `process.stdout.write('not json');`);
		const result = await getLiveClaudeSessions(cmd);
		assert.strictEqual(result.size, 0);
	});

	test('returns an empty map when the spawn times out', async () => {
		const cmd = await writeFixture('hang.js', `setTimeout(() => {}, 60000);`);
		const result = await getLiveClaudeSessions(cmd, 200);
		assert.strictEqual(result.size, 0);
	});

	test('maps an interactive entry by sessionId, keeping pid and status', async () => {
		const cmd = await writeFixture(
			'interactive.js',
			`process.stdout.write(JSON.stringify([
				{ sessionId: 's1', pid: 111, cwd: '/repo', kind: 'interactive', status: 'waiting' },
			]));`,
		);
		const result = await getLiveClaudeSessions(cmd);
		assert.deepStrictEqual(result.get('s1'), {
			sessionId: 's1',
			pid: 111,
			cwd: '/repo',
			kind: 'interactive',
			status: 'waiting',
			state: undefined,
			waitingFor: undefined,
		});
	});

	test('maps a background entry by sessionId, with no pid and a state instead of a status', async () => {
		const cmd = await writeFixture(
			'background.js',
			`process.stdout.write(JSON.stringify([
				{ sessionId: 's2', cwd: '/repo', kind: 'background', state: 'blocked' },
			]));`,
		);
		const result = await getLiveClaudeSessions(cmd);
		assert.deepStrictEqual(result.get('s2'), {
			sessionId: 's2',
			pid: undefined,
			cwd: '/repo',
			kind: 'background',
			status: undefined,
			state: 'blocked',
			waitingFor: undefined,
		});
	});

	test('skips entries with no sessionId', async () => {
		const cmd = await writeFixture(
			'noSessionId.js',
			`process.stdout.write(JSON.stringify([{ pid: 1, kind: 'interactive', status: 'busy' }]));`,
		);
		const result = await getLiveClaudeSessions(cmd);
		assert.strictEqual(result.size, 0);
	});

	test('caches results so a second call within the TTL does not re-spawn the process', async () => {
		const counterFile = join(dir, 'counter.txt');
		const cmd = await writeFixture(
			'counter.js',
			`const fs = require('fs');
			const file = ${JSON.stringify(counterFile)};
			let n = 0;
			try { n = parseInt(fs.readFileSync(file, 'utf8'), 10) || 0; } catch {}
			n++;
			fs.writeFileSync(file, String(n));
			process.stdout.write(JSON.stringify([{ sessionId: 'c', kind: 'interactive', status: 'busy', cwd: 'call-' + n }]));`,
		);

		const first = await getLiveClaudeSessions(cmd);
		const second = await getLiveClaudeSessions(cmd);

		assert.strictEqual(first.get('c')?.cwd, 'call-1', 'first call spawns the process');
		assert.strictEqual(second.get('c')?.cwd, 'call-1', 'second call within the TTL reuses the cached result');
	});
});
