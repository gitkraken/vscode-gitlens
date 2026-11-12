import * as assert from 'node:assert';
import {
	createKeplerDesktopEntry,
	getKeplerAppImagePath,
	getKeplerInstallFailureCode,
	getKeplerReleaseTarget,
	getKeplerWindowsProtocolCommand,
	KeplerInstallError,
	parseKeplerInstallLocation,
	parseKeplerManifest,
	parseKeplerVersion,
	resolveKeplerReleaseFromManifest,
	toMegabytes,
} from '../keplerRelease.js';

// The shape electron-builder writes for `latest-mac.yml`
const macManifest = `version: 0.16.0
files:
  - url: kepler-arm64-mac.zip
    sha512: armSha==
    size: 166123456
  - url: kepler-x64-mac.zip
    sha512: 'x64Sha=='
    size: 176000000
    blockMapSize: 180000
path: kepler-x64-mac.zip
sha512: x64Sha==
releaseDate: '2026-10-29T12:00:00.000Z'
`;

suite('getKeplerReleaseTarget', () => {
	test('macOS reads latest-mac.yml for the CPU-specific zip', () => {
		assert.deepStrictEqual(getKeplerReleaseTarget('darwin', 'arm64'), {
			kind: 'mac-zip',
			fileName: 'kepler-arm64-mac.zip',
			manifestUrl: 'https://kepler.gitkraken.com/production/latest-mac.yml',
			fileUrl: undefined,
		});
	});

	test("Windows has no manifest, so the setup comes from the download page's URL, outside production/", () => {
		assert.deepStrictEqual(getKeplerReleaseTarget('win32', 'x64'), {
			kind: 'windows-setup',
			fileName: 'kepler-x64-setup.exe',
			manifestUrl: undefined,
			fileUrl: 'https://kepler.gitkraken.com/kepler-x64-setup.exe',
		});
	});

	test('Linux reads a per-CPU manifest for the AppImage', () => {
		assert.strictEqual(
			getKeplerReleaseTarget('linux', 'x64')?.manifestUrl,
			'https://kepler.gitkraken.com/production/latest-linux.yml',
		);
		assert.strictEqual(
			getKeplerReleaseTarget('linux', 'arm64')?.manifestUrl,
			'https://kepler.gitkraken.com/production/latest-linux-arm64.yml',
		);
		assert.strictEqual(getKeplerReleaseTarget('linux', 'arm64')?.fileName, 'kepler-arm64.AppImage');
	});

	test('nothing is installable on an unsupported platform or CPU', () => {
		assert.strictEqual(getKeplerReleaseTarget('freebsd', 'x64'), undefined);
		assert.strictEqual(getKeplerReleaseTarget('win32', 'ia32'), undefined);
	});
});

suite('parseKeplerManifest', () => {
	test('reads the version and every file, ignoring other keys and quotes', () => {
		assert.deepStrictEqual(parseKeplerManifest(macManifest), {
			version: '0.16.0',
			files: [
				{ url: 'kepler-arm64-mac.zip', sha512: 'armSha==', size: 166123456 },
				{ url: 'kepler-x64-mac.zip', sha512: 'x64Sha==', size: 176000000 },
			],
		});
	});

	test('handles CRLF line endings and a missing files list', () => {
		assert.deepStrictEqual(parseKeplerManifest('version: "1.2.3"\r\npath: x\r\n'), { version: '1.2.3', files: [] });
	});
});

suite('resolveKeplerReleaseFromManifest', () => {
	test("picks this machine's file and resolves its URL against the manifest", () => {
		const target = getKeplerReleaseTarget('darwin', 'x64')!;
		assert.deepStrictEqual(resolveKeplerReleaseFromManifest(target, parseKeplerManifest(macManifest)), {
			kind: 'mac-zip',
			url: 'https://kepler.gitkraken.com/production/kepler-x64-mac.zip',
			fileName: 'kepler-x64-mac.zip',
			version: '0.16.0',
			size: 176000000,
			sha512: 'x64Sha==',
		});
	});

	test('returns undefined when the manifest does not list the file', () => {
		const target = getKeplerReleaseTarget('linux', 'x64')!;
		assert.strictEqual(resolveKeplerReleaseFromManifest(target, parseKeplerManifest(macManifest)), undefined);
	});
});

