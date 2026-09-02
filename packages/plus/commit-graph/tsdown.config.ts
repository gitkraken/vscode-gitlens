import { defineConfig } from 'tsdown';

// Bundled mode + `preserveModules` rather than `unbundle: true` — see scripts/package/tsdownOutputNames.mjs
// for the rationale (both published Commit Graph packages build this way).
// oxlint-disable-next-line import/no-default-export
export default defineConfig({
	entry: ['src/**/*.ts', '!src/**/__tests__/**'],
	format: ['esm'],
	platform: 'neutral',
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
	outputOptions: { preserveModules: true, preserveModulesRoot: 'src' },
	copy: [
		{ from: 'src/theme.css', to: 'dist' },
		{ from: '../../../LICENSE', to: '.' },
		{ from: '../../../LICENSE.plus', to: '.' },
	],
});
