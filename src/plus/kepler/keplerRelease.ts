/**
 * Where GitLens finds Kepler's installer files, and how to read Kepler's update manifests. Pure — no
 * filesystem or network access — so it is shared by the Node installer and unit tests.
 *
 * Kepler publishes electron-builder update manifests (`latest-mac.yml`, `latest-linux.yml`,
 * `latest-linux-arm64.yml`) for macOS and Linux, next to the files they describe. Windows has no
 * manifest, so its setup is fetched from the URL the Windows download page links, and its version is
 * unknown until installed.
 *
 * Only the production channel is installable: the other channels have no public files.
 */

/** The base URL Kepler's production files and update manifests are served from. */
export const keplerReleaseBaseUrl = 'https://kepler.gitkraken.com/production/';

/**
 * The base URL of the Windows setups the download page links. Not {@link keplerReleaseBaseUrl}: the
 * setups under `production/` are no longer updated, and would install an outdated Kepler.
 */
export const keplerWindowsSetupBaseUrl = 'https://kepler.gitkraken.com/';

/** The kind of file a platform installs from — which decides how it is installed. */
export type KeplerReleaseFileKind = 'mac-zip' | 'windows-setup' | 'linux-appimage';

export interface KeplerReleaseTarget {
	readonly kind: KeplerReleaseFileKind;
	/** The installer's file name, as published */
	readonly fileName: string;
	/** The update manifest describing the file; `undefined` when the platform has none (Windows) */
	readonly manifestUrl: string | undefined;
	/** The file's URL when it is fetched without a manifest (Windows) */
	readonly fileUrl: string | undefined;
}

/** A Kepler release resolved for this machine — what to download, and how to check it. */
export interface KeplerRelease {
	readonly kind: KeplerReleaseFileKind;
	readonly url: string;
	readonly fileName: string;
	/** `undefined` when there is no manifest to read it from (Windows) */
	readonly version: string | undefined;
	/** In bytes; `undefined` when unknown */
	readonly size: number | undefined;
	/** Base64 SHA-512 of the file, as electron-builder publishes it; `undefined` when not published */
	readonly sha512: string | undefined;
}

/**
 * The installer this machine needs, or `undefined` when Kepler ships nothing installable for it (an
 * unsupported platform or CPU). `platform` and `arch` are Node's `process.platform` and `process.arch`.
 */
export function getKeplerReleaseTarget(platform: string, arch: string): KeplerReleaseTarget | undefined {
	if (arch !== 'x64' && arch !== 'arm64') return undefined;

	switch (platform) {
		case 'darwin':
			return {
				kind: 'mac-zip',
				fileName: `kepler-${arch}-mac.zip`,
				manifestUrl: `${keplerReleaseBaseUrl}latest-mac.yml`,
				fileUrl: undefined,
			};
		case 'win32': {
			const fileName = `kepler-${arch}-setup.exe`;
			return {
				kind: 'windows-setup',
				fileName: fileName,
				manifestUrl: undefined,
				fileUrl: `${keplerWindowsSetupBaseUrl}${fileName}`,
			};
		}
		case 'linux':
			return {
				kind: 'linux-appimage',
				fileName: `kepler-${arch}.AppImage`,
				manifestUrl: `${keplerReleaseBaseUrl}${arch === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml'}`,
				fileUrl: undefined,
			};
		default:
			return undefined;
	}
}

export interface KeplerManifestFile {
	readonly url: string;
	readonly sha512: string | undefined;
	readonly size: number | undefined;
}

export interface KeplerManifest {
	readonly version: string | undefined;
	readonly files: readonly KeplerManifestFile[];
}

/**
 * Reads an electron-builder update manifest. Handles only the flat shape electron-builder writes —
 * top-level scalars plus a `files:` list of `url`/`sha512`/`size` maps — rather than general YAML,
 * so the extension does not bundle a YAML parser for one small file.
 */
export function parseKeplerManifest(text: string): KeplerManifest {
	let version: string | undefined;
	const files: { url?: string; sha512?: string; size?: number }[] = [];
	let inFiles = false;
	let current: { url?: string; sha512?: string; size?: number } | undefined;

	for (const rawLine of text.split(/\r?\n/)) {
		if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;

		if (!/^\s/.test(rawLine)) {
			inFiles = false;
			current = undefined;

			const match = /^([\w-]+):\s*(.*)$/.exec(rawLine);
			if (match == null) continue;

			const [, key, value] = match;
			if (key === 'files') {
				inFiles = true;
			} else if (key === 'version') {
				version = unquote(value) || undefined;
			}
			continue;
		}

		if (!inFiles) continue;

		let line = rawLine.trim();
		if (line.startsWith('- ')) {
			current = {};
			files.push(current);
			line = line.substring(2).trim();
		}
		if (current == null) continue;

		const match = /^([\w-]+):\s*(.*)$/.exec(line);
		if (match == null) continue;

		const [, key, rawValue] = match;
		const value = unquote(rawValue);
		switch (key) {
			case 'url':
				current.url = value;
				break;
			case 'sha512':
				current.sha512 = value || undefined;
				break;
			case 'size': {
				const size = Number(value);
				current.size = Number.isFinite(size) && size > 0 ? size : undefined;
				break;
			}
		}
	}

	return {
		version: version,
		files: files
			.filter((f): f is { url: string; sha512?: string; size?: number } => Boolean(f.url))
			.map(f => ({ url: f.url, sha512: f.sha512, size: f.size })),
	};
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;

	const quote = trimmed[0];
	if ((quote === "'" || quote === '"') && trimmed.endsWith(quote)) return trimmed.substring(1, trimmed.length - 1);

	return trimmed;
}

