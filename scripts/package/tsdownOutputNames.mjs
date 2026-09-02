// Shared by the tsdown config of every package that inlines workspace sources: where an inlined module's
// emitted path is rooted, and what oxc's injected runtime helpers are called.
//
// These packages build in bundled mode with `preserveModules` rather than `unbundle: true`: unbundle is
// transpile-only and can never inline a dependency, which absorbing the unpublished @gitlens/* packages
// requires. With `preserveModules`, rolldown roots every emitted path at the shared filesystem ancestor
// of all modules — `<pkg>/src/…` for anything inlined from a sibling package — and routes each one,
// virtual modules included, through `entryFileNames`/`chunkFileNames`. The namer below puts them where
// the package's exports map (and its verification) expects them instead.

/**
 * @param {ReadonlyArray<readonly [srcDir: string, dest: string]>} roots Absolute source directory of each
 * inlined package and the subpath its modules land under, e.g. `[<repo>/packages/utils/src, 'utils']`
 * @returns {(chunk: { facadeModuleId?: string | null; name: string }) => string}
 */
export function createOutputNamer(roots) {
	// Longest first so `packages/git/src` cannot claim a `packages/git-cli/src` module.
	const prefixed = roots
		.map(([root, dest]) => /** @type {const} */ ([`${root.replaceAll('\\', '/')}/`, dest]))
		.sort((a, b) => b[0].length - a[0].length);

	return chunk => {
		const id = chunk.facadeModuleId?.replaceAll('\\', '/');
		if (id == null) return `${chunk.name}.js`;

		// Virtual modules (oxc's decorator and `using` helpers) are ids, not paths, and carry the runtime's
		// exact version — `\0@oxc-project+runtime@0.147.0/helpers/esm/decorate.js`. Drop it so the emitted
		// path does not churn on every toolchain bump.
		if (id.startsWith('\0')) {
			return `_virtual/${id
				.slice(1)
				.replace(/@\d[^/]*\//, '/')
				.replace(/\.[cm]?js$/, '')}.js`;
		}

		for (const [prefix, dest] of prefixed) {
			if (id.startsWith(prefix)) return `${dest}/${id.slice(prefix.length).replace(/\.[cm]?tsx?$/, '')}.js`;
		}
		return `${chunk.name}.js`;
	};
}
