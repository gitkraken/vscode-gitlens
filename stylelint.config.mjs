// @ts-check
import postcssLit from 'postcss-lit';
import postcssScss from 'postcss-scss';

/**
 * Stylelint configuration for GitLens webview styles.
 *
 * Two CSS surfaces, two syntaxes:
 *   - `**\/*.scss`                  light-DOM global stylesheets   -> postcss-scss
 *   - `src/webviews/apps/**\/*.ts`  Lit `css``` shadow-DOM styles  -> postcss-lit
 *
 * The custom-syntax modules are imported and passed as objects rather than by name:
 * under pnpm's strict node_modules, stylelint (running from the store) cannot resolve a
 * bare `customSyntax` string against the project's node_modules.
 *
 * Browser support is read from `.browserslistrc` (last 2 Electron versions) by the
 * no-unsupported-browser-features plugin — kept as warnings so a new feature surfaces
 * without hard-failing the build.
 *
 * oxfmt owns whitespace/formatting; stylelint owns conventions, property ordering
 * (recess-order, auto-fixable), and browser-support. The two don't overlap.
 */

/** Relaxations shared by both surfaces to fit existing, established GitLens conventions. */
const sharedRules = {
	// Tokens use prefixes (--gl-*, --vscode-*, --wa-*, --gk-*) and `--name--modifier` suffixes
	'custom-property-pattern': null,
	// Existing class/keyframes naming predates stylelint; not worth churning
	'selector-class-pattern': null,
	'keyframes-name-pattern': null,
	// High false-positive rate on real-world stylesheets
	'no-descending-specificity': null,
	// Dense token blocks intentionally omit blank lines between custom properties
	'custom-property-empty-line-before': null,
	// Mirrors custom-property-empty-line-before: comments are written inline against the code they
	// document, and oxfmt owns whitespace — leaving this on rewrites files on every fix-on-save,
	// shifting comment lines (notably in Lit `css``` templates round-tripped through postcss-lit)
	'comment-empty-line-before': null,
	// Intentional, hand-written prefixes required for browser support (-webkit-mask-*, -webkit-line-clamp, …)
	'property-no-vendor-prefix': null,
	// `var(--vscode-font-*)` carries its own fallback; icon fonts (codicon) must NOT get a generic fallback
	'font-family-no-missing-generic-family-keyword': null,
	// Elevation: a `--gl-shadow-*` tier must be applied via the elevated-surface helper (Lit
	// `elevatedSurface` / SCSS `@include elevated-surface`), which pairs it with the border that
	// survives high-contrast (where the shadow vanishes). Applying it raw on `box-shadow` skips that
	// border and silently regresses HC. Rare intentional exceptions (a vendored `!important` override,
	// a directional sheet that can't take a full border) opt out with a `stylelint-disable-line`.
	'declaration-property-value-disallowed-list': [
		{ 'box-shadow': ['/--gl-shadow-/'] },
		{
			message:
				'Apply --gl-shadow-* via the elevated-surface helper (Lit `elevatedSurface` / SCSS `@include elevated-surface`), not raw on box-shadow — see docs/webview-styling.md',
		},
	],
};

/**
 * Pre-existing violations that are intentional or low-value enough to keep as warnings rather than
 * fix or hard-fail on. (The duplicate-custom-property, empty-block, deprecated-keyword, and bad-unit
 * findings from the rollout have since been fixed and those rules now run at their default error level.)
 * Promote any of these back to error if/when the remaining instances are addressed.
 */
const deferredToWarning = {
	// Intentional: `clip: rect(…)` visually-hidden a11y hack + vendored -webkit-box-pack in diff2html CSS
	'property-no-deprecated': [true, { severity: 'warning' }],
	// Mostly deliberate organizational splits (:root/body, theme override blocks, component base + state)
	'no-duplicate-selectors': [true, { severity: 'warning' }],
	// One non-combinable grid-template in rebase.css.ts
	'declaration-block-no-redundant-longhand-properties': [true, { severity: 'warning' }],
};

export default {
	plugins: ['stylelint-no-unsupported-browser-features'],
	rules: {
		'plugin/no-unsupported-browser-features': [
			true,
			// These features are supported across our Electron targets; the plugin's caniuse data
			// flags them conservatively (often as "partial support"), so ignore them to avoid noise.
			{
				severity: 'warning',
				ignore: ['css-display-contents', 'css-clip-path', 'text-decoration', 'multicolumn'],
			},
		],
	},
	overrides: [
		{
			files: ['**/*.scss'],
			customSyntax: postcssScss,
			extends: ['stylelint-config-standard-scss', 'stylelint-config-recess-order'],
			rules: {
				...sharedRules,
				...deferredToWarning,
				'scss/dollar-variable-pattern': null,
				'scss/percent-placeholder-pattern': null,
				'scss/at-mixin-pattern': null,
			},
		},
		{
			files: ['src/webviews/apps/**/*.ts'],
			customSyntax: postcssLit,
			extends: ['stylelint-config-standard', 'stylelint-config-recess-order'],
			rules: {
				...sharedRules,
				...deferredToWarning,
				// .ts files without a `css``` template parse to an empty stylesheet under postcss-lit
				'no-empty-source': null,
				// postcss-lit substitutes `${…}` interpolations with placeholder tokens this rule can't validate
				'declaration-property-value-no-unknown': null,
				// `value-keyword-case`'s --fix rewrites every declaration value; under postcss-lit that write-back
				// clobbers the `${…}` interpolation placeholders and persists raw `postcss_lit_N` tokens to source
				// (corrupting `unsafeCSS` color vars). Disable it on the Lit surface — authors already write
				// keywords lowercase, so there's nothing to gain and a real corruption vector to lose.
				'value-keyword-case': null,
			},
		},
		{
			// Vendored upstream CSS (highlight.js + diff2html) — exempt from rules its source style violates,
			// without weakening those rules (incl. property ordering) for first-party code.
			files: ['**/composer/components/diff/diff.css.ts'],
			customSyntax: postcssLit,
			rules: {
				'order/properties-order': null,
				'declaration-block-no-duplicate-properties': null,
			},
		},
	],
};