/**
 * Picks this machine's file out of a manifest, resolving a relative `url` against the manifest's own
 * location. Returns `undefined` when the manifest does not list the file.
 */
export function resolveKeplerReleaseFromManifest(
	target: KeplerReleaseTarget,
	manifest: KeplerManifest,
): KeplerRelease | undefined {
	if (target.manifestUrl == null) return undefined;

	const file = manifest.files.find(f => getFileName(f.url) === target.fileName);
	if (file == null) return undefined;

	return {
		kind: target.kind,
		url: new URL(file.url, target.manifestUrl).toString(),
		fileName: target.fileName,
		version: manifest.version,
		size: file.size,
		sha512: file.sha512,
	};
}

function getFileName(url: string): string {
	const path = url.split(/[?#]/, 1)[0];
	return path.substring(path.lastIndexOf('/') + 1);
}

/**
 * Where GitLens installs the production AppImage on Linux — a user-owned folder, so no root prompt.
 * Built with `/` rather than `node:path` so it stays pure and testable on any host.
 */
export function getKeplerAppImagePath(home: string): string {
	return `${home}/.local/share/kepler/kepler.AppImage`;
}

/** The desktop entry GitLens writes for the AppImage, so `kepler://` links have a handler. */
export function getKeplerDesktopEntryPath(home: string): string {
	return `${home}/.local/share/applications/kepler.desktop`;
}

/** The desktop entry for the AppImage at `appImagePath`, registering it as the `kepler://` handler. */
export function createKeplerDesktopEntry(appImagePath: string): string {
	// The Desktop Entry spec quotes an argument in double quotes, escaping `"`, `` ` ``, `$` and `\`
	const exec = `"${appImagePath.replace(/["`$\\]/g, c => `\\${c}`)}"`;
	return [
		'[Desktop Entry]',
		'Name=Kepler',
		`Exec=${exec} %U`,
		'Terminal=false',
		'Type=Application',
		'StartupWMClass=Kepler',
		'MimeType=x-scheme-handler/kepler;',
		'Categories=Development;',
		'',
	].join('\n');
}

/**
 * The registry key Kepler's Windows setup records its install in — electron-builder keys it by a
 * UUID v5 of the app's `appId` (`com.kepler.app`), and the production setups write this one. Its
 * `InstallLocation` value is the authoritative install folder, the Kepler team's recommended check
 * over the conventional `%LOCALAPPDATA%\Programs\kepler` path. Production only.
 */
export const keplerWindowsRegistryKey = 'HKCU\\Software\\751d3ea0-c41b-536c-8ea6-a9428b2babdd';

/**
 * Where Windows looks up the `kepler://` handler. Kepler registers itself there on its first launch,
 * which a silent setup doesn't do, so GitLens registers it after installing.
 */
export const keplerWindowsProtocolKey = 'HKCU\\Software\\Classes\\kepler';

/** The `kepler://` handler's command for the Kepler executable at `exePath` — what Electron registers. */
export function getKeplerWindowsProtocolCommand(exePath: string): string {
	return `"${exePath}" "%1"`;
}

/**
 * Reads the `InstallLocation` value out of `reg query <key> /v InstallLocation` output, or
 * `undefined` when the output has none.
 */
export function parseKeplerInstallLocation(regOutput: string): string | undefined {
	const match = /^\s*InstallLocation\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(regOutput);
	return match?.[1] || undefined;
}

/** Bytes as whole megabytes (1 MB = 1,000,000 bytes, matching how the download page states sizes). */
export function toMegabytes(bytes: number): number {
	return Math.round(bytes / 1_000_000);
}

/**
 * Which step of an install failed. `cancelled` = the user cancelled; `unsupported` = nothing
 * installable for this machine; `manifest` = the update manifest could not be read; `download` = the
 * file could not be downloaded; `verify` = the file failed its integrity check; `install` = the file
 * could not be installed; `register` = Linux only, the `kepler://` handler could not be set.
 */
export type KeplerInstallFailureReason =
	| 'cancelled'
	| 'unsupported'
	| 'manifest'
	| 'download'
	| 'verify'
	| 'install'
	| 'register';

/** An install failure. `message` stays English, for logs; the UI maps `reason` to a localized message. */
export class KeplerInstallError extends Error {
	constructor(
		readonly reason: KeplerInstallFailureReason,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.name = 'KeplerInstallError';
	}
}

/** The steps an install reports progress for, in order. `register` happens on Linux only. */
export type KeplerInstallStep = 'download' | 'verify' | 'install' | 'register';

export interface KeplerInstallProgress {
	readonly step: KeplerInstallStep;
	/** Bytes downloaded so far; only for `download` */
	readonly transferred?: number;
	/** Total bytes to download, when known; only for `download` */
	readonly total?: number;
}

export interface KeplerInstallOptions {
	readonly onProgress?: (progress: KeplerInstallProgress) => void;
	readonly signal?: AbortSignal;
}
