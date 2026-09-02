import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';
import { createOutputNamer } from '../../../scripts/package/tsdownOutputNames.mjs';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
// Only used for output placement below — the manifests of @gitlens/utils and @gitlens/components
// resolve to these same sources, so tsdown inlines them without an alias.
const utilsSrc = resolve(packageRoot, '..', '..', 'utils', 'src');
const componentsSrc = resolve(packageRoot, '..', '..', 'components', 'src');

const outputName = createOutputNamer([
	[utilsSrc, 'utils'],
	[componentsSrc, 'components'],
]);

// Bundled mode + `preserveModules` rather than `unbundle: true` — see scripts/package/tsdownOutputNames.mjs
// for the rationale (both published Commit Graph packages build this way).
// oxlint-disable-next-line import/no-default-export
export default defineConfig({
	entry: ['src/**/*.ts', '!src/**/__tests__/**'],
	format: ['esm'],
	platform: 'browser',
	// Matches the package's own tsconfig, which does not extend tsconfig.base.json (es2023).
	target: 'es2022',
	outDir: 'dist',
	unbundle: false,
	dts: { tsconfig: 'tsconfig.build.json' },
	sourcemap: true,
	clean: true,
	// The published exports map is a hand-written public contract — tsdown must not regenerate it.
	exports: false,
	// Keep the emitted extensions as .js/.d.ts so the exports map's dist/*.js paths keep resolving.
	fixedExtension: false,
	inputOptions: {
		// The sources import each other with the `.js` extension the repo requires, but on disk they
		// are `.ts`.
		resolve: { extensionAlias: { '.js': ['.ts', '.js'] } },
	},
	deps: {
		// Everything a consumer installs stays a bare specifier; only the unpublished @gitlens/* packages
		// are absorbed.
		neverBundle: [
			/^@gitkraken\/commit-graph(\/|$)/,
			/^lit(-html|-element)?(\/|$)/,
			/^@lit(-labs)?\//,
			/^@awesome\.me\//,
			'fast-string-truncated-width',
			'vscode-uri',
		],
	},
	outputOptions: {
		preserveModules: true,
		preserveModulesRoot: 'src',
		// `preserveModules` routes every emitted module through `entryFileNames`/`chunkFileNames`,
		// virtual ones included.
		entryFileNames: outputName,
		chunkFileNames: outputName,
	},
	copy: [
		{ from: '../../../LICENSE', to: '.' },
		{ from: '../../../LICENSE.plus', to: '.' },
	],
});
