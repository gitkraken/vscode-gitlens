import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, existsSync } from 'node:fs';
import { access, chmod, constants, copyFile, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { arch, env, platform } from 'node:process';
import { run } from '@gitlens/utils/env/node/exec.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getKeplerInstallPaths, getKeplerProductName } from '../../../plus/kepler/keplerProviders.js';
import type {
	KeplerInstallOptions,
	KeplerManifest,
	KeplerRelease,
	KeplerReleaseTarget,
} from '../../../plus/kepler/keplerRelease.js';
import {
	createKeplerDesktopEntry,
	getKeplerAppImagePath,
	getKeplerDesktopEntryPath,
	getKeplerReleaseTarget,
	getKeplerWindowsProtocolCommand,
	KeplerInstallError,
	keplerWindowsProtocolKey,
	keplerWindowsRegistryKey,
	parseKeplerInstallLocation,
	parseKeplerManifest,
	resolveKeplerReleaseFromManifest,
} from '../../../plus/kepler/keplerRelease.js';
import type { KeplerChannel } from '../../../plus/kepler/keplerService.js';

const launchServicesRegister =
	'/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

/** Max time with no download progress before the download is treated as stalled. */
const downloadStallTimeout = 60_000; // 60s
/** Total-duration cap for the small manifest (or Windows size) request. */
const manifestFetchTimeout = 30_000; // 30s

/** Returns true if the given channel's Kepler app is installed on disk. Node-side implementation. */
export function isKeplerInstalled(channel: KeplerChannel): boolean {
	const paths = getKeplerInstallPaths(channel, platform, {
		home: homedir(),
		localAppData: env.LOCALAPPDATA,
	});
	return paths.some(p => existsSync(p));
}

/**
 * Where Windows' registry says Kepler is installed, when that folder exists — catches an install the
 * path probe in {@link isKeplerInstalled} misses (a custom install folder). The registry exists only on
 * Windows, so on other platforms this always returns `undefined` — even when Kepler is installed. Also
 * `undefined` for other channels, or when Kepler isn't installed.
 */
export async function findKeplerRegistryInstallLocation(channel: KeplerChannel): Promise<string | undefined> {
	if (platform !== 'win32' || channel !== 'production') return undefined;

	try {
		const output = await run('reg.exe', ['query', keplerWindowsRegistryKey, '/v', 'InstallLocation'], 'utf8', {
			quiet: true,
			timeout: 10_000,
		});
		const location = parseKeplerInstallLocation(output);
		return location != null && existsSync(location) ? location : undefined;
	} catch {
		// `reg query` exits non-zero when the key or value doesn't exist — Kepler isn't installed
		return undefined;
	}
}

/** The installer this machine needs, or `undefined` when Kepler ships none for it. */
export function getKeplerReleaseTargetForHost(): KeplerReleaseTarget | undefined {
	return getKeplerReleaseTarget(platform, arch);
}

/**
 * Resolves the release to install for this machine: reads the update manifest on macOS and Linux; on
 * Windows, which has no manifest, asks the server for the setup's size only.
 */
export async function getKeplerRelease(target: KeplerReleaseTarget): Promise<KeplerRelease> {
	if (target.manifestUrl == null) {
		const url = target.fileUrl!;
		let size: number | undefined;
		try {
			const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(manifestFetchTimeout) });
			const length = Number(response.headers.get('content-length'));
			size = response.ok && Number.isFinite(length) && length > 0 ? length : undefined;
		} catch {
			// The size is only shown to the user; the download itself reports what fails
		}

		return {
			kind: target.kind,
			url: url,
			fileName: target.fileName,
			version: undefined,
			size: size,
			sha512: undefined,
		};
	}

	let manifest: KeplerManifest;
	try {
		const response = await fetch(target.manifestUrl, { signal: AbortSignal.timeout(manifestFetchTimeout) });
		if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

		manifest = parseKeplerManifest(await response.text());
	} catch (ex) {
		throw new KeplerInstallError('manifest', `Unable to read ${target.manifestUrl}`, { cause: ex });
	}

	const release = resolveKeplerReleaseFromManifest(target, manifest);
	if (release == null) {
		throw new KeplerInstallError('manifest', `${target.manifestUrl} does not list ${target.fileName}`);
	}

	return release;
}

