#!/usr/bin/env node
import { spawn } from 'child_process';
import { parseArgs } from 'node:util';

// Parse arguments
const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		mode: { type: 'string', default: 'development' }, // development | production | none
		build: { type: 'string', default: undefined, multiple: true }, // (extension | webviews)[]
		target: { type: 'string', default: undefined, multiple: true }, // (node | webworker)[]
		quick: { type: 'string', default: undefined }, // true | turbo
		webview: { type: 'string', default: undefined, multiple: true },
		watch: { type: 'boolean', default: false },
	},
});

/** @type {{ mode: 'production' | 'development' | 'none' | undefined; build: ('extension' | 'webviews')[] | undefined; target: ('node' | 'webworker')[] | undefined; quick: 'true' | 'turbo' | undefined; webview: string[] | undefined; watch: boolean }} */
const { mode, build, target, quick, webview: webviews, watch } = values;

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
}

if (quick) {
	cmd += ` --env quick=${quick}`;
}

console.log(`Running: ${cmd}`);

const child = spawn(cmd, [], {
	shell: true,
	stdio: 'inherit',
	env: {
		...process.env,
		NODE_FORCE_COLORS: '1',
		FORCE_COLOR: '1',
	},
});

child.on('exit', code => {
	process.exit(code || 0);
});
