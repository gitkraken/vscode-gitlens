#!/usr/bin/env node
/**
 * Launches a real, interactive VS Code Extension Development Host running the
 * GitLens build from a chosen worktree — so you can see that worktree's code
 * live. Unlike scripts/e2e-dev-inspect.mjs (which spins up a separate, headless
 * Electron instance under Xvfb for Playwright to drive), this drives your
 * ALREADY-RUNNING desktop VS Code via the remote CLI, so it works over
 * Remote-WSL and Remote-SSH: the new window opens on your desktop, connected to
 * the remote, with the dev extension host loaded in the remote.
 *
 * It does the same thing as the "Run" config in .vscode/launch.json
 * (--extensionDevelopmentPath + the "Debugging (GitLens)" profile), just
 * triggerable from any terminal — or a Claude Code session.
 *
 * Usage:
 *   pnpm run dev:launch <worktree> [folder-to-open] [options]
 *   node scripts/dev-launch.mjs <worktree> [folder-to-open] [options]
 *
 * <worktree> is matched against `git worktree list` — pass a branch name, a
 * path, or any distinctive substring (e.g. "graph-wip-discard"). If the query
 * matches several, you get a picker. If omitted, the worktree you're currently
 * in is used. Use --list to pick from all worktrees.
 *
 * [folder-to-open] is the workspace the dev host opens (default: the worktree
 * itself, so GitLens runs against that branch's repo).
 *
 * Options:
 *   -l, --list            Pick a worktree interactively (plain list when non-TTY)
 *   -b, --build[=target]  Build before launching (default: skip — assumes a
 *                         fresh dist/, e.g. from a running `pnpm watch`).
 *                         --build → build:quick (extension + webviews)
 *                         --build=extension → build:extension only (faster)
 *       --build-cmd=<cmd> Custom build command to run in the worktree
 *       --force           Launch even if dist/ looks unbuilt
 *       --profile=<name>  VS Code profile (default: "Debugging (GitLens)")
 *       --sandbox         Use a fresh throwaway profile (--profile-temp)
 *       --reuse           Reuse the active window instead of opening a new one
 *       --web             Run as a web extension (--extensionDevelopmentKind=web)
 *       --code=<bin>      VS Code CLI to use (default: $GL_CODE_BIN, then
 *                         code-insiders / code on PATH)
 *   -n, --dry-run         Print the command without launching
 *   -h, --help            Show this help
 *
 * Examples:
 *   pnpm run dev:launch graph-wip-discard
 *   pnpm run dev:launch feature/new-graph --build
 *   pnpm run dev:launch debug ~/code/some-other-repo --sandbox
 *   pnpm run dev:launch --list
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const buildScripts = {
	quick: 'build:quick',
	extension: 'build:extension',
	full: 'build',
};

function parseArgs(argv) {
	const opts = {
		worktree: undefined,
		open: undefined,
		list: false,
		build: undefined, // undefined = skip; otherwise a pnpm script name
		buildCmd: undefined,
		force: false,
		profile: 'Debugging (GitLens)',
		sandbox: false,
		reuse: false,
		web: false,
		code: process.env.GL_CODE_BIN || undefined,
		dryRun: false,
	};
	const positionals = [];

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '-h' || arg === '--help') {
			printHelp();
			process.exit(0);
		} else if (arg === '-l' || arg === '--list') {
			opts.list = true;
		} else if (arg === '-b' || arg === '--build') {
			opts.build = buildScripts.quick;
		} else if (arg.startsWith('--build=')) {
			const target = arg.slice('--build='.length);
			const script = buildScripts[target];
			if (script == null) {
				fail(`Unknown --build target "${target}". Use one of: ${Object.keys(buildScripts).join(', ')}`);
			}
			opts.build = script;
		} else if (arg.startsWith('--build-cmd=')) {
			opts.buildCmd = arg.slice('--build-cmd='.length);
		} else if (arg === '--force') {
			opts.force = true;
		} else if (arg.startsWith('--profile=')) {
			opts.profile = arg.slice('--profile='.length);
		} else if (arg === '--sandbox') {
			opts.sandbox = true;
		} else if (arg === '--reuse') {
			opts.reuse = true;
		} else if (arg === '--web') {
			opts.web = true;
		} else if (arg.startsWith('--code=')) {
			opts.code = arg.slice('--code='.length);
		} else if (arg === '-n' || arg === '--dry-run') {
			opts.dryRun = true;
		} else if (arg.startsWith('-')) {
			fail(`Unknown option: ${arg}`);
		} else {
			positionals.push(arg);
		}
	}

	opts.worktree = positionals[0];
	opts.open = positionals[1];
	if (opts.buildCmd != null) opts.build = opts.build ?? 'custom';
	return opts;
}

function fail(message) {
	console.error(`✖ ${message}`);
	process.exit(1);
}

function printHelp() {
	// The usage block lives in the file header; surface the gist here.
	console.log(
		[
			'Launch a VS Code Extension Development Host for a worktree (remote-aware).',
			'',
			'  pnpm run dev:launch <worktree> [folder-to-open] [options]',
			'',
			'  -l, --list            Pick a worktree (plain list when non-TTY)',
			'  -b, --build[=target]  Build first (quick|extension|full); default: skip',
			'      --profile=<name>  VS Code profile (default: "Debugging (GitLens)")',
			'      --sandbox         Fresh throwaway profile (--profile-temp)',
			'      --reuse           Reuse active window',
			'      --web             Run as web extension host',
			'      --code=<bin>      VS Code CLI override ($GL_CODE_BIN)',
			'  -n, --dry-run         Print the command without launching',
			'',
			'See the header of scripts/dev-launch.mjs for full docs.',
		].join('\n'),
	);
}

/** Parses `git worktree list --porcelain` into [{ path, branch }]. */
function listWorktrees() {
	let out;
	try {
		out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
	} catch (e) {
		fail(`Failed to list worktrees: ${e.message}`);
	}

	const worktrees = [];
	let current;
	for (const line of out.split('\n')) {
		if (line.startsWith('worktree ')) {
			current = { path: line.slice('worktree '.length), branch: undefined };
			worktrees.push(current);
		} else if (line.startsWith('branch ') && current != null) {
			current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
		} else if (line === 'detached' && current != null) {
			current.branch = '(detached)';
		}
	}
	return worktrees;
}

