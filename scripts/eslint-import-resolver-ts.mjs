// @ts-check
/**
 * Custom ESLint import resolver that wraps eslint-import-resolver-typescript
 * and transforms resolved .ts/.tsx paths to .js/.jsx for TypeScript ESM compatibility.
 *
 * This ensures the import-x/extensions rule's auto-fix adds .js instead of .ts.
 */

import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';

/**
 * Maps TypeScript extensions to their JavaScript equivalents
 * @type {Record<string, string>}
 */
const extensionMap = {
	'.ts': '.js',
	'.tsx': '.jsx',
	'.mts': '.mjs',
	'.cts': '.cjs',
};

/**
 * Creates a TypeScript ESM-aware import resolver.
 * Wraps the TypeScript resolver and transforms resolved paths so that
 * .ts/.tsx files appear as .js/.jsx to ESLint rules.
 *
 * @param {Parameters<typeof createTypeScriptImportResolver>[0]} [options]
 * @returns {ReturnType<typeof createTypeScriptImportResolver>}
 */
export function createCustomTypeScriptImportResolver(options) {
	const baseResolver = createTypeScriptImportResolver(options);

	return {
		...baseResolver,
		resolve(specifier, file) {
			const result = baseResolver.resolve(specifier, file);
			if (!result.found || !result.path) return result;

			// Transform .ts/.tsx extensions to .js/.jsx
			for (const [tsExt, jsExt] of Object.entries(extensionMap)) {
				if (result.path.endsWith(tsExt)) {
					return { ...result, path: result.path.slice(0, -tsExt.length) + jsExt };
				}
			}

			return result;
		},
	};
}
