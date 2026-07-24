import { cemSorterPlugin } from '@wc-toolkit/cem-sorter';

// Rewrites source `.ts` module paths/references to their built `.js` equivalents throughout the manifest.
function rewriteSourceExtToJs(node) {
	if (Array.isArray(node)) {
		for (const item of node) {
			rewriteSourceExtToJs(item);
		}
	} else if (node != null && typeof node === 'object') {
		for (const key of Object.keys(node)) {
			const value = node[key];
			if ((key === 'path' || key === 'module') && typeof value === 'string') {
				node[key] = value.replace(/\.ts$/, '.js');
			} else {
				rewriteSourceExtToJs(value);
			}
		}
	}
}

export default {
	globs: ['src/webviews/apps/**/*.ts'],
	exclude: ['src/webviews/apps/**/*.test.ts'],
	litelement: true,
	packagejson: false,
	plugins: [
		cemSorterPlugin(),
		{
			name: 'rewrite-source-extensions',
			packageLinkPhase({ customElementsManifest }) {
				rewriteSourceExtToJs(customElementsManifest);
			},
		},
	],
};
