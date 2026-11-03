/**
 * Clears the e2e output of a job that held sign-in credentials (#5682), so nothing of them leaves the runner if the
 * output is published, and the job fails when one reached it:
 * - any file holding a secret value is deleted, and the run fails — in its contents or in its path, which an artifact
 *   would publish too (a directory's name included), and which the log then withholds;
 * - e-mail addresses and JWT-shaped strings in text files are masked in place, so the test account's address isn't
 *   published.
 *
 * It finds credentials, not other account data: an `error-context.md` snapshot of account UI passes it unchanged.
 *
 * Usage: SCAN_SECRET_NAMES="NAME_A,NAME_B" node scripts/e2eScanForSecrets.mjs <dir> [<dir> …]
 *
 * Each named environment variable's value is searched for verbatim and in the encodings a test could plausibly
 * write it in: URL-encoding, and base64 / base64url at each of the three byte offsets it can sit at inside a larger
 * encoded blob. This is best-effort: it can't know values it wasn't given — the account tokens a sign-in mints among
 * them — or encodings beyond these. Playwright traces are zips, so a `.zip` is scanned as its own bytes — entry
 * names, comments and extra fields are stored there uncompressed — and as its members' contents through `unzip -p`.
 * Anything that can't be read or masked — an archive, a file, a directory — is deleted too and counts as a hit, so
 * nothing unscanned is left. Only after a complete pass does it write `complete=true` to `GITHUB_OUTPUT`, so an upload
 * step can require it: a scan that crashes midway lets no such upload run. Values shorter than 8 characters are
 * ignored (too likely to collide). Nothing secret is printed: only the file and what happened to it, not which secret
 * or encoding matched. Masking covers text files only (by extension, and never a file holding NUL bytes) — signed-in
 * specs keep traces off, so no zip should carry account details in the first place.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const textExtensions = new Set(['.html', '.json', '.log', '.md', '.txt', '.xml', '.yml', '.yaml']);
const emailPattern = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const jwtPattern = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;

/**
 * @param {Record<string, string | undefined>} env
 * @param {string[]} names
 * @returns {{ name: string; encoding: string; bytes: Buffer }[]}
 */
export function secretNeedles(env, names) {
	const needles = [];
	for (const name of names) {
		// Trimmed as the sign-in fixture trims it: a stored value with a trailing newline is used without it
		const value = env[name]?.trim();
		if (!value || value.length < 8) continue;

		const forms = new Map([
			['verbatim', value],
			['url-encoded', encodeURIComponent(value)],
		]);
		// Inside a larger encoded blob (e.g. a whole `Cookie:` header) the value can start at any of the 3 byte
		// offsets of a base64 group, and each encodes it differently. Keep, per offset, only the characters whose
		// bits all come from the value — those don't depend on the bytes around it.
		for (let offset = 0; offset < 3; offset++) {
			const bytes = Buffer.concat([Buffer.alloc(offset), Buffer.from(value)]);
			const start = Math.ceil((offset * 8) / 6);
			const end = Math.floor((bytes.length * 8) / 6);
			forms.set(`base64 (offset ${offset})`, bytes.toString('base64').slice(start, end));
			forms.set(`base64url (offset ${offset})`, bytes.toString('base64url').slice(start, end));
		}
		const seen = new Set();
		for (const [encoding, form] of forms) {
			if (seen.has(form)) continue;

			seen.add(form);
			needles.push({ name: name, encoding: encoding, bytes: Buffer.from(form) });
		}
	}
	return needles;
}

/**
 * @param {string} dir
 * @param {(dir: string) => void} onUnreadable
 */
function* files(dir, onUnreadable) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		onUnreadable(dir);
		return;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* files(full, onUnreadable);
		} else {
			// Symlinks and other entries are yielded too, so nothing is left without being read
			yield full;
		}
	}
}

/**
 * @param {string} file
 * @returns {Buffer | undefined} undefined when the file can't be read
 */
function contentOf(file) {
	try {
		if (file.endsWith('.zip')) {
			// `unzip -p` yields the members' contents only: the archive's own bytes carry the rest. Its stderr is
			// captured, never passed through: its diagnostics name the entries, and a name can hold a secret
			return Buffer.concat([
				readFileSync(file),
				execFileSync('unzip', ['-p', file], {
					maxBuffer: 1024 * 1024 * 1024,
					stdio: ['ignore', 'pipe', 'pipe'],
				}),
			]);
		}
		return readFileSync(file);
	} catch {
		return undefined;
	}
}

/**
 * @param {Buffer | string} data
 * @param {{ name: string; encoding: string; bytes: Buffer }[]} needles
 */
function carriesSecret(data, needles) {
	const bytes = typeof data === 'string' ? Buffer.from(data) : data;
	return needles.some(n => bytes.indexOf(n.bytes) !== -1);
}

/**
 * The path as the log may show it: an artifact path is published too, so one whose names (below the scanned
 * directory) carry secret material is withheld.
 * @param {string} dir
 * @param {string} entry
 * @param {{ name: string; encoding: string; bytes: Buffer }[]} needles
 */
function shownPath(dir, entry, needles) {
	return carriesSecret(path.relative(dir, entry), needles) ? path.join(dir, '<name withheld>') : entry;
}

