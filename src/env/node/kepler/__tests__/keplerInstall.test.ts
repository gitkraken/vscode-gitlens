import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { KeplerInstallProgress, KeplerRelease } from '../../../../plus/kepler/keplerRelease.js';
import { KeplerInstallError } from '../../../../plus/kepler/keplerRelease.js';
import { installKepler } from '../keplerInstall.js';

const appImage = Buffer.from('#!/bin/sh\necho kepler\n'.repeat(4096));
const appImageSha512 = createHash('sha512').update(appImage).digest('base64');
const etag = '"kepler-0.16.0"';

async function rejectsWith(
	promise: Promise<unknown>,
	reason: KeplerInstallError['reason'],
	code?: string | RegExp,
): Promise<void> {
	await assert.rejects(promise, (ex: unknown) => {
		assert.ok(ex instanceof KeplerInstallError);
		assert.strictEqual(ex.reason, reason);
		if (typeof code === 'string') {
			assert.strictEqual(ex.code, code);
		} else if (code != null) {
			assert.match(ex.code ?? '', code);
		}
		return true;
	});
}

// The whole Linux install end to end: a local server stands in for Kepler's CDN, `HOME` for the user's
// home and a stub `xdg-mime` on `PATH` for the desktop's handler registration
suite('installKepler — Linux AppImage', () => {
	let dir: string;
	let home: string;
	let server: Server;
	let baseUrl: string;
	/** Bytes the server sends before cutting the connection, with the full `content-length` claimed */
	let truncateAt: number | undefined;
	let truncations: number;
	let ranges: boolean;
	let status: number;
	let requests: number;
	let rangeRequests: (string | undefined)[];
	const originalHome = process.env.HOME;
	const originalPath = process.env.PATH;

	const appImagePath = () => join(home, '.local/share/kepler/kepler.AppImage');
	const desktopEntryPath = () => join(home, '.local/share/applications/kepler.desktop');

	function release(sha512 = appImageSha512): KeplerRelease {
		return {
			kind: 'linux-appimage',
			url: `${baseUrl}/kepler-x64.AppImage`,
			fileName: 'kepler-x64.AppImage',
			version: '0.16.0',
			size: appImage.length,
			sha512: sha512,
		};
	}

	async function stubXdgMime(exitCode: number): Promise<void> {
		const bin = join(dir, 'bin');
		await mkdir(bin, { recursive: true });
		await writeFile(join(bin, 'xdg-mime'), `#!/bin/sh\nexit ${exitCode}\n`);
		await chmod(join(bin, 'xdg-mime'), 0o755);
		process.env.PATH = `${bin}${delimiter}${originalPath}`;
	}

	async function seedExistingInstall(): Promise<void> {
		await mkdir(join(home, '.local/share/kepler'), { recursive: true });
		await writeFile(appImagePath(), 'old kepler');
		await mkdir(join(home, '.local/share/applications'), { recursive: true });
		await writeFile(desktopEntryPath(), 'someone else’s entry');
	}

	suiteSetup(async function () {
		if (process.platform === 'win32') {
			this.skip();
		}

		server = createServer((req, res) => {
			requests++;
			rangeRequests.push(req.headers.range);
			if (status !== 200) {
				res.writeHead(status).end();
				return;
			}

			let body = appImage;
			const range = /^bytes=(\d+)-$/.exec(req.headers.range ?? '');
			if (ranges && range != null && req.headers['if-range'] === etag) {
				const start = Number(range[1]);
				body = appImage.subarray(start);
				res.writeHead(206, {
					'content-length': body.length,
					'content-range': `bytes ${start}-${appImage.length - 1}/${appImage.length}`,
					etag: etag,
				});
			} else {
				res.writeHead(200, { 'content-length': body.length, ...(ranges ? { etag: etag } : {}) });
			}

			if (truncateAt == null || truncations <= 0) {
				res.end(body);
				return;
			}

			truncations--;
			res.flushHeaders();
			setTimeout(() => res.write(body.subarray(0, truncateAt), () => res.socket?.destroy()), 20);
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	suiteTeardown(async () => {
		await new Promise<void>(resolve => (server != null ? server.close(() => resolve()) : resolve()));
	});

	setup(async () => {
		truncateAt = undefined;
		truncations = Infinity;
		ranges = true;
		status = 200;
		requests = 0;
		rangeRequests = [];
		dir = await mkdtemp(join(tmpdir(), 'gitlens-kepler-install-'));
		home = join(dir, 'home');
		process.env.HOME = home;
	});

	teardown(async () => {
		process.env.HOME = originalHome;
		process.env.PATH = originalPath;
		await rm(dir, { recursive: true, force: true });
	});

	test('installs a verified AppImage, executable, with a desktop entry for kepler://', async () => {
		await stubXdgMime(0);

		const result = await installKepler(release());
		const installed = result.location;

		assert.deepStrictEqual(result, { location: appImagePath() });
		assert.deepStrictEqual(await readFile(installed), appImage);
		assert.strictEqual((await stat(installed)).mode & 0o777, 0o755);
		assert.match(await readFile(desktopEntryPath(), 'utf8'), /^MimeType=x-scheme-handler\/kepler;$/m);
		assert.strictEqual(existsSync(`${installed}.download`), false);
	});

	test('refuses a download whose SHA-512 does not match, leaving the existing install untouched', async () => {
		await stubXdgMime(0);
		await seedExistingInstall();

		await rejectsWith(installKepler(release('not-the-hash')), 'verify', 'sha512-mismatch');

		assert.strictEqual(await readFile(appImagePath(), 'utf8'), 'old kepler');
	});

	test('refuses a release the manifest lists no SHA-512 for, without downloading it', async () => {
		await stubXdgMime(0);
		await seedExistingInstall();

		await rejectsWith(installKepler({ ...release(), sha512: undefined }), 'verify', 'sha512-missing');

		assert.strictEqual(requests, 0);
		assert.strictEqual(await readFile(appImagePath(), 'utf8'), 'old kepler');
	});

	test('resumes a download cut short where it stopped, and reports the resume', async () => {
		await stubXdgMime(0);
		truncateAt = 1024;
		truncations = 1;
		const progress: KeplerInstallProgress[] = [];

		const result = await installKepler(release(), { onProgress: p => progress.push(p) });

		assert.deepStrictEqual(await readFile(result.location), appImage);
		assert.deepStrictEqual(rangeRequests, [undefined, 'bytes=1024-']);
		const last = progress.findLast(p => p.step === 'download');
		assert.strictEqual(last?.transferred, appImage.length);
		assert.strictEqual(last?.resumes, 1);
		assert.strictEqual(last?.restarts, undefined);
	});

	test('starts a cut-short download over when the server cannot resume it, and reports the restart', async () => {
		await stubXdgMime(0);
		truncateAt = 1024;
		truncations = 1;
		ranges = false;
		const progress: KeplerInstallProgress[] = [];

		const result = await installKepler(release(), { onProgress: p => progress.push(p) });

		assert.deepStrictEqual(await readFile(result.location), appImage);
		assert.deepStrictEqual(rangeRequests, [undefined, undefined]);
		const last = progress.findLast(p => p.step === 'download');
		assert.strictEqual(last?.resumes, undefined);
		assert.strictEqual(last?.restarts, 1);
	});

	test('fails a download that keeps getting cut short, after 3 retries, installing nothing', async function () {
		this.timeout(10_000);
		await stubXdgMime(0);
		truncateAt = 1024;

		// The connection drops mid-file, so the code is the network error's, whichever the platform gives
		await rejectsWith(installKepler(release()), 'download', /^[A-Z][A-Z0-9_]+$/);

		assert.strictEqual(requests, 4);
		assert.strictEqual(existsSync(appImagePath()), false);
		assert.strictEqual(existsSync(desktopEntryPath()), false);
	});

	test('fails a download the server refuses, with the HTTP status as the code, without retrying', async () => {
		await stubXdgMime(0);
		status = 404;

		await rejectsWith(installKepler(release()), 'download', '404');

		assert.strictEqual(requests, 1);

		assert.strictEqual(existsSync(appImagePath()), false);
	});

	test('rolls back when kepler:// cannot be registered, keeping the existing install and desktop entry', async () => {
		await stubXdgMime(1);
		await seedExistingInstall();

		await rejectsWith(installKepler(release()), 'register', 'exit:1');

		assert.strictEqual(await readFile(appImagePath(), 'utf8'), 'old kepler');
		assert.strictEqual(existsSync(`${appImagePath()}.download`), false);
		assert.strictEqual(existsSync(desktopEntryPath()), true);
	});
});
