// @ts-check
import globals from 'globals';
import { includeIgnoreFile } from '@eslint/compat';
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import antiTrojanSource from 'eslint-plugin-anti-trojan-source';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import { configs as litConfigs } from 'eslint-plugin-lit';
import { configs as wcConfigs } from 'eslint-plugin-wc';
import noSrcImports from './scripts/eslint-rules/no-src-imports.js';
import reactCompiler from 'eslint-plugin-react-compiler';
import { fileURLToPath } from 'node:url';

/** @type {Awaited<import('typescript-eslint').Config>[number]['languageOptions']} */
const defaultLanguageOptions = {
	parser: ts.parser,
	parserOptions: {
		ecmaVersion: 2023,
		sourceType: 'module',
		ecmaFeatures: { impliedStrict: true },
		projectService: true,
	},
};

/** File patterns for different environments */
const filePatterns = {
	src: ['src/**/*'],
	envNode: ['src/env/node/**/*'],
	envBrowser: ['src/env/browser/**/*'],
	webviewsApps: ['src/webviews/apps/**/*'],
	webviewsShared: [
		// Keep in sync with `src/webviews/apps/tsconfig.json`
		'src/webviews/ipc.ts',
		'src/webviews/**/protocol.ts',
		'src/**/models/**/*.ts',
		'src/**/utils/**/*.ts',
		'src/@types/**/*',
		'src/config.ts',
		'src/constants.ts',
		'src/constants.*.ts',
		'src/env/browser/**/*',
		'src/features.ts',
		'src/system/**/*.ts',
		'**/webview/**/*',
	],
	tests: ['tests/**/*'],
	unitTests: ['src/**/__tests__/**/*'],
};

/** Ignore patterns for different contexts */
const ignorePatterns = {
	default: ['*.*', 'patches', 'scripts', 'src/@types'],
	extensionOnly: ['**/-webview/**/*'],
	webviewOnly: ['src/**/webview/**/*', 'src/webviews/apps/**/*'],
	nodeOnly: ['src/env/node/**/*'],
	browserOnly: ['src/env/browser/**/*'],
};

