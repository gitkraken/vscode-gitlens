// Bundle the consumer with esbuild, then run it.
//
// @gitlens/integrations depends on @gitkraken/provider-apis — a CJS module whose
// getter-based named exports only resolve through a real bundler (webpack/esbuild),
// which is how every actual consumer (the GitLens host, and Kepler via
// @gitkraken/core-gitlens) builds it. Running the raw .js under Node would hit
// Node's CJS named-import limitation, so this fixture bundles first to reproduce a
// realistic consumer build. (The type-level boundary is checked separately by
// `tsc --noEmit` in the `test` script.)

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
	logLevel: 'warning',
});

execFileSync(process.execPath, [outfile], { stdio: 'inherit', cwd: root });