/**
 * Where macOS' Launch Services says the app that opens `kepler://` links is, when it exists — catches a
 * Kepler the path probe in {@link isKeplerInstalled} misses (one outside the Applications folders).
 * Launch Services exists only on macOS, so on other platforms this always returns `undefined` — even
 * when Kepler is installed. Also `undefined` for other channels, or when no app opens `kepler://` links.
 */
export async function findKeplerLaunchServicesInstallLocation(channel: KeplerChannel): Promise<string | undefined> {
	if (platform !== 'darwin' || channel !== 'production') return undefined;

	try {
		// JavaScript for Automation reaches NSWorkspace through its Objective-C bridge, which needs no
		// Apple Events permission, unlike AppleScript. NSWorkspace leaves out apps in the Trash
		const output = await run(
			'/usr/bin/osascript',
			[
				'-l',
				'JavaScript',
				'-e',
				'ObjC.import("AppKit"); const app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("kepler://")); app.isNil() ? "" : app.path.js',
			],
			'utf8',
			{ quiet: true, timeout: 10_000 },
		);
		const location = output.trim();
		return location && existsSync(location) ? location : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Downloads, verifies and installs a Kepler release into a user-owned location — no admin prompt.
 * Returns the installed app's path. Throws {@link KeplerInstallError}.
 */
export async function installKepler(release: KeplerRelease, options?: KeplerInstallOptions): Promise<string> {
	throwIfCancelled(options?.signal);

	// A silent setup closes a running Kepler, so never run it over an install the path probe missed
	if (release.kind === 'windows-setup') {
		const existing = await findKeplerRegistryInstallLocation('production');
		if (existing != null) return existing;
	} else if (release.sha512 == null) {
		// On macOS and Linux the manifest's SHA-512 is the only check on the download
		throw new KeplerInstallError('verify', `The manifest lists no SHA-512 for ${release.fileName}`);
	}

	const tempDir = await mkdtemp(join(tmpdir(), 'gitlens-kepler-'));
	try {
		const file = join(tempDir, release.fileName);
		const sha512 = await download(release, file, options);

		throwIfCancelled(options?.signal);
		options?.onProgress?.({ step: 'verify' });
		if (release.sha512 != null) {
			if (sha512 !== release.sha512) {
				throw new KeplerInstallError('verify', `SHA-512 mismatch for ${release.fileName}`);
			}
		} else {
			await verifyAuthenticode(file);
		}

		throwIfCancelled(options?.signal);
		options?.onProgress?.({ step: 'install' });
		switch (release.kind) {
			case 'mac-zip':
				return await installMacZip(file, tempDir);
			case 'windows-setup':
				return await installWindowsSetup(file);
			case 'linux-appimage':
				return await installLinuxAppImage(file, options);
		}
	} catch (ex) {
		if (ex instanceof KeplerInstallError) throw ex;
		if (options?.signal?.aborted) throw new KeplerInstallError('cancelled', 'Cancelled', { cause: ex });

		throw new KeplerInstallError('install', 'Unable to install Kepler', { cause: ex });
	} finally {
		void rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new KeplerInstallError('cancelled', 'Cancelled');
}

/** Streams the file to disk, reporting progress and hashing as it goes. Returns the base64 SHA-512. */
async function download(release: KeplerRelease, file: string, options?: KeplerInstallOptions): Promise<string> {
	const controller = new AbortController();
	const onAbort = () => controller.abort();
	options?.signal?.addEventListener('abort', onAbort);

	let stalled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const armStallTimer = () => {
		if (timer != null) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			stalled = true;
			controller.abort();
		}, downloadStallTimeout);
	};

	const hash = createHash('sha512');
	const out = createWriteStream(file);
	let writeError: Error | undefined;
	out.on('error', ex => {
		writeError = ex;
		controller.abort();
	});
	try {
		armStallTimer();
		const response = await fetch(release.url, { signal: controller.signal });
		if (!response.ok || response.body == null) {
			throw new KeplerInstallError('download', `${response.status} ${response.statusText}`);
		}

		const length = Number(response.headers.get('content-length'));
		const total = Number.isFinite(length) && length > 0 ? length : release.size;
		let transferred = 0;
		options?.onProgress?.({ step: 'download', transferred: 0, total: total });

		const reader = response.body.getReader();
		for (;;) {
			armStallTimer();
			const { done, value } = await reader.read();
			if (done) break;

			const chunk: Uint8Array = value;
			hash.update(chunk);
			if (!out.write(chunk)) {
				await once(out, 'drain', { signal: controller.signal });
			}
			transferred += chunk.byteLength;
			options?.onProgress?.({ step: 'download', transferred: transferred, total: total });
		}

		await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));

		if (total != null && transferred !== total) {
			throw new KeplerInstallError('download', `Downloaded ${transferred} of ${total} bytes`);
		}
		return hash.digest('base64');
	} catch (ex) {
		out.destroy();
		if (ex instanceof KeplerInstallError) throw ex;
		if (options?.signal?.aborted) throw new KeplerInstallError('cancelled', 'Cancelled', { cause: ex });

		throw new KeplerInstallError(
			'download',
			stalled ? `Download stalled (no progress for ${downloadStallTimeout}ms)` : 'Download failed',
			{ cause: writeError ?? ex },
		);
	} finally {
		if (timer != null) {
			clearTimeout(timer);
		}
		options?.signal?.removeEventListener('abort', onAbort);
	}
}

