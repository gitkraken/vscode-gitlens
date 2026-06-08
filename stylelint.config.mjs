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
 * Prettier owns whitespace/formatting; stylelint owns conventions, property ordering
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
	// Intentional, hand-written prefixes required for browser support (-webkit-mask-*, -webkit-line-clamp, …)
	'property-no-vendor-prefix': null,
	// `var(--vscode-font-*)` carries its own fallback; icon fonts (codicon) must NOT get a generic fallback
	'font-family-no-missing-generic-family-keyword': null,
};

/**
 * Pre-existing violations across the webviews (as of the stylelint rollout) that were NOT auto-fixed
 * and are deferred for triage rather than fixed in bulk. Kept as warnings so `lint:ci` stays green and
 * the linter still enforces them on *new* code via --fix; promote each back to error as the backlog clears.
 * The full file:line list lives in the rollout notes.
 */
const deferredToWarning = {
	'declaration-property-value-keyword-no-deprecated': [true, { severity: 'warning' }], // word-break: break-word
	'property-no-deprecated': [true, { severity: 'warning' }], // clip (visually-hidden a11y hack), -webkit-box-pack
	'block-no-empty': [true, { severity: 'warning' }],
	'no-duplicate-selectors': [true, { severity: 'warning' }],
	'declaration-block-no-duplicate-custom-properties': [true, { severity: 'warning' }],
	'declaration-block-no-redundant-longhand-properties': [true, { severity: 'warning' }],
	'unit-no-unknown': [true, { severity: 'warning' }], // settings.scss:772 — likely a real typo, worth a look
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
