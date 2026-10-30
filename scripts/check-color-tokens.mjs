// The colour design tokens in `colors.scss` are only worth minting if something consumes them. The
// first migration pass proved that is not self-enforcing: it moved token *names* and left nine of the
// forty-eight tokens with zero consumers — including every high-contrast companion and the whole
// current-surface contract — because discovery and verification both ran off the same grep for legacy
// names. Anything that grep did not name was invisible at both ends.
//
// This closes that hole from the other direction: it reads the tokens that exist and asks what uses
// them, so an orphan is a build failure rather than something nobody notices for four phases.
//
// A token with no consumer is either premature (mint it when a consumer appears) or evidence that a
// migration stopped at renaming. Both want a person to look. A token that is deliberately ahead of its
// consumers goes in `reserved` below, with a reason — never silently.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tokenSource = 'src/webviews/apps/shared/styles/colors.scss';
const searchRoots = ['src', 'packages'];
const searchExtensions = new Set(['.ts', '.scss', '.css']);
const skipDirectories = new Set(['node_modules', 'dist', 'out', '.git', '__tests__']);

// Tokens allowed to have no consumer yet. Each needs a reason a reviewer can check, so this list
// cannot quietly become the place orphans go to be forgotten.
/** @type {Map<string, string>} */
const reserved = new Map([
	['--gl-color-feedback-info-bg-hover', 'awaiting migration'],
	['--gl-color-feedback-info-quiet-fg', 'awaiting migration'],
	['--gl-color-feedback-info-quiet-border', 'awaiting the HC companion policy'],
	['--gl-color-feedback-warning-bg-hover', 'awaiting migration'],
	['--gl-color-feedback-warning-quiet-border', 'awaiting the HC companion policy'],
	['--gl-color-feedback-danger-bg-hover', 'awaiting migration'],
	['--gl-color-feedback-danger-quiet-border', 'awaiting the HC companion policy'],
	['--gl-color-feedback-success-bg-hover', 'awaiting migration'],
	['--gl-color-feedback-success-quiet-border', 'awaiting the HC companion policy'],
	['--gl-color-action-primary-bg-hover', 'awaiting migration'],
	['--gl-color-action-secondary-bg-hover', 'awaiting migration'],
	['--gl-color-action-quiet-bg-active', 'awaiting migration'],
]);

async function* walk(directory) {
	for (const entry of await readdir(join(repoRoot, directory), { withFileTypes: true })) {
		if (entry.name.startsWith('.') || skipDirectories.has(entry.name)) continue;

		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			yield* walk(path);
		} else if (searchExtensions.has(extname(entry.name))) {
			yield path;
		}
	}
}

async function main() {
	const source = await readFile(join(repoRoot, tokenSource), 'utf8');

	// Declarations at one tab of indentation are the palette; `--_gl-*` privates are implementation.
	const tokens = new Set();
	for (const [, name] of source.matchAll(/^\t(--gl-[a-z0-9-]+)\s*:/gm)) {
		tokens.add(name);
	}
	if (!tokens.size) {
		console.error(`[check-color-tokens] no tokens found in ${tokenSource} — has it moved?`);
		process.exitCode = 1;
		return;
	}

	/** @type {Map<string, number>} */
	const uses = new Map([...tokens].map(name => [name, 0]));
	// `walk` joins with the platform separator, so compare against the same — a `/` literal never matches on Windows
	const tokenSourcePath = join(tokenSource);
	for (const root of searchRoots) {
		for await (const path of walk(root)) {
			if (path === tokenSourcePath) continue;

			const text = await readFile(join(repoRoot, path), 'utf8');
			if (!text.includes('var(--gl-')) continue;

			for (const name of tokens) {
				let index = text.indexOf(`var(${name}`);
				while (index !== -1) {
					// `var(--gl-color-border-raised` must not count a hit on `…-raised-hover`
					const next = text[index + name.length + 4];
					if (next === ')' || next === ',' || next === ' ') uses.set(name, uses.get(name) + 1);
					index = text.indexOf(`var(${name}`, index + 1);
				}
			}
		}
	}

	const orphans = [...uses].filter(([name, count]) => count === 0 && !reserved.has(name));
	const held = [...uses].filter(([name, count]) => count === 0 && reserved.has(name));
	const adopted = [...uses].filter(([, count]) => count > 0);
	const total = adopted.reduce((sum, [, count]) => sum + count, 0);

	console.log(
		`[check-color-tokens] ${tokens.size} tokens, ${adopted.length} adopted (${total} uses), ${held.length} reserved`,
	);
	// Summarised by reason — the per-token list is the file itself, and printing 40-odd lines on every
	// lint run is how output stops being read.
	/** @type {Map<string, number>} */
	const byReason = new Map();
	for (const [name] of held) {
		const reason = reserved.get(name);
		byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
	}
	for (const [reason, count] of byReason) {
		console.log(`[check-color-tokens]   ${count} ${reason}`);
	}

	// A reserved token that now HAS consumers is a stale entry: the migration that adopted it was
	// meant to take it off this list. Left alone, the list stops describing anything and the check
	// quietly loses its teeth, which is the failure mode it exists to prevent.
	const stale = adopted.filter(([name]) => reserved.has(name));
	if (stale.length) {
		console.error(
			`[check-color-tokens] ${stale.length} reserved token(s) are now in use — remove them from \`reserved\`:`,
		);
		for (const [name, count] of stale) {
			console.error(`[check-color-tokens]   ${name} (${count} use${count === 1 ? '' : 's'})`);
		}
		process.exitCode = 1;
	}

	if (orphans.length) {
		console.error(`[check-color-tokens] ${orphans.length} token(s) have no consumer:`);
		for (const [name] of orphans) {
			console.error(`[check-color-tokens]   ${name}`);
		}
		console.error(
			'[check-color-tokens] Either migrate the sites that should use them, or add each to `reserved` in this script with a reason.',
		);
		process.exitCode = 1;
	}
}

await main();