/** Windows publishes no SHA-512, so the setup's Authenticode signature is checked instead. */
async function verifyAuthenticode(file: string): Promise<void> {
	// VS Code started from PowerShell 7 inherits its `PSModulePath`, whose 7.x modules Windows
	// PowerShell 5.1 can't load — `Get-AuthenticodeSignature` among them. Unset, 5.1 uses its own.
	// Windows environment variable names ignore case, so match it that way
	const inherited = Object.fromEntries(Object.entries(env).filter(([k]) => k.toLowerCase() !== 'psmodulepath'));

	let status: string;
	try {
		// The path goes through the environment, not the command line, so it needs no quoting
		const output = await run(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				'(Get-AuthenticodeSignature -LiteralPath $env:GITLENS_KEPLER_SETUP).Status',
			],
			'utf8',
			{ env: { ...inherited, GITLENS_KEPLER_SETUP: file }, timeout: 60_000 },
		);
		status = output.trim();
	} catch (ex) {
		throw new KeplerInstallError('verify', 'Unable to check the setup signature', { cause: ex });
	}

	if (status !== 'Valid') throw new KeplerInstallError('verify', `The setup signature is not valid (${status})`);
}

/**
 * Unzips with `ditto`, which keeps the bundle's symlinks and permissions (a JS unzip would break the
 * app), into `/Applications`, or `~/Applications` when that isn't writable.
 */
async function installMacZip(file: string, tempDir: string): Promise<string> {
	const extractDir = join(tempDir, 'extract');
	await mkdir(extractDir);
	await run('ditto', ['-x', '-k', file, extractDir], 'utf8');

	const app = (await readdir(extractDir)).find(name => name.endsWith('.app'));
	if (app == null) throw new KeplerInstallError('install', 'The download has no app bundle');

	let applications = '/Applications';
	try {
		await access(applications, constants.W_OK);
	} catch {
		applications = join(homedir(), 'Applications');
		await mkdir(applications, { recursive: true });
	}

	const target = join(applications, app);
	await rm(target, { recursive: true, force: true });
	try {
		await rename(join(extractDir, app), target);
	} catch {
		// A different volume than the temp folder; copy instead, again keeping symlinks and permissions
		await run('ditto', [join(extractDir, app), target], 'utf8');
	}

	// A moved app isn't known to Launch Services until first launched, so the `kepler://` link opened
	// right after installing would find no handler
	try {
		await run(launchServicesRegister, ['-f', target], 'utf8');
	} catch (ex) {
		// The app is installed either way, and registers itself on its first launch
		Logger.warn(`Unable to register ${target} with Launch Services`, ex);
	}
	return target;
}

