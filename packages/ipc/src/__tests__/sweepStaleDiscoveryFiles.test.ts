import * as assert from 'assert';
import { spawn } from 'child_process';
import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import type { Server } from 'http';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { pid as ownPid } from 'process';
import { sweepStaleDiscoveryFiles } from '../discovery.js';

async function exists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

/** Starts a localhost HTTP server; returns its base address and a stop() that frees the port. */
async function startServer(): Promise<{ address: string; server: Server; stop: () => Promise<void> }> {
	const server = createServer((_req, res) => res.end('ok'));
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as AddressInfo).port;
	return {
		address: `http://127.0.0.1:${port}`,
		server: server,
		stop: () => new Promise<void>(resolve => server.close(() => resolve())),
	};
}

/** Spawns then hard-kills a child process, returning a pid that is guaranteed dead (and reaped). */
async function getDeadPid(): Promise<number> {
	const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
	const deadPid = child.pid!;
	await new Promise<void>(resolve => {
		child.once('exit', () => resolve());
		child.kill('SIGKILL');
	});
	return deadPid;
}

function fileName(port: number): string {
	// ppid segment is irrelevant to parsing/sweeping — only the port is used.
	return `gitlens-ipc-server-1234-${port}.json`;
}

suite('sweepStaleDiscoveryFiles', () => {
	let dir: string;

	setup(async () => {
		dir = await mkdtemp(join(tmpdir(), 'gitlens-sweep-'));
	});

	teardown(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test('deletes a file whose server is unreachable', async () => {
		// Bind then immediately free the port so a connection attempt fails (refused or reset).
		const { address, stop } = await startServer();
		await stop();

		const file = join(dir, fileName(50001));
		await writeFile(file, JSON.stringify({ address: address, port: 50001, createdAt: new Date().toISOString() }));

		const result = await sweepStaleDiscoveryFiles([dir]);

		assert.strictEqual(await exists(file), false, 'unreachable file should be deleted');
		assert.deepStrictEqual(result, { scanned: 1, pruned: 1 });
	});

	test('keeps a file whose probe times out (ambiguous, not provably gone)', async () => {
		// A server that accepts connections but never responds — the probe times out, which must
		// be treated as "maybe alive, just slow" and kept.
		const server = createServer(() => {
			/* intentionally never responds */
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
		try {
			const file = join(dir, fileName(50010));
			await writeFile(
				file,
				JSON.stringify({ address: address, port: 50010, createdAt: new Date().toISOString() }),
			);

			const result = await sweepStaleDiscoveryFiles([dir]);

			assert.strictEqual(await exists(file), true, 'timed-out probe should keep the file');
			assert.deepStrictEqual(result, { scanned: 1, pruned: 0 });
		} finally {
			await new Promise<void>(resolve => server.close(() => resolve()));
		}
	});

	test('keeps a file whose server is reachable', async () => {
		const { address, stop } = await startServer();
		try {
			const file = join(dir, fileName(50002));
			await writeFile(
				file,
				JSON.stringify({ address: address, port: 50002, createdAt: new Date().toISOString() }),
			);

			const result = await sweepStaleDiscoveryFiles([dir]);

			assert.strictEqual(await exists(file), true, 'reachable file should be kept');
			assert.deepStrictEqual(result, { scanned: 1, pruned: 0 });
		} finally {
			await stop();
		}
	});

	test('deletes a file whose owning process is gone (pid short-circuit, before any probe)', async () => {
		// Reachable address proves the dead-pid check wins before the network probe.
		const { address, stop } = await startServer();
		try {
			const deadPid = await getDeadPid();
			const file = join(dir, fileName(50003));
			await writeFile(
				file,
				JSON.stringify({
					address: address,
					port: 50003,
					pid: deadPid,
					createdAt: new Date().toISOString(),
				}),
			);

			const result = await sweepStaleDiscoveryFiles([dir]);

			assert.strictEqual(await exists(file), false, 'dead-pid file should be deleted');
			assert.deepStrictEqual(result, { scanned: 1, pruned: 1 });
		} finally {
			await stop();
		}
	});

	test('keeps a file whose pid is alive and has no address to probe', async () => {
		const file = join(dir, fileName(50004));
		await writeFile(file, JSON.stringify({ port: 50004, pid: ownPid, createdAt: new Date().toISOString() }));

		const result = await sweepStaleDiscoveryFiles([dir]);

		assert.strictEqual(await exists(file), true, 'live-pid file should be kept');
		assert.deepStrictEqual(result, { scanned: 1, pruned: 0 });
	});

	test('falls through to the probe for a malformed pid (does not delete on a bad pid)', async () => {
		// pid 0 / negatives have process-group semantics; the sweep must not treat them as a dead
		// pid. With a reachable server, the file is kept.
		const { address, stop } = await startServer();
		try {
			const file = join(dir, fileName(50008));
			await writeFile(
				file,
				JSON.stringify({ address: address, port: 50008, pid: 0, createdAt: new Date().toISOString() }),
			);

			const result = await sweepStaleDiscoveryFiles([dir]);

			assert.strictEqual(await exists(file), true, 'malformed-pid file with a live server should be kept');
			assert.deepStrictEqual(result, { scanned: 1, pruned: 0 });
		} finally {
			await stop();
		}
	});

	test('still deletes a malformed-pid file when the server refuses connections', async () => {
		const { address, stop } = await startServer();
		await stop();

		const file = join(dir, fileName(50009));
		await writeFile(
			file,
			JSON.stringify({ address: address, port: 50009, pid: -1, createdAt: new Date().toISOString() }),
		);

		const result = await sweepStaleDiscoveryFiles([dir]);

		assert.strictEqual(await exists(file), false, 'malformed-pid file with a dead server should be deleted');
		assert.deepStrictEqual(result, { scanned: 1, pruned: 1 });
	});

	test('keeps a file it cannot parse', async () => {
		const file = join(dir, fileName(50005));
		await writeFile(file, 'not json');

		const result = await sweepStaleDiscoveryFiles([dir]);

		assert.strictEqual(await exists(file), true, 'unparseable file should be kept');
		assert.deepStrictEqual(result, { scanned: 1, pruned: 0 });
	});

	test('ignores files that do not match the discovery name pattern', async () => {
		const file = join(dir, 'something-else.json');
		await writeFile(file, JSON.stringify({ address: 'http://127.0.0.1:1', port: 1 }));

		const result = await sweepStaleDiscoveryFiles([dir]);

		assert.strictEqual(await exists(file), true, 'non-discovery file should be untouched');
		assert.deepStrictEqual(result, { scanned: 0, pruned: 0 });
	});

	test('respects excludePorts and excludePaths', async () => {
		const byPort = join(dir, fileName(50006));
		const byPath = join(dir, fileName(50007));
		// Both would otherwise be deleted (refused connection), but are excluded.
		await writeFile(byPort, JSON.stringify({ address: 'http://127.0.0.1:50006', port: 50006 }));
		await writeFile(byPath, JSON.stringify({ address: 'http://127.0.0.1:50007', port: 50007 }));

		const result = await sweepStaleDiscoveryFiles([dir], {
			excludePorts: [50006],
			excludePaths: [byPath],
		});

		assert.strictEqual(await exists(byPort), true, 'excluded port should be kept');
		assert.strictEqual(await exists(byPath), true, 'excluded path should be kept');
		assert.deepStrictEqual(result, { scanned: 0, pruned: 0 });
	});

	test('returns zero counts when a directory does not exist', async () => {
		const result = await sweepStaleDiscoveryFiles([join(dir, 'does-not-exist')]);
		assert.deepStrictEqual(result, { scanned: 0, pruned: 0 });
	});
});