/**
 * @param {string} file
 * @param {string} shown the file's path as the log may show it
 * @param {{ name: string; encoding: string; bytes: Buffer }[]} needles
 * @param {(line: string) => void} log
 * @returns {'removed' | 'masked' | undefined}
 */
function clearFile(file, shown, needles, log) {
	const content = contentOf(file);
	if (content == null) {
		log(`[secret-scan] ${shown}: unreadable — deleted`);
		rmSync(file, { force: true });
		return 'removed';
	}

	// Which secret or encoding matched stays out of the log: it is derived from the secret values themselves
	if (carriesSecret(content, needles)) {
		log(`[secret-scan] ${shown}: contains detected secret material — deleted`);
		rmSync(file, { force: true });
		return 'removed';
	}

	if (!textExtensions.has(path.extname(file).toLowerCase()) || content.includes(0)) {
		return undefined;
	}

	const text = content.toString('utf8');
	const redacted = text.replace(emailPattern, '<email>').replace(jwtPattern, '<token>');
	if (redacted === text) return undefined;

	writeFileSync(file, redacted);
	log(`[secret-scan] ${shown}: e-mail addresses / tokens masked`);
	return 'masked';
}

/**
 * @param {string[]} dirs
 * @param {{ name: string; encoding: string; bytes: Buffer }[]} needles
 * @param {(line: string) => void} [log]
 * @returns {{ scanned: number; removed: string[]; masked: string[] }}
 */
export function scanOutput(dirs, needles, log = console.log) {
	let scanned = 0;
	const removed = [];
	const masked = [];
	for (const dir of dirs) {
		if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;

		const onUnreadable = (/** @type {string} */ unreadable) => {
			removed.push(unreadable);
			log(`[secret-scan] ${shownPath(dir, unreadable, needles)}: unreadable directory — deleted`);
			rmSync(unreadable, { recursive: true, force: true });
		};
		for (const file of files(dir, onUnreadable)) {
			scanned++;
			const shown = shownPath(dir, file, needles);
			let outcome;
			try {
				// A name is published as the artifact's path: one carrying secret material goes, whatever it holds.
				// A directory's name is part of the path of every file under it
				if (shown !== file) {
					log(`[secret-scan] ${shown}: name contains detected secret material — deleted`);
					rmSync(file, { force: true });
					outcome = 'removed';
				} else {
					outcome = clearFile(file, shown, needles, log);
				}
			} catch {
				// Couldn't mask it (e.g. read-only) — then it doesn't stay either
				outcome = 'removed';
				log(`[secret-scan] ${shown}: could not be cleared — deleted`);
				rmSync(file, { force: true });
			}
			if (outcome === 'removed') {
				removed.push(file);
			} else if (outcome === 'masked') {
				masked.push(file);
			}
		}
		// A directory whose name carries secret material was emptied above, but an empty directory still has a name
		removeDirectoriesNamedWithSecrets(dir, dir, needles, removed, log);
	}
	return { scanned: scanned, removed: removed, masked: masked };
}

/**
 * @param {string} root
 * @param {string} dir
 * @param {{ name: string; encoding: string; bytes: Buffer }[]} needles
 * @param {string[]} removed
 * @param {(line: string) => void} log
 */
function removeDirectoriesNamedWithSecrets(root, dir, needles, removed, log) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;

		const full = path.join(dir, entry.name);
		if (carriesSecret(path.relative(root, full), needles)) {
			// One that held files is already counted through them; one that held none (only empty directories, if
			// anything) reached no count yet, and the run must still fail on it
			if (!removed.some(r => r.startsWith(full + path.sep))) {
				removed.push(full);
				log(
					`[secret-scan] ${shownPath(root, full, needles)}: name contains detected secret material — deleted`,
				);
			}
			rmSync(full, { recursive: true, force: true });
		} else {
			removeDirectoriesNamedWithSecrets(root, full, needles, removed, log);
		}
	}
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const names = (process.env.SCAN_SECRET_NAMES ?? '')
		.split(',')
		.map(s => s.trim())
		.filter(Boolean);
	const needles = secretNeedles(process.env, names);
	if (!needles.length) {
		// A job that is meant to hold credentials but has none would sign nothing in — say so, but still mask
		console.log('[secret-scan] no secret values to scan for');
	}

	let result;
	try {
		result = scanOutput(process.argv.slice(2), needles);
	} catch {
		// A deletion that failed even on the second attempt lands here, and an uncaught error would print its path —
		// which may be the very name the scan withholds. Fixed words only, and no `complete=true`, so an upload that
		// requires it doesn't run
		console.log('::error::The secret scan could not finish (a file or directory could not be deleted)');
		process.exit(1);
	}
	const { scanned, removed, masked } = result;
	console.log(
		`[secret-scan] ${scanned} files scanned for ${names.length} secret(s), ${removed.length} removed, ${masked.length} masked`,
	);
	// Every file left is now scanned (and masked) — an upload step requires this
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, 'complete=true\n');
	}
	if (removed.length) {
		console.log(
			'::error::E2E output contained secret values or files that could not be cleared; they were deleted',
		);
		process.exit(1);
	}
}
