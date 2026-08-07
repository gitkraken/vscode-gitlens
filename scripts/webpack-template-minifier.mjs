import { defaultMinifyOptions, defaultStrategy, minifyHTMLLiterals } from 'minify-html-literals';
import postcss from 'postcss';
import { createCssProcessor } from './css-minify-preset.mjs';

/**
 * Webpack loader that minifies the CSS and markup inside `` css`…` `` / `` html`…` `` tagged templates.
 *
 * `CssMinimizerPlugin` only sees what `MiniCssExtractPlugin` emits — the `*.css` files — and nothing
 * minifies markup written as a template literal at all. To the TS/JS pipeline both are ordinary
 * template literals, so they ship with every space of indentation, every blank line and every
 * authoring comment. Together that is a quarter of the Commit Graph webview bundle.
 *
 * `minify-html-literals` locates the templates and handles the `${…}` round-trip: it swaps each
 * interpolation for a placeholder so the contents parse, then splits the minified text back apart on
 * those placeholders, validating that the part count survived.
 *
 * Markup goes through its `html-minifier-terser`, with `conservativeCollapse` on. That matters here:
 * whitespace between inline elements is significant, and the minifier only knows the standard inline
 * tags — a custom element is treated as block-level, so plain `collapseWhitespace` *deletes* the space
 * in `</code-icon> <span>` and joins an icon to its label. This UI is built almost entirely from custom
 * elements. Conservative collapse reduces a run of whitespace to one space and never removes it.
 *
 * CSS does not. The library bundles clean-css 4.2.4, which predates native nesting, `@container` and
 * `@layer` and silently drops those rules — so `minifyCSS` is redirected to `createCssProcessor()`,
 * the same cssnano preset `CssMinimizerPlugin` runs over the `*.css` files.
 *
 * That processor is async, while `minifyCSS` must return a string, so a file carrying CSS is walked
 * twice: once to collect what the library would hand a minifier, then again to splice in results
 * minified in between. Cheap — the second walk re-parses, it doesn't re-minify. A file with only
 * markup needs one pass.
 *
 * Production only: collapsing this text shifts every column after it, which would degrade debugging
 * of components for no benefit in a dev build.
 */

let processor;

/**
 * The library's `${…}` stand-in is `@TEMPLATE_EXPRESSION…();` — the trailing `;` is part of the
 * split token. When an interpolation ends a declaration (`--x: ${val};`), cssnano collapses the
 * placeholder's own `;` into the declaration separator, and the split-by-placeholder step then
 * consumes that separator — fusing the NEXT declaration into this value. A custom property eats
 * whatever follows silently, since almost any token stream is a valid custom-property value.
 *
 * The library guards against exactly this, but only via a clean-css `transform` hook
 * (`adjustMinifyCSSOptions`) that redirecting `minifyCSS` to cssnano bypasses. Mirror it here: a
 * second parse over cssnano's output re-appends `;` to any declaration value that ends with the
 * placeholder, so the split eats the restored one and the real separator survives. Parse-level on
 * purpose — placeholders in mid-value positions (`var(--x, ${fallback})`) keep their `();` inside
 * the parens, and a string-level replace could not tell the two apart.
 */
const placeholderValueSuffix = /@TEMPLATE_EXPRESSION_*\(\)$/;
const semicolonRestorer = postcss([
	{
		postcssPlugin: 'restore-template-expression-semicolons',
		Declaration(decl) {
			const value = decl.value.trimEnd();
			if (placeholderValueSuffix.test(value)) {
				decl.value = `${value};`;
			}
		},
	},
]);

/** @this {import('webpack').LoaderContext<unknown>} */
export default function templateMinifierLoader(source) {
	if (this.mode !== 'production' || (!source.includes('css`') && !source.includes('html`'))) return source;

	const callback = this.async();
	// `minifyOptions.minifyCSS` is left on deliberately. Turning it off (which would keep the bundled
	// clean-css away from a `<style>` block inside markup) also stops the library recognising a `css`
	// template as CSS at all, so every stylesheet would route through the markup minifier instead. The
	// exposure is nil in practice: the CSP forbids inline `<style>` and `style=`, so there is no CSS
	// embedded in markup for it to reach.
	const options = {
		fileName: this.resourcePath,
		// Allowlist the two tags by exact name rather than filtering the library's own predicates, which
		// match any tag merely *containing* `html`/`svg`/`css` (`unsafeSVG`, `styles.css`, `foo.html`).
		//
		// `svg` must stay out. Those templates are authored as fragments — Lit composes them into a
		// parent `<svg>` at render time — so with no `<svg>` ancestor to put the parser in
		// foreign-content mode, an HTML minifier strips the self-closing slash from `<circle … />`.
		// `circle` is not a void element in HTML, so it becomes an *open* tag and every following sibling
		// turns into its child. SVG renders nothing inside a `<circle>`, which is how this silently
		// emptied the graph's commit nodes and author avatars.
		shouldMinify: template => template.tag === 'html',
		shouldMinifyCSS: template => template.tag === 'css',
		minifyOptions: { ...defaultMinifyOptions, conservativeCollapse: true },
	};

	/**
	 * The placeholder round-trip can fail on a template whose interpolations a minifier moves
	 * ("splitHTMLByPlaceholder() must return same number of strings as template"), and a malformed
	 * declaration fails the CSS parse. Ship that file as authored rather than risk mangling it, but say
	 * so — silence here reads as "nothing to do".
	 */
	const bail = ex => {
		this.emitWarning(new Error(`Skipped template minification: ${ex instanceof Error ? ex.message : String(ex)}`));
		callback(null, source);
	};

	// Walk once with a pass-through CSS minifier to capture each template exactly as the splice step
	// will present it — placeholders substituted — so the text minified below is the text it looks up.
	/** @type {string[]} */
	const stylesheets = [];
	let firstPass;
	try {
		firstPass = minifyHTMLLiterals(source, {
			...options,
			strategy: { ...defaultStrategy, minifyCSS: css => (stylesheets.push(css), css) },
		});
	} catch (ex) {
		bail(ex);
		return;
	}

	// No CSS to pre-minify: that first pass already minified the markup, so it is the result.
	if (!stylesheets.length) {
		callback(null, firstPass?.code ?? source);
		return;
	}

	processor ??= createCssProcessor();

	Promise.all(
		stylesheets.map(css =>
			processor
				.process(css, { from: undefined })
				.then(r => semicolonRestorer.process(r.css, { from: undefined }))
				.then(r => [css, r.css]),
		),
	)
		.then(entries => {
			const minified = new Map(entries);
			const result = minifyHTMLLiterals(source, {
				...options,
				strategy: {
					...defaultStrategy,
					// Keep the original on anything that came back empty: a template can be a fragment of bare
					// declarations meant to be interpolated into a rule, and emptying one deletes styles silently.
					minifyCSS: css => minified.get(css) || css,
				},
			});
			callback(null, result?.code ?? source);
		})
		.catch(bail);
}
