// Bundle the package's unit tests with esbuild, then run them under mocha.
//
// Why bundle instead of `mocha --require tsx` like the sibling packages? This
// package depends on `@gitkraken/provider-apis`, a CJS module that ships
// `__esModule: true` with getter-based named exports AND a `default` export.
// Per-file transpilers (tsx) and Node's CJS lexer can't see those getter
// exports, so named imports resolve to `undefined` at runtime. A real bundler
// (esbuild — same as webpack, which is how the GitLens host and the
// @gitkraken/core-gitlens consumer build) analyzes the CJS module and binds
// the named exports correctly. Bundling the tests reproduces the production
// resolution so the tests exercise the same code paths consumers will.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(dirname(dirname(packageRoot)));
const outDir = join(packageRoot, 'out');

await esbuild.build({
	absWorkingDir: packageRoot,
	entryPoints: ['src/**/__tests__/**/*.test.ts'],
	outbase: 'src',
	outdir: outDir,
	outExtension: { '.js': '.cjs' },
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node22',
	sourcemap: 'inline',
	// mocha + node built-ins stay external; everything else (incl.
	// @gitkraken/provider-apis and the @gitlens/* workspace deps) is inlined so
	// the CJS-from-ESM named imports resolve exactly as they do under webpack.
	external: ['mocha'],
	logLevel: 'warning',
});

const mocha = createRequire(import.meta.url).resolve('mocha/bin/mocha.js');
execFileSync(process.execPath, [mocha, '--ui', 'tdd', '--timeout', '30000', `${outDir}/**/__tests__/**/*.test.cjs`], {
	stdio: 'inherit',
	cwd: packageRoot,
});

// Keep the package's external-consumer boundary test in the standard integrations test flow so
// `pnpm run test:packages` catches public-facade regressions too.
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
execFileSync(pnpm, ['--filter', '@gitlens/integrations-consumer-fixture', 'test'], {
	stdio: 'inherit',
	cwd: workspaceRoot,
});

// Smoke-test the published ESM facade directly under Node too. Bundled tests/fixtures can mask CommonJS named
// export regressions in transitive deps, but direct consumers of the package import the built entrypoint.
await import(new URL('../dist/lite.js', import.meta.url));
