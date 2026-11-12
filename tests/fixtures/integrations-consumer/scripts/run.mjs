// Bundle the consumer with esbuild, then run it.
//
// A real bundler (webpack/esbuild) is how the GitLens host and Kepler build Core,
// so this fixture bundles first to reproduce a realistic consumer build. (The
// type-level boundary is checked separately by `tsc --noEmit` in the `test` script.)

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outfile = join(root, 'dist', 'consumer.test.mjs');

await esbuild.build({
	absWorkingDir: root,
	entryPoints: ['src/consumer.test.ts'],
	outfile: outfile,
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node22',
	// Bundled CommonJS dependencies (including @vscode/l10n) load Node built-ins with require.
	// ESM has no ambient require; supply the normal Node bridge without externalizing dependencies.
	banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
	logLevel: 'warning',
});

execFileSync(process.execPath, [outfile], { stdio: 'inherit', cwd: root });