/** Import restriction configurations for different environments */
/** @type {{ extension: import('eslint').Linter.RuleEntry; webviews: import('eslint').Linter.RuleEntry; envNode: import('eslint').Linter.RuleEntry }} */
const restrictedImports = {
	/** Base restrictions that apply to all extension code */
	extension: [
		'error',
		{
			paths: [
				// Node.js built-in modules (not allowed in extension context)
				'assert',
				'buffer',
				'child_process',
				'cluster',
				'crypto',
				'dgram',
				'dns',
				'domain',
				'events',
				'freelist',
				'fs',
				'http',
				'https',
				'module',
				'net',
				'os',
				'path',
				'process',
				'punycode',
				'querystring',
				'readline',
				'repl',
				'smalloc',
				'stream',
				'string_decoder',
				'sys',
				'timers',
				'tls',
				'tracing',
				'tty',
				'url',
				'util',
				'vm',
				'zlib',
				// Specific import restrictions
				{ name: 'react-dom', importNames: ['Container'], message: 'Use our Container instead' },
				{ name: 'vscode', importNames: ['CancellationError'], message: 'Use our CancellationError instead' },
			],
			patterns: [
				{ group: ['**/env/**/*'], message: 'Use @env/ instead' },
				{ group: ['**/webview/**/*'], message: "Can't use any `webview`-only modules in extension" },
			],
		},
	],
	/** Restrictions for webview environments */
	webviews: [
		'error',
		{
			paths: [{ name: 'vscode', message: "Can't use `vscode` in webviews", allowTypeImports: true }],
			patterns: [
				{
					group: ['container'],
					importNames: ['Container'],
					message: "Can't use `Container` in webviews",
					allowTypeImports: true,
				},
				{
					group: ['**/-webview/**/*'],
					message: "Can't use any `-webview` modules in webviews",
					allowTypeImports: true,
				},
			],
		},
	],
	/** Minimal restrictions for Node.js environment */
	envNode: [
		'error',
		{
			paths: [
				{ name: 'react-dom', importNames: ['Container'], message: 'Use our Container instead' },
				{ name: 'vscode', importNames: ['CancellationError'], message: 'Use our CancellationError instead' },
			],
		},
	],
};

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	{ ignores: ignorePatterns.default },
	js.configs.recommended,
	...ts.configs.strictTypeChecked,
	{
		name: 'all',
		files: [...filePatterns.src, ...filePatterns.tests],
		languageOptions: { ...defaultLanguageOptions },
		linterOptions: { reportUnusedDisableDirectives: true },
		plugins: {
			// @ts-ignore
			'import-x': importX,
			// @ts-ignore
			'anti-trojan-source': antiTrojanSource,
			// @ts-ignore
			'@gitlens': { rules: { 'no-src-imports': noSrcImports } },
		},
		rules: {
			// Custom rules
			'@gitlens/no-src-imports': 'error',
			'anti-trojan-source/no-bidi': 'error',

			// Core JavaScript rules
			curly: ['error', 'multi-line', 'consistent'],
			eqeqeq: ['error', 'always', { null: 'ignore' }],
			'no-constant-condition': ['warn', { checkLoops: false }],
			'no-constant-binary-expression': 'error',
			'no-caller': 'error',
			'no-debugger': 'off',
			'no-else-return': 'warn',
			'no-empty': ['warn', { allowEmptyCatch: true }],
			'no-eval': 'error',
			'no-ex-assign': 'warn',
			'no-extend-native': 'error',
			'no-extra-bind': 'error',
			'no-extra-semi': 'off',
			'no-floating-decimal': 'error',
			'no-implicit-coercion': 'error',
			'no-implied-eval': 'error',
			'no-inner-declarations': 'off',
			'no-lone-blocks': 'error',
			'no-lonely-if': 'error',
			'no-loop-func': 'error',
			'no-mixed-spaces-and-tabs': 'off',
			'no-restricted-globals': ['error', 'process'],
			'no-restricted-imports': 'off',
			'no-return-assign': 'error',
			'no-return-await': 'warn',
			'no-self-compare': 'error',
			'no-sequences': 'error',
			'no-template-curly-in-string': 'warn',
			'no-throw-literal': 'error',
			'no-unmodified-loop-condition': 'warn',
			'no-unneeded-ternary': 'error',
			'no-unused-expressions': 'error',
			'no-use-before-define': 'off',
			'no-useless-call': 'error',
			'no-useless-catch': 'error',
			'no-useless-computed-key': 'error',
			'no-useless-concat': 'error',
			'no-useless-rename': 'error',
			'no-useless-return': 'error',
			'no-var': 'error',
			'no-with': 'error',
			'object-shorthand': ['error', 'never'],
			'one-var': ['error', 'never'],
			'prefer-arrow-callback': 'error',
			'prefer-const': ['error', { destructuring: 'all', ignoreReadBeforeAssign: true }],
			'prefer-numeric-literals': 'error',
			'prefer-object-spread': 'error',
			'prefer-promise-reject-errors': 'off',
			'prefer-rest-params': 'error',
			'prefer-spread': 'error',
			'prefer-template': 'error',
			'require-atomic-updates': 'off',
			'sort-imports': [
				'error',
				{
					ignoreCase: true,
					ignoreDeclarationSort: true,
					ignoreMemberSort: false,
					memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
				},
			],
			yoda: 'error',

			// Syntax restrictions for code style
			'no-restricted-syntax': [
				'error',
				{
					selector:
						'IfStatement:not(:has(BlockStatement)):not(:has(ReturnStatement)):not(:has(BreakStatement)):not(:has(ContinueStatement)):not(:has(YieldExpression)):not(:has(ThrowStatement))',
					message:
						'Single-line if statements are only allowed for control flow (return, break, continue, throw, yield).',
				},
				{
					selector: 'WhileStatement:not(:has(BlockStatement))',
					message: 'Single-line while statements are not allowed.',
				},
				{
					selector: 'ForStatement:not(:has(BlockStatement))',
					message: 'Single-line for statements are not allowed.',
				},
				{
					selector: 'ForInStatement:not(:has(BlockStatement))',
					message: 'Single-line for-in statements are not allowed.',
				},
				{
					selector: 'ForOfStatement:not(:has(BlockStatement))',
					message: 'Single-line for-of statements are not allowed.',
				},
			],

			// Import rules
			'import-x/consistent-type-specifier-style': ['error', 'prefer-top-level'],
			'import-x/default': 'off',
			'import-x/extensions': 'off',
			'import-x/named': 'off',
			'import-x/namespace': 'off',
			'import-x/newline-after-import': 'warn',
			'import-x/no-absolute-path': 'error',
			'import-x/no-cycle': 'off',
			'import-x/no-deprecated': 'off',
			'import-x/no-default-export': 'error',
			'import-x/no-duplicates': ['error', { 'prefer-inline': false }],
			'import-x/no-dynamic-require': 'error',
			'import-x/no-named-as-default': 'off',
			'import-x/no-named-as-default-member': 'off',
			'import-x/no-self-import': 'error',
			'import-x/no-unused-modules': 'off',
			'import-x/no-unresolved': 'off',
			'import-x/no-useless-path-segments': 'error',
			'import-x/order': [
				'warn',
				{
					alphabetize: { order: 'asc', orderImportKind: 'asc', caseInsensitive: true },
					groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
					'newlines-between': 'never',
				},
			],

			// TypeScript rules
			'@typescript-eslint/consistent-type-assertions': [
				'error',
				{ assertionStyle: 'as', objectLiteralTypeAssertions: 'allow-as-parameter' },
			],
			'@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
			'@typescript-eslint/explicit-module-boundary-types': [
				'error',
				{ allowArgumentsExplicitlyTypedAsAny: true },
			],
			'@typescript-eslint/naming-convention': [
				'error',
				{
					selector: 'variable',
					format: ['camelCase', 'PascalCase'],
					leadingUnderscore: 'allow',
					filter: { regex: '^_$', match: false },
				},
				{
					selector: 'variableLike',
					format: ['camelCase'],
					leadingUnderscore: 'allow',
					filter: { regex: '^_$', match: false },
				},
				{
					selector: 'memberLike',
					modifiers: ['private'],
					format: ['camelCase'],
					leadingUnderscore: 'allow',
				},
				{
					selector: 'memberLike',
					modifiers: ['private', 'readonly'],
					format: ['camelCase', 'PascalCase'],
					leadingUnderscore: 'allow',
				},
				{
					selector: 'memberLike',
					modifiers: ['static', 'readonly'],
					format: ['camelCase', 'PascalCase'],
				},
				{
					selector: 'interface',
					format: ['PascalCase'],
					custom: { regex: '^I[A-Z]', match: false },
				},
			],
			'@typescript-eslint/no-confusing-void-expression': [
				'error',
				{ ignoreArrowShorthand: true, ignoreVoidOperator: true },
			],
			'@typescript-eslint/no-duplicate-type-constituents': 'off',
			'@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-inferrable-types': ['warn', { ignoreParameters: true, ignoreProperties: true }],
			'@typescript-eslint/no-invalid-void-type': 'off',
			'@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }],
			'@typescript-eslint/no-misused-spread': 'off', // Too noisy
			'@typescript-eslint/no-non-null-assertion': 'off',
			'@typescript-eslint/no-redundant-type-constituents': 'off',
			'@typescript-eslint/no-restricted-imports': restrictedImports.extension,
			'@typescript-eslint/no-unnecessary-condition': 'off',
			'@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
			'@typescript-eslint/no-unnecessary-type-conversion': 'off',
			'@typescript-eslint/no-unnecessary-type-parameters': 'off', // https://github.com/typescript-eslint/typescript-eslint/issues/9705
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-enum-comparison': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unused-expressions': ['warn', { allowShortCircuit: true }],
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					args: 'all',
					argsIgnorePattern: '^_',
					caughtErrors: 'all',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					ignoreRestSiblings: true,
				},
			],
			'@typescript-eslint/no-use-before-define': ['error', { functions: false, classes: false }],
			'@typescript-eslint/prefer-for-of': 'warn',
			'@typescript-eslint/prefer-includes': 'warn',
			'@typescript-eslint/prefer-literal-enum-member': ['warn', { allowBitwiseExpressions: true }],
			'@typescript-eslint/prefer-optional-chain': 'warn',
			'@typescript-eslint/prefer-promise-reject-errors': ['error', { allowEmptyReject: true }],
			'@typescript-eslint/prefer-reduce-type-parameter': 'warn',
			'@typescript-eslint/restrict-template-expressions': [
				'error',
				{ allowAny: true, allowBoolean: true, allowNumber: true, allowNullish: true },
			],
			'@typescript-eslint/unbound-method': 'off',
			'@typescript-eslint/unified-signatures': ['error', { ignoreDifferentlyNamedParameters: true }],
		},
		settings: {
			'import-x/extensions': ['.ts', '.tsx'],
			'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
			'import-x/resolver-next': [createTypeScriptImportResolver()],
		},
	},

	// Extension (Node.js)
	{
		name: 'extension:node',
		files: filePatterns.src,
		ignores: [...ignorePatterns.webviewOnly, ...ignorePatterns.browserOnly],
		languageOptions: { ...defaultLanguageOptions, globals: { ...globals.node } },
	},

	// Extension (Browser)
	{
		name: 'extension:browser',
		files: filePatterns.src,
		ignores: [...ignorePatterns.webviewOnly, ...ignorePatterns.nodeOnly],
		languageOptions: { ...defaultLanguageOptions, globals: { ...globals.worker } },
	},

	// Node.js environment specific files
	{
		name: 'extension:node-env',
		files: filePatterns.envNode,
		rules: { '@typescript-eslint/no-restricted-imports': restrictedImports.envNode },
	},

	// Webviews shared code
	{
		name: 'webviews:shared',
		files: filePatterns.webviewsShared,
		ignores: ignorePatterns.extensionOnly,
		languageOptions: { ...defaultLanguageOptions, globals: { ...globals.browser } },
		rules: {
			'@typescript-eslint/no-restricted-imports': restrictedImports.webviews,
		},
	},

	// Webviews apps
	{
		name: 'webviews:apps',
		files: filePatterns.webviewsApps,
		ignores: ignorePatterns.extensionOnly,
		extends: [
			litConfigs['flat/recommended'],
			wcConfigs['flat/recommended'],
			wcConfigs['flat/best-practice'],
			reactCompiler.configs.recommended,
		],
		languageOptions: { ...defaultLanguageOptions, globals: { ...globals.browser } },
		rules: {
			'@typescript-eslint/no-restricted-imports': restrictedImports.webviews,

			// Lit-specific rules (only for actual Lit components)
			'lit/lifecycle-super': 'error',
			'lit/no-legacy-imports': 'error',
			'lit/no-native-attributes': 'error',
			'lit/no-template-bind': 'error',
			'lit/no-this-assign-in-render': 'error',

			// Relaxed rules for webview apps
			'@typescript-eslint/explicit-module-boundary-types': 'off',
		},
		settings: { wc: { elementBaseClasses: ['LitElement', 'GlElement'] } },
	},

	// E2E Tests
	{
		name: 'tests:e2e',
		files: filePatterns.tests,
		languageOptions: { ...defaultLanguageOptions, globals: { ...globals.node } },
		rules: { '@typescript-eslint/no-restricted-imports': 'off' },
	},

	// Unit Tests
	{
		name: 'tests:unit',
		files: filePatterns.unitTests,
		languageOptions: { ...defaultLanguageOptions, globals: { ...globals.node } },
		rules: {
			'no-restricted-imports': 'off',
			'@typescript-eslint/no-restricted-imports': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'no-restricted-syntax': [
				'error',
				{
					message: "Don't forget to remove .only from test suites",
					selector: 'CallExpression MemberExpression[object.name="suite"][property.name="only"]',
				},
				{
					message: "Don't forget to remove .only from tests",
					selector: 'CallExpression MemberExpression[object.name="test"][property.name="only"]',
				},
			],
		},
	},
);
