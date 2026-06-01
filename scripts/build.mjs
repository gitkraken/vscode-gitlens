#!/usr/bin/env node
import { spawn } from 'child_process';
import { parseArgs } from 'node:util';

// Parse arguments
const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		mode: { type: 'string', default: 'development' }, // development | production | none
		build: { type: 'string', default: undefined, multiple: true }, // (extension | webviews)[]
		debug: { type: 'boolean', default: false },
		target: { type: 'string', default: undefined, multiple: true }, // (node | webworker)[]
		quick: { type: 'boolean', default: false }, // skip type-checking, linting, docs, and asset generation
		trace: { type: 'boolean', default: false },
		webview: { type: 'string', default: undefined, multiple: true },
		watch: { type: 'boolean', default: false },
	},
});

/** @type {{ mode: 'production' | 'development' | 'none' | undefined; build: ('extension' | 'webviews' | 'unit-tests')[] | undefined; debug: boolean; target: ('node' | 'webworker')[] | undefined; quick: boolean; trace: boolean; webview: string[] | undefined; watch: boolean }} */
const { mode, build, debug, target, quick, trace, webview: webviews, watch } = values;

const env = {
	...process.env,
	...(debug ? { DEBUG: '1' } : {}),
	NODE_FORCE_COLORS: '1',
	FORCE_COLOR: '1',
};

// Build webpack command
let cmd = `webpack`;
if (watch) {
	cmd += ' --watch';
}
cmd += ` --mode ${mode}`;
if (build?.length || webviews?.length) {
	if (build?.includes('extension')) {
		if (target?.length) {
			target.forEach(t => {
				cmd += ` --config-name extension:${t}`;
			});
		} else {
			cmd += ` --config-name extension:node --config-name extension:webworker`;
		}
	}

	if (build?.includes('webviews') || webviews?.length) {
		cmd += ` --config-name webviews:common`;

		if (webviews?.length === 1) {
			cmd += ` --config-name webviews:${webviews[0]}`;
		} else {
			cmd += ` --config-name webviews`;
		}

		if (webviews?.length) {
			cmd += ` --env webviews=${webviews.join(',')}`;
		}
	}

	if (build?.includes('unit-tests')) {
		cmd += ` --config-name unit-tests`;
	}
} else if (target?.length) {
	target.forEach(t => {
		cmd += ` --config-name extension:${t}`;
	});

	cmd += ` --config-name webviews:common`;

	if (webviews?.length === 1) {
		cmd += ` --config-name webviews:${webviews[0]}`;
	} else {
		cmd += ` --config-name webviews`;
	}

	if (webviews?.length) {
		cmd += ` --env webviews=${webviews.join(',')}`;
	}
}

if (quick) {
	cmd += ` --env quick`;
}

if (trace) {
	cmd += ` --env trace`;
}

if (build?.includes('unit-tests')) {
	const buildPkgsCmd = `pnpm run build:packages`;
	console.log(`Running: ${buildPkgsCmd}`);

	const pkgsCode = await new Promise(resolve => {
		const pkgs = spawn(buildPkgsCmd, [], {
			shell: true,
			stdio: 'inherit',
			env: env,
		});

		pkgs.on('exit', code => resolve(code || 0));
	});

	if (pkgsCode !== 0) {
		process.exit(pkgsCode);
	}
}

// A "full" build targets no specific config (the default `pnpm run build`) — these are the ones
// we split across processes below.
const isFullBuild = !build?.length && !target?.length && !webviews?.length;

if (!quick && !watch) {
	const prettyCmd = process.env.CI ? `pnpm run pretty:check` : `pnpm run pretty`;
	console.log(`Running: ${prettyCmd}`);

	const prettyCode = await new Promise(resolve => {
		const pretty = spawn(prettyCmd, [], {
			shell: true,
			stdio: 'inherit',
			env: {
				...process.env,
				NODE_FORCE_COLORS: '1',
				FORCE_COLOR: '1',
			},
		});

		pretty.on('exit', code => resolve(code || 0));
	});

	if (prettyCode !== 0) {
		process.exit(prettyCode);
	}
}

/** @param {string} command @returns {Promise<number>} exit code (always resolves; never rejects) */
function run(command) {
	console.log(`Running: ${command}`);
	const child = spawn(command, [], { shell: true, stdio: 'inherit', env: env });
	return new Promise(resolve => {
		child.on('exit', code => resolve(code || 0));
		// Spawn failures emit 'error' without 'exit' — resolve as failure so the batch never hangs.
		child.on('error', () => resolve(1));
	});
}

// For one-shot full builds, split the 6-config webpack MultiCompiler (which shares a single Node
// event loop, leaving most cores idle) into parallel webpack processes — one per bucket — so the
// CPU-bound work (module-graph build, codegen, source maps) spreads across cores. Buckets keep
// configs that share in-process state together (webviews:common + webviews). Watch and targeted
// builds keep the single-process path.
let bundleCmds;
if (isFullBuild && !watch) {
	let baseCmd = `webpack --mode ${mode}`;
	if (quick) {
		baseCmd += ` --env quick`;
	}
	if (trace) {
		baseCmd += ` --env trace`;
	}

	bundleCmds = [
		`${baseCmd} --config-name extension:node`,
		`${baseCmd} --config-name extension:webworker`,
		// `common` is pure codegen (empty entry; Docs/Licenses/Fantasticon/contributions all run as
		// blocking spawnSync) — isolate it so that blocking work gets its own core instead of stalling
		// a bundling process's event loop.
		`${baseCmd} --config-name common`,
		// Keep webviews:common + webviews in one process (CompileComposerTemplatesPlugin shares state).
		`${baseCmd} --config-name webviews:common --config-name webviews --config-name unit-tests`,
	];
} else {
	bundleCmds = [cmd];
}

// Run the bundle process(es) and, for one-shot builds, a single whole-project oxlint (lint +
// type-check) pass concurrently. tsgo-backed type checking and Rust-native linting both run inside
// oxlint, so it replaces the old ForkTsChecker + ESLint plugins. Watch builds lint incrementally via
// the inline OxLintWebpackPlugin (added whenever not in quick mode), so they skip this standalone pass.
const tasks = bundleCmds.map(c => run(c));
if (!quick && !watch) {
	tasks.push(run(`oxlint --type-aware --type-check`));
}

// allSettled (not all) so a failure in one process never abandons the others mid-flight — every
// bundle process runs to completion, then we fail the build with the first non-zero exit code.
const results = await Promise.allSettled(tasks);
const codes = results.map(result => (result.status === 'fulfilled' ? result.value : 1));
const failed = codes.find(code => code !== 0) ?? 0;

// With multiple bundle processes, each prints its own per-process status; emit one aggregate line.
if (bundleCmds.length > 1) {
	console.log(failed ? '[build] Compiled with problems' : '[build] Compiled successfully');
}

process.exit(failed);