/** Finds worktrees matching a name/branch/path/substring query (best tier first). */
function findCandidates(query, worktrees) {
	// An existing directory wins outright (covers "." → the current worktree).
	const asPath = path.resolve(process.cwd(), query);
	if (existsSync(asPath)) return [{ path: asPath, branch: undefined }];

	const basename = p => path.basename(p);

	// Exact branch or path-basename match takes precedence over substrings.
	const exact = worktrees.filter(w => w.branch === query || basename(w.path) === query);
	if (exact.length > 0) return exact;

	// Substring match across branch + path.
	return worktrees.filter(w => (w.branch ?? '').includes(query) || w.path.includes(query));
}

function ambiguous(query, matches) {
	console.error(`✖ "${query}" matches ${matches.length} worktrees — be more specific:`);
	for (const w of matches) console.error(`    ${(w.branch ?? '(detached)').padEnd(48)} ${w.path}`);
	process.exit(1);
}

const isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

function hasBin(name) {
	const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
	return dirs.some(dir => existsSync(path.join(dir, name)));
}

const worktreeLabel = w => `${(w.branch ?? '(detached)').padEnd(50)} ${w.path}`;

function printWorktrees(worktrees) {
	console.log(`Worktrees (${worktrees.length}):\n`);
	for (const w of worktrees) console.log(`  ${worktreeLabel(w)}`);
	console.log('\nLaunch one with:  pnpm run dev:launch <name-or-substring>');
}

/**
 * Interactive worktree picker. Uses fzf when available, otherwise a readline
 * filter prompt. Returns the chosen worktree, or null if cancelled.
 * Caller must ensure isInteractive() first.
 */
async function pickWorktree(worktrees, header) {
	if (hasBin('fzf')) {
		const picked = pickWithFzf(worktrees, header);
		// undefined = fzf couldn't run; fall through to the readline picker.
		if (picked !== undefined) return picked;
	}
	return pickWithReadline(worktrees, header);
}

function pickWithFzf(worktrees, header) {
	// Each label is unique (it ends in the worktree path), so we map the selected
	// line straight back to its worktree — fzf prints the original input line on
	// selection, so no field/index parsing is needed.
	const byLabel = new Map(worktrees.map(w => [worktreeLabel(w), w]));
	const input = [...byLabel.keys()].join('\n');
	const res = spawnSync('fzf', ['--reverse', '--height=80%', '--prompt=worktree> ', `--header=${header}`], {
		input: input,
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'inherit'],
	});
	if (res.status === 130) return null; // Esc / Ctrl-C
	if (res.status !== 0 || res.error != null) return undefined; // fzf unusable → fall back
	const line = res.stdout.trim();
	if (line === '') return null;
	return byLabel.get(line) ?? null;
}