suite('createKeplerDesktopEntry', () => {
	test('registers the AppImage as the kepler:// handler, quoting a path with spaces', () => {
		const entry = createKeplerDesktopEntry(getKeplerAppImagePath('/home/my user'));

		assert.ok(entry.includes('Exec="/home/my user/.local/share/kepler/kepler.AppImage" %U\n'));
		assert.ok(entry.includes('MimeType=x-scheme-handler/kepler;\n'));
	});

	test('escapes the characters the Desktop Entry spec reserves inside quotes', () => {
		assert.ok(createKeplerDesktopEntry('/home/a"b$c').includes('Exec="/home/a\\"b\\$c" %U'));
	});
});

suite('parseKeplerInstallLocation', () => {
	test('reads the InstallLocation value out of reg query output, spaces in the path kept', () => {
		const output = [
			'',
			'HKEY_CURRENT_USER\\Software\\d000bc1b-54fa-5b1c-9bf6-b7c74cb36556',
			'    InstallLocation    REG_SZ    C:\\Users\\My User\\AppData\\Local\\Programs\\kepler',
			'',
		].join('\r\n');
		assert.strictEqual(parseKeplerInstallLocation(output), 'C:\\Users\\My User\\AppData\\Local\\Programs\\kepler');
	});

	test('returns undefined when the output has no InstallLocation value', () => {
		assert.strictEqual(parseKeplerInstallLocation('HKEY_CURRENT_USER\\Software\\x\r\n'), undefined);
	});
});

suite('getKeplerWindowsProtocolCommand', () => {
	test('quotes the executable and the link, as Electron registers a protocol handler', () => {
		assert.strictEqual(
			getKeplerWindowsProtocolCommand('C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\kepler\\Kepler.exe'),
			'"C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\kepler\\Kepler.exe" "%1"',
		);
	});
});

suite('toMegabytes', () => {
	test('rounds to whole decimal megabytes', () => {
		assert.strictEqual(toMegabytes(166_123_456), 166);
		assert.strictEqual(toMegabytes(175_600_000), 176);
	});
});

suite('getKeplerInstallFailureCode', () => {
	function error(props: Record<string, unknown>, cause?: unknown): Error {
		return Object.assign(new Error('/home/jane/secret: failed', { cause: cause }), props);
	}

	const cases: [name: string, ex: unknown, expected: string | undefined][] = [
		['a Node error code', error({ code: 'EACCES' }), 'EACCES'],
		['a process exit code', error({ code: 2 }), 'exit:2'],
		['a signal that ended a process', error({ signal: 'SIGKILL' }), 'SIGKILL'],
		['a process that timed out', error({ reason: 'timeout', signal: 'SIGTERM' }), 'timeout'],
		['a request that timed out', error({ name: 'TimeoutError', code: 23 }), 'timeout'],
		[
			'a network error under "fetch failed"',
			new TypeError('fetch failed', { cause: error({ code: 'ENOTFOUND' }) }),
			'ENOTFOUND',
		],
		['an abort, which has no cause of its own', error({ name: 'AbortError', code: 20 }), undefined],
		['a code that is not code-shaped', error({ code: '/home/jane/kepler' }), undefined],
		['an error with no code', new Error('/home/jane/secret'), undefined],
		['not an error', 'ENOENT', undefined],
		['an install error with its own code', new KeplerInstallError('download', 'x', { code: '404' }), '404'],
		[
			"an install error that takes its cause's code",
			new KeplerInstallError('register', 'x', { cause: error({ code: 1 }) }),
			'exit:1',
		],
		[
			'an install error wrapping another',
			new KeplerInstallError('manifest', 'x', {
				cause: new KeplerInstallError('manifest', 'y', { code: '503' }),
			}),
			'503',
		],
	];

	for (const [name, ex, expected] of cases) {
		test(`reads ${name}`, () => {
			assert.strictEqual(getKeplerInstallFailureCode(ex), expected);
		});
	}
});

suite('parseKeplerVersion', () => {
	test('reads the version Windows reports for an executable', () => {
		assert.strictEqual(parseKeplerVersion('0.16.0\r\n'), '0.16.0');
		assert.strictEqual(parseKeplerVersion('1.2.3-beta.1'), '1.2.3-beta.1');
		assert.strictEqual(parseKeplerVersion('0.16.0.0'), '0.16.0.0');
	});

	test('returns undefined for anything else', () => {
		assert.strictEqual(parseKeplerVersion(''), undefined);
		assert.strictEqual(parseKeplerVersion('Get-Item : Cannot find path C:\\Users\\Jane'), undefined);
	});
});
