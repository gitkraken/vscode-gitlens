import { createRequire } from 'node:module';
import postcss from 'postcss';

const require = createRequire(import.meta.url);

/**
 * The one CSS minification contract for the whole build.
 *
 * CSS reaches the bundle two ways — `*.css`/`*.scss` files, which `CssMinimizerPlugin` minifies, and
 * the CSS inside `` css`…` `` tagged templates, which it never sees. Both go through this preset so a
 * declaration is treated the same wherever it was written, and so a fix aimed at one (the nested
 * `calc()` tokenizer limit, say) can't silently apply to only half the styles.
 */
export const cssnanoPresetPath = require.resolve('cssnano-preset-advanced');

export const cssnanoPresetOptions = {
	autoprefixer: false,
	discardUnused: false,
	mergeIdents: false,
	reduceIdents: false,
	zindex: false,
};

/**
 * A postcss processor running that preset, for callers that minify CSS themselves rather than through
 * `CssMinimizerPlugin`. Async: the preset includes async plugins, so `.then()`/`await` the result —
 * reading `.css` synchronously throws.
 */
export function createCssProcessor() {
	const { plugins } = require(cssnanoPresetPath)(cssnanoPresetOptions);
	return postcss(
		plugins
			// The preset hands back every plugin it knows about and merely *marks* the ones the options
			// above turned off — only cssnano's own runner reads that mark. Drop them here, or the options
			// are silently ignored and this diverges from what `CssMinimizerPlugin` does to the `*.css`
			// files: `reduceIdents` would rename `@keyframes` out from under the JS that compares
			// `animationName`, and `discardUnused` would delete keyframes referenced from another template.
			.filter(([, options]) => !options?.exclude)
			.map(([plugin, options]) => (typeof plugin === 'function' ? plugin(options) : require(plugin)(options))),
	);
}