async function pickWithReadline(worktrees, header) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const ask = q => new Promise(resolve => rl.question(q, resolve));
	const pageSize = 40;
	try {
		let pool = worktrees;
		for (;;) {
			console.log(`\n${header}`);
			const shown = pool.slice(0, pageSize);
			shown.forEach((w, i) => console.log(`  ${String(i + 1).padStart(3)})  ${worktreeLabel(w)}`));
			if (pool.length > shown.length) {
				console.log(`  … and ${pool.length - shown.length} more — type to filter`);
			}
			const answer = (await ask('\nNumber to select, text to filter, or blank to cancel: ')).trim();
			if (answer === '') return null;
			if (/^\d+$/.test(answer)) {
				const n = Number(answer);
				if (n >= 1 && n <= shown.length) return shown[n - 1];
				console.log('  Out of range.');
				continue;
			}
			const q = answer.toLowerCase();
			const filtered = worktrees.filter(w => worktreeLabel(w).toLowerCase().includes(q));
			if (filtered.length === 0) {
				console.log(`  No match for "${answer}".`);
				continue;
			}
			if (filtered.length === 1) return filtered[0];
			pool = filtered;
		}
	} finally {
		rl.close();
	}
}

/**
 * Best-effort detection of the VS Code variant running THIS session ('insiders' | 'stable' | undefined).
 * Over Remote-WSL the running variant injects its remote-cli dir onto PATH; on the desktop the Windows
 * app dir / remote-wsl ext path carry the variant name.
 */
function detectSessionVariant() {
	const pathEnv = process.env.PATH ?? '';
	if (pathEnv.includes('.vscode-server-insiders/')) return 'insiders';
	const hints = [process.env.VSCODE_CWD, process.env.VSCODE_WSL_EXT_LOCATION, process.env.VSCODE_GIT_ASKPASS_MAIN]
		.filter(Boolean)
		.join('\n');
	if (/insiders/i.test(hints)) return 'insiders';
	if (pathEnv.includes('.vscode-server/') || /Microsoft VS Code(?! Insiders)/.test(hints)) return 'stable';
	return undefined;
}

/**
 * Picks the VS Code CLI: explicit override, else the launcher for the variant OPPOSITE the one running
 * this session. Launching the opposite (not-running) variant is what makes `--extensionDevelopmentPath`
 * stick: the running variant — or its WSL remote-cli, which can only forward to the live instance —
 * reuses that instance and silently drops the dev-host flag ("Ignoring option 'extensionDevelopmentPath'"),
 * whereas a cold-started variant honors it. Falls back to the original code-insiders→code order when the
 * session variant can't be determined.
 */
function resolveCodeBin(explicit) {
	if (explicit != null) return explicit;
	const variant = detectSessionVariant();
	const order = variant === 'insiders' ? ['code', 'code-insiders'] : ['code-insiders', 'code'];
	const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
	for (const candidate of order) {
		if (dirs.some(dir => existsSync(path.join(dir, candidate)))) return candidate;
	}
	// Fall back to the last preference; spawning will surface a clear ENOENT if truly missing.
	return order[order.length - 1];
}

/** The worktree containing cwd (falls back to the main repo). */
function currentWorktree(worktrees) {
	const cwd = realpathSync(process.cwd());
	const match = worktrees.find(w => {
		const wp = realpathSync(w.path);
		return cwd === wp || cwd.startsWith(`${wp}${path.sep}`);
	});
	return (
		match ??
		worktrees.find(w => realpathSync(w.path) === realpathSync(repoRoot)) ?? { path: repoRoot, branch: undefined }
	);
}

