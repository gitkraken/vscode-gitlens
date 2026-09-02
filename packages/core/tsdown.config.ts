import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';
import { defineConfig } from 'tsdown';
import { createOutputNamer } from '../../scripts/package/tsdownOutputNames.mjs';
// The single source of truth for which packages core bundles and where each lands inside it.
import { assertPackagesMatchWorkspace, coreRoot, packages, repoRoot, srcDirOf } from './scripts/packages.mjs';

assertPackagesMatchWorkspace();

/** Repo-relative path in POSIX form, which is what rolldown's globs expect. */
function fromCore(absolute: string): string {
	return relative(coreRoot, absolute).replaceAll('\\', '/');
}

// Every module of every bundled package is an entry, not just the ones something imports. `dist/` has to
// mirror the sub-packages module-for-module because the generated `exports` map re-exports each package's
// own patterns — a module that only tree-shaking could drop is still a subpath a consumer may deep-import.
// This is also what keeps both `env/` trees emitted: nothing imports them (`#env/*` stays external), so
// only their presence as entries puts them in `dist/`.
const entry = packages.flatMap(pkg => {
	const src = fromCore(srcDirOf(pkg));
	// `*.ts` also matches `*.d.ts`. A declaration file has no runtime code, so making one an entry emits a
	// stray empty module (`foo.d.js`) beside the real one. None are checked in, but a stale build can leave
	// them in a source tree, and the build must not change shape when one does.
	return [`${src}/**/*.ts`, `!${src}/**/*.d.ts`, `!${src}/**/__tests__/**`];
});

// Where an inlined module's emitted path is rooted: `packages/plus/ai/src/foo.ts` becomes `plus/ai/foo.js`,
// matching the layout the old copy-the-dist-tree bundle step produced and that the generated `exports` map
// addresses. The sub-packages' own manifests resolve `@gitlens/<pkg>` to that same `src/`, so the bundler
// reads SOURCE with no alias needed.
const outputName = createOutputNamer(packages.map(pkg => [srcDirOf(pkg), pkg.dest] as const));

// Anything a consumer installs stays a bare specifier. Derived from the sub-packages' own manifests rather
// than listed here, so a new runtime dependency can never be silently inlined into the published tarball.
const runtimeDependencies: string[] = [
	...new Set(
		packages.flatMap(pkg => {
			const manifest = JSON.parse(readFileSync(join(repoRoot, pkg.srcDir, 'package.json'), 'utf8')) as {
				dependencies?: Record<string, string>;
			};
			return Object.keys(manifest.dependencies ?? {});
		}),
	),
];

// oxlint-disable-next-line import/no-default-export
export default defineConfig({
	entry: entry,
	format: ['esm'],
	// Core is Node-first, but the `#env` split means a browser consumer resolves the other half of utils.
	// `neutral` leaves `node:*` and that split alone instead of resolving either one at bundle time.
	platform: 'neutral',
	// Matches tsconfig.base.json, which every bundled package's build config extends.
	target: 'es2023',
	outDir: 'dist',
	unbundle: false,
	// Absolute, and rooted at the repo: the dts plugin uses this config's own directory as the compiler's
	// `--rootDir`, which has to sit above every bundled source. See the config's header comment.
	dts: { tsconfig: join(repoRoot, 'tsconfig.core-dts.json') },
	sourcemap: true,
	// Only `dist/` is ours; the LICENSEs and the manifest are written afterwards by scripts/bundle.mjs.
	clean: ['dist'],
	// The published exports map is generated from the sub-packages' own maps by scripts/bundle.mjs.
	exports: false,
	// Keep the emitted extensions as .js/.d.ts so the generated exports map's dist/*.js paths keep resolving.
	fixedExtension: false,
	inputOptions: {
		// The sources import each other with the `.js` extension the repo requires, but on disk they are `.ts`.
		resolve: { extensionAlias: { '.js': ['.ts', '.js'] } },
	},
	deps: {
		neverBundle: [
			// `#env/*` MUST survive in the emitted JS: the manifest's `imports` conditions are what pick the
			// node or browser tree at the consumer's resolution time, which is the whole point of the split.
			/^#env\//,
			/^node:/,
			...builtinModules,
			...runtimeDependencies,
		],
	},
	outputOptions: {
		// One emitted file per module, rather than rolldown's default chunking — see the `entry` comment.
		preserveModules: true,
		// `preserveModules` routes every emitted module through `entryFileNames`/`chunkFileNames`, virtual
		// ones included.
		entryFileNames: outputName,
		chunkFileNames: outputName,
	},
});