/**
 * Runs Kepler's NSIS setup silently (`/S`, the flag Kepler's own auto-updater uses). It is one-click
 * and per-user, so it needs no admin rights. Without `--force-run` a silent setup doesn't launch
 * Kepler when done, which is what we want: the caller opens a `kepler://` link next, which launches
 * it. Exit code 0 is success; anything else (usually 2) is a failure, cancellation included — the
 * setup doesn't tell them apart.
 */
async function installWindowsSetup(file: string): Promise<string> {
	const code = await run(file, ['/S'], 'utf8', { exitCodeOnly: true });
	if (code !== 0) throw new KeplerInstallError('install', `The setup exited with code ${code}`);

	const installed =
		(await findKeplerRegistryInstallLocation('production')) ??
		getKeplerInstallPaths('production', 'win32', {
			home: homedir(),
			localAppData: env.LOCALAPPDATA,
		}).find(p => existsSync(p));
	if (installed == null) throw new KeplerInstallError('install', 'The setup finished, but Kepler was not found');

	await registerWindowsProtocol(installed);
	return installed;
}

/**
 * Registers Kepler as the `kepler://` handler, as Kepler does on its first launch — which a silent
 * setup skips, so the link opened right after installing would find no handler. Also replaces a
 * handler an earlier uninstall left behind, pointing at a deleted executable.
 */
async function registerWindowsProtocol(installFolder: string): Promise<void> {
	const exe = join(installFolder, `${getKeplerProductName('production')}.exe`);
	try {
		if (!existsSync(exe)) throw new Error(`${exe} not found`);

		const options = { quiet: true, timeout: 10_000 };
		await run('reg.exe', ['add', keplerWindowsProtocolKey, '/ve', '/d', 'URL:kepler', '/f'], 'utf8', options);
		await run('reg.exe', ['add', keplerWindowsProtocolKey, '/v', 'URL Protocol', '/d', '', '/f'], 'utf8', options);
		await run(
			'reg.exe',
			[
				'add',
				`${keplerWindowsProtocolKey}\\shell\\open\\command`,
				'/ve',
				'/d',
				getKeplerWindowsProtocolCommand(exe),
				'/f',
			],
			'utf8',
			options,
		);
	} catch (ex) {
		// Kepler is installed either way, and registers itself on its first launch
		Logger.warn('Unable to register kepler:// links', ex);
	}
}

/**
 * Copies the AppImage into `~/.local/share/kepler/` and registers it as the `kepler://` handler. The
 * AppImage lands under a temporary name and replaces any existing one only once registered, so a
 * failed attempt leaves the previous install untouched and removes only what it created.
 */
async function installLinuxAppImage(file: string, options?: KeplerInstallOptions): Promise<string> {
	const home = homedir();
	const target = getKeplerAppImagePath(home);
	const staged = `${target}.download`;
	const desktopEntry = getKeplerDesktopEntryPath(home);
	const desktopEntryExisted = existsSync(desktopEntry);
	try {
		await mkdir(dirname(target), { recursive: true });
		await copyFile(file, staged);
		await chmod(staged, 0o755);

		throwIfCancelled(options?.signal);
		options?.onProgress?.({ step: 'register' });

		try {
			await mkdir(dirname(desktopEntry), { recursive: true });
			await writeFile(desktopEntry, createKeplerDesktopEntry(target), 'utf8');
			await run('xdg-mime', ['default', 'kepler.desktop', 'x-scheme-handler/kepler'], 'utf8');
		} catch (ex) {
			throw new KeplerInstallError('register', 'Unable to register kepler:// links', { cause: ex });
		}

		await rename(staged, target);
	} catch (ex) {
		await Promise.all([
			rm(staged, { force: true }),
			desktopEntryExisted ? undefined : rm(desktopEntry, { force: true }),
		]).catch(() => undefined);
		throw ex;
	}

	// Refreshes the MIME cache some desktops read; not every distro ships the tool
	try {
		await run('update-desktop-database', [dirname(desktopEntry)], 'utf8', { quiet: true });
	} catch {}

	return target;
}