async function main() {
	const opts = parseArgs(process.argv);
	const worktrees = listWorktrees();

	// Choose the target worktree:
	//   --list           → interactive picker (plain list when non-TTY)
	//   no arg           → the worktree you're currently in
	//   <query> (unique) → that worktree
	//   <query> (many)   → picker over the matches (or an error list when non-TTY)
	let chosen;
	if (opts.list) {
		if (!isInteractive()) {
			printWorktrees(worktrees);
			return;
		}
		chosen = await pickWorktree(worktrees, 'Select a worktree to launch');
	} else if (opts.worktree == null) {
		chosen = currentWorktree(worktrees);
	} else {
		const candidates = findCandidates(opts.worktree, worktrees);
		if (candidates.length === 0) {
			fail(`No worktree matches "${opts.worktree}". Run with --list to pick from the list.`);
		} else if (candidates.length === 1) {
			chosen = candidates[0];
		} else if (isInteractive()) {
			chosen = await pickWorktree(candidates, `Multiple worktrees match "${opts.worktree}" — pick one`);
		} else {
			ambiguous(opts.worktree, candidates);
		}
	}
	if (chosen == null) {
		console.log('Cancelled.');
		return;
	}

	const worktree = realpathSync(chosen.path);
	const openTarget = opts.open != null ? path.resolve(process.cwd(), opts.open) : worktree;

	// Build (opt-in) — install deps first if missing, since a never-installed
	// worktree can't build.
	if (opts.build != null) {
		if (!existsSync(path.join(worktree, 'node_modules'))) {
			console.log(`→ node_modules missing in ${worktree} — running pnpm install...`);
			run('pnpm', ['install'], worktree, opts.dryRun);
		}
		if (opts.buildCmd != null) {
			console.log(`→ Building: ${opts.buildCmd}`);
			run('sh', ['-c', opts.buildCmd], worktree, opts.dryRun);
		} else {
			console.log(`→ Building: pnpm run ${opts.build}`);
			run('pnpm', ['run', opts.build], worktree, opts.dryRun);
		}
	}

	// Sanity-check that something is actually built, or the dev host loads nothing.
	const entry = opts.web ? 'dist/browser/gitlens.js' : 'dist/gitlens.js';
	if (!opts.dryRun && opts.build == null && !existsSync(path.join(worktree, entry))) {
		if (!opts.force) {
			fail(
				`${entry} not found in the target worktree — it isn't built.\n` +
					`  Pass --build to build it now, run a watch in that worktree, or --force to launch anyway.`,
			);
		}
		console.warn(`⚠ ${entry} not found — launching anyway (--force).`);
	}

	// Remote sanity: this only reaches your desktop VS Code from inside a VS Code
	// session (integrated terminal / remote). Warn if we're not in one.
	if (!opts.dryRun && process.env.VSCODE_IPC_HOOK_CLI == null && process.env.VSCODE_GIT_IPC_HANDLE == null) {
		console.warn(
			'⚠ Not inside a VS Code session (no VSCODE_IPC_HOOK_CLI). The CLI may not reach your\n' +
				'  desktop VS Code over Remote-WSL/SSH. Run this from a VS Code integrated terminal.',
		);
	}

	const codeBin = resolveCodeBin(opts.code);
	const codeArgs = [opts.reuse ? '--reuse-window' : '--new-window', `--extensionDevelopmentPath=${worktree}`];
	if (opts.web) codeArgs.push('--extensionDevelopmentKind=web');
	codeArgs.push(opts.sandbox ? '--profile-temp' : `--profile=${opts.profile}`);
	codeArgs.push(openTarget);

	console.log(`\n→ ${path.basename(worktree)}  (${worktree})`);
	console.log(`  ${codeBin} ${codeArgs.map(a => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}\n`);

	if (opts.dryRun) {
		console.log('(dry run — not launched)');
		return;
	}

	try {
		// The remote CLI dispatches over IPC and returns immediately; the window
		// lives in your desktop VS Code, independent of this process.
		execFileSync(codeBin, codeArgs, { stdio: 'inherit' });
	} catch (e) {
		if (e.code === 'ENOENT') {
			fail(`VS Code CLI "${codeBin}" not found on PATH. Set $GL_CODE_BIN or pass --code=<bin>.`);
		}
		fail(`Launch failed: ${e.message}`);
	}
	console.log('✓ Launched. The dev host opens in your desktop VS Code (connected to the remote).');
}

function run(cmd, args, cwd, dryRun) {
	if (dryRun) {
		console.log(`  (dry run) ${cmd} ${args.join(' ')}  [cwd: ${cwd}]`);
		return;
	}
	execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

main().catch(e => {
	console.error(`✖ ${e?.message ?? e}`);
	process.exit(1);
});
