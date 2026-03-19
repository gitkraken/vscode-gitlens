#!/usr/bin/env node
import { spawn, spawnSync } from 'child_process';
import { parseArgs } from 'node:util';

// Parse arguments
const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		mode: { type: 'string', default: 'development' }, // development | production | none
		build: { type: 'string', default: undefined, multiple: true }, // (extension | webviews)[]
		debug: { type: 'boolean', default: false },
		target: { type: 'string', default: undefined, multiple: true }, // (node | webworker)[]
		quick: { type: 'string', default: undefined }, // true | turbo
		trace: { type: 'boolean', default: false },
		webview: { type: 'string', default: undefined, multiple: true },
		watch: { type: 'boolean', default: false },
	},
});

/** @type {{ mode: 'production' | 'development' | 'none' | undefined; build: ('extension' | 'webviews' | 'unit-tests')[] | undefined; debug: boolean; target: ('node' | 'webworker')[] | undefined; quick: 'true' | 'turbo' | undefined; trace: boolean; webview: string[] | undefined; watch: boolean }} */
const { mode, build, debug, target, quick, trace, webview: webviews, watch } = values;

const env = {
	...process.env,
	...(debug ? { DEBUG: '1' } : {}),
	NODE_FORCE_COLORS: '1',
	FORCE_COLOR: '1',
};

// Build library packages (tsc -b) before running webpack
// Webpack aliases resolve to packages/*/src (source), but ForkTsCheckerPlugin resolves
// to packages/*/dist (declarations) via tsconfig paths — so .d.ts files must exist first.
// Only webview-only builds can skip this since they don't depend on the library packages directly.
const tscProjects = 'packages/utils packages/git packages/git-cli packages/git-github';
const webviewsOnly = build?.length === 1 && build[0] === 'webviews';
if (!webviewsOnly) {
	// Always run an initial synchronous build to ensure .d.ts files exist before webpack starts
	const tscBuildCmd = `tsc -b ${tscProjects}`;
	console.log(`Running: ${tscBuildCmd}`);
	const result = spawnSync(tscBuildCmd, [], { shell: true, stdio: 'inherit', env: env });
	if (result.status !== 0) {
		process.exit(result.status || 1);
	}

	// In watch mode, also start tsc --watch for incremental rebuilds alongside webpack
	if (watch) {
		const tscWatchCmd = `tsc -b ${tscProjects} --watch --preserveWatchOutput`;
		console.log(`Running: ${tscWatchCmd} (background)`);
		spawn(tscWatchCmd, [], { shell: true, stdio: 'inherit', env: env });
	}
}

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
	cmd += ` --env quick=${quick}`;
}

if (trace) {
	cmd += ` --env trace`;
}

console.log(`Running: ${cmd}`);

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

const child = spawn(cmd, [], {
	shell: true,
	stdio: 'inherit',
	env: env,
});

child.on('exit', code => {
	process.exit(code || 0);
});
