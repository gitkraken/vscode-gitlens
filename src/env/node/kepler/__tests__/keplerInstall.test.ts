import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { KeplerRelease } from '../../../../plus/kepler/keplerRelease.js';
import { KeplerInstallError } from '../../../../plus/kepler/keplerRelease.js';
import { installKepler } from '../keplerInstall.js';

const appImage = Buffer.from('#!/bin/sh\necho kepler\n'.repeat(4096));
const appImageSha512 = createHash('sha512').update(appImage).digest('base64');

async function rejectsWith(promise: Promise<unknown>, reason: KeplerInstallError['reason']): Promise<void> {
	await assert.rejects(promise, (ex: unknown) => ex instanceof KeplerInstallError && ex.reason === reason);
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
	let requests: number;
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

		server = createServer((_req, res) => {
			requests++;
			res.writeHead(200, { 'content-length': appImage.length });
			if (truncateAt == null) {
				res.end(appImage);
				return;
			}

			res.write(appImage.subarray(0, truncateAt));
			res.socket?.destroy();
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	suiteTeardown(async () => {
		await new Promise<void>(resolve => (server != null ? server.close(() => resolve()) : resolve()));
	});

	setup(async () => {
		truncateAt = undefined;
		requests = 0;
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

		const installed = await installKepler(release());

		assert.strictEqual(installed, appImagePath());
		assert.deepStrictEqual(await readFile(installed), appImage);
		assert.strictEqual((await stat(installed)).mode & 0o777, 0o755);
		assert.match(await readFile(desktopEntryPath(), 'utf8'), /^MimeType=x-scheme-handler\/kepler;$/m);
		assert.strictEqual(existsSync(`${installed}.download`), false);
	});

	test('refuses a download whose SHA-512 does not match, leaving the existing install untouched', async () => {
		await stubXdgMime(0);
		await seedExistingInstall();

		await rejectsWith(installKepler(release('not-the-hash')), 'verify');

		assert.strictEqual(await readFile(appImagePath(), 'utf8'), 'old kepler');
	});

	test('refuses a release the manifest lists no SHA-512 for, without downloading it', async () => {
		await stubXdgMime(0);
		await seedExistingInstall();

		await rejectsWith(installKepler({ ...release(), sha512: undefined }), 'verify');

		assert.strictEqual(requests, 0);
		assert.strictEqual(await readFile(appImagePath(), 'utf8'), 'old kepler');
	});

	test('fails a download cut short of its content-length, installing nothing', async () => {
		await stubXdgMime(0);
		truncateAt = 1024;

		await rejectsWith(installKepler(release()), 'download');

		assert.strictEqual(existsSync(appImagePath()), false);
		assert.strictEqual(existsSync(desktopEntryPath()), false);
	});

	test('rolls back when kepler:// cannot be registered, keeping the existing install and desktop entry', async () => {
		await stubXdgMime(1);
		await seedExistingInstall();

		await rejectsWith(installKepler(release()), 'register');

		assert.strictEqual(await readFile(appImagePath(), 'utf8'), 'old kepler');
		assert.strictEqual(existsSync(`${appImagePath()}.download`), false);
		assert.strictEqual(existsSync(desktopEntryPath()), true);
	});
});
