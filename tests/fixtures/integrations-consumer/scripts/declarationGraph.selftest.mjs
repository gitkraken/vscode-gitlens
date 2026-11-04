// Feeds synthetic adversarial declaration sources to the declaration-graph check and asserts pass/fail for each, so the
// scanner can't silently rot into letting a leak through. Runs before the real check.

import assert from 'node:assert/strict';
import { findDependencies, forbiddenModules, forbiddenPackages, walkDeclarations } from './declarationGraph.mjs';

const root = '/virtual/core';
const entry = `${root}/dist/plus/integrations/index.d.ts`;

function run(entrySource, extra = {}) {
	const files = new Map([[entry, entrySource]]);
	for (const [path, source] of Object.entries(extra)) {
		files.set(`${root}/dist/plus/integrations/${path}`, source);
	}
	return walkDeclarations({
		entries: [entry],
		root: root,
		read: f => files.get(f),
		forbiddenPackages: forbiddenPackages,
		forbiddenModules: forbiddenModules,
	});
}

const CR = String.fromCharCode(0x0d);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const BOM = String.fromCharCode(0xfeff);
const sdk = '@gitkraken/provider-apis';

/** [name, entry source, extra files, expected to fail] */
const cases = [
	// Forbidden bare specifier, every syntax
	['import from', `import { A } from "${sdk}";`, {}, true],
	['import type from', `import type { A } from "${sdk}";`, {}, true],
	['import default from', `import A from '${sdk}';`, {}, true],
	['import namespace from', `import * as A from "${sdk}";`, {}, true],
	['import deep subpath', `import { A } from "${sdk}/github";`, {}, true],
	['multi-line import', `import {\n  a,\n  b,\n} from\n"${sdk}";`, {}, true],
	['export from', `export { A } from "${sdk}";`, {}, true],
	['export type from', `export type { A } from "${sdk}";`, {}, true],
	['export * from', `export * from "${sdk}";`, {}, true],
	['export * as from', `export * as ns from "${sdk}";`, {}, true],
	['multi-line export from', `export {\n  a,\n  b\n} from "${sdk}";`, {}, true],
	['side-effect import', `import "${sdk}";`, {}, true],
	['side-effect import (single quote, no space)', `import'${sdk}';`, {}, true],
	['import() type expression', `export type A = import("${sdk}").X;`, {}, true],
	[
		'import() with attributes',
		`export type A = import("${sdk}", { with: { "resolution-mode": "import" } }).X;`,
		{},
		true,
	],
	['import = require', `import x = require("${sdk}");\nexport = x;`, {}, true],
	['export import = require', `export import x = require("${sdk}");`, {}, true],
	['reference types', `/// <reference types="${sdk}" />\nexport {};`, {}, true],
	['reference types (single quote, subpath)', `/// <reference types='${sdk}/x' />`, {}, true],
	['declare module augmentation', `declare module "${sdk}" {\n  interface A { b: string }\n}`, {}, true],
	['declare module augmentation subpath', `declare module '${sdk}/github' { }`, {}, true],
	['amd-dependency', `/// <amd-dependency path="${sdk}" />`, {}, true],

	// Forbidden internal module, reached by relative specifier or path reference
	[
		'relative import of internal',
		`import type { G } from "./models/gitHostIntegration.js";`,
		{ 'models/gitHostIntegration.d.ts': 'export {};' },
		true,
	],
	[
		'relative side-effect import of internal',
		`import "./models/gitHostIntegration.js";`,
		{ 'models/gitHostIntegration.d.ts': 'export {};' },
		true,
	],
	[
		'relative export * of internal',
		`export * from "./models/gitHostIntegration.js";`,
		{ 'models/gitHostIntegration.d.ts': 'export {};' },
		true,
	],
	[
		'relative import() of internal',
		`export type A = import("./integrationService.js").X;`,
		{ 'integrationService.d.ts': 'export {};' },
		true,
	],
	[
		'relative require of internal',
		`import x = require("./integrationService.js");`,
		{ 'integrationService.d.ts': 'export {};' },
		true,
	],
	[
		'reference path to internal',
		`/// <reference path="./models/gitHostIntegration.d.ts" />\nexport {};`,
		{ 'models/gitHostIntegration.d.ts': 'export {};' },
		true,
	],
	[
		'reference path without extension',
		`/// <reference path="./models/gitHostIntegration" />`,
		{ 'models/gitHostIntegration.d.ts': 'export {};' },
		true,
	],
	[
		'declare module relative augmentation of internal',
		`declare module "./models/gitHostIntegration.js" { }`,
		{ 'models/gitHostIntegration.d.ts': 'export {};' },
		true,
	],

	// Transitive: a clean-looking file that leads to a leak
	['transitive via import', `export * from "./a.js";`, { 'a.d.ts': `import "${sdk}";` }, true],
	[
		'transitive via reference path',
		`/// <reference path="./a.d.ts" />`,
		{ 'a.d.ts': `/// <reference types="${sdk}" />` },
		true,
	],
	[
		'transitive reference path then import',
		`/// <reference path="./a.d.ts" />`,
		{ 'a.d.ts': `import "./b.js";`, 'b.d.ts': `export type A = import("${sdk}").X;` },
		true,
	],

	// Fail closed on what cannot be classified
	['dynamic import with non-literal', `export type A = import(Foo).X;`, {}, true],
	['template-literal specifier', 'import x from `' + sdk + '`;', {}, true],
	['require with non-literal', `import x = require(name);`, {}, true],
	['malformed reference directive', `/// <reference foo="x" />`, {}, true],
	['reference path that does not exist', `/// <reference path="./nope.d.ts" />`, {}, true],
	['relative import that does not exist', `export * from "./nope.js";`, {}, true],
	['reference path escaping the package', `/// <reference path="../../../../outside.d.ts" />`, {}, true],

	// Escaped specifiers and absolute / URL / drive / UNC specifiers fail closed
	[
		'unicode-escaped specifier in export from',
		'export type { Account } from "@gitkraken/\\u0070rovider-apis";',
		{},
		true,
	],
	['hex-escaped specifier in side-effect import', 'import "\\x40gitkraken/provider-apis";', {}, true],
	['escaped specifier in import()', 'export type A = import("@gitkraken/\\u{70}rovider-apis").X;', {}, true],
	['escaped specifier in reference types', '/// <reference types="@gitkraken/\\u0070rovider-apis" />', {}, true],
	['escaped quote inside a specifier', 'import "a\\"@gitkraken/provider-apis";', {}, true],
	[
		'absolute POSIX import of internal',
		`export type { IntegrationBase } from "${root}/dist/plus/integrations/models/integration.js";`,
		{},
		true,
	],
	['absolute POSIX side-effect import', 'import "/etc/passwd";', {}, true],
	[
		'absolute POSIX reference path',
		'/// <reference path="/virtual/core/dist/plus/integrations/index.d.ts" />',
		{},
		true,
	],
	['file: URL import', 'import "file:///virtual/core/dist/x.js";', {}, true],
	['file: URL reference path', '/// <reference path="file:///virtual/core/dist/x.d.ts" />', {}, true],
	['drive-qualified (backslash) import', 'import "C:\\\\core\\\\x.js";', {}, true],
	['drive-qualified (slash) import', 'import type { A } from "C:/core/x.js";', {}, true],
	['drive-qualified reference path', '/// <reference path="D:/core/x.d.ts" />', {}, true],
	['UNC import (backslash)', 'import "\\\\\\\\server\\\\share\\\\x.js";', {}, true],
	['UNC import (slash)', 'import "//server/share/x.js";', {}, true],
	['absolute import() type expression', 'export type A = import("/virtual/core/x.js").X;', {}, true],
	['absolute declare module', 'declare module "/virtual/core/x" { }', {}, true],

	// Line terminators other than LF end a line comment; a leading BOM does not hide a directive. Real characters, built at runtime.
	['line comment ended by CR', `// comment${CR}import "${sdk}";`, {}, true],
	['line comment ended by U+2028', `// comment${LS}import "${sdk}";`, {}, true],
	['line comment ended by U+2029', `// comment${PS}import "${sdk}";`, {}, true],
	['CR-separated /// reference types', `export {};${CR}/// <reference types="${sdk}" />`, {}, true],
	[
		'U+2028-separated /// reference path',
		`export {};${LS}/// <reference path="./a.d.ts" />`,
		{ 'a.d.ts': `import "${sdk}";` },
		true,
	],
	['BOM before reference types', `${BOM}/// <reference types="${sdk}" />\nexport {};`, {}, true],
	[
		'BOM before reference path',
		`${BOM}/// <reference path="./models/gitHostIntegration.d.ts" />`,
		{ 'models/gitHostIntegration.d.ts': 'export {};' },
		true,
	],
	['BOM before a clean file', `${BOM}export * from "./a.js";`, { 'a.d.ts': 'export {};' }, false],
	[
		'CR-terminated comment before a clean import',
		`// ${sdk}${CR}export * from "./a.js";`,
		{ 'a.d.ts': 'export {};' },
		false,
	],

	// Must pass
	[
		'clean relative graph',
		`export * from "./a.js";\nimport type { B } from "./a.js";`,
		{ 'a.d.ts': 'export type B = string;' },
		false,
	],
	[
		'unrelated bare package',
		`import type { Disposable } from "vscode";\nexport type A = import("node:stream").Readable;`,
		{},
		false,
	],
	['lookalike package', `import "@gitkraken/provider-apis-lookalike";`, {}, false],
	['reference lib', `/// <reference lib="es2022" />\n/// <reference no-default-lib="true" />\nexport {};`, {}, false],
	['reference types of unrelated package', `/// <reference types="node" />`, {}, false],
	['reference path to clean file', `/// <reference path="./a.d.ts" />`, { 'a.d.ts': 'export {};' }, false],
	['import cycle', `export * from "./a.js";`, { 'a.d.ts': 'export * from "./index.js";' }, false],
	['declare module of unrelated name', `declare module "other-pkg" { }`, {}, false],
	['"from" as a property name', `export type A = { from: string; import: boolean; module: number };`, {}, false],
	['specifier-like text in a string literal type that is not a position', `export type A = "x";`, {}, false],

	// Comments mentioning forbidden imports must not count
	['line comment with import', `// import { A } from "${sdk}";\nexport {};`, {}, false],
	['block comment with import', `/* import "${sdk}"; */\nexport {};`, {}, false],
	[
		'jsdoc with import',
		`/**\n * import { A } from "${sdk}"\n * @example import("${sdk}").X\n */\nexport {};`,
		{},
		false,
	],
	[
		'directive text inside a block comment (not a line-leading ///) does not count',
		`/* /// <reference types="${sdk}" /> */`,
		{},
		false,
	],
	['indented line comment with require', `   // import x = require("${sdk}");\nexport {};`, {}, false],
	[
		'trailing comment after a clean import',
		`export * from "./a.js"; // see ${sdk}`,
		{ 'a.d.ts': 'export {};' },
		false,
	],
	[
		'// inside a string is not a comment start',
		`import type { A } from "./a.js"; export type U = "http://x";`,
		{ 'a.d.ts': 'export {};' },
		false,
	],
	[
		'string containing /* does not swallow a real leak',
		`export type U = "/*";\nimport "${sdk}";\nexport type V = "*/";`,
		{},
		true,
	],
];

let failed = 0;
for (const [name, source, extra, expectFail] of cases) {
	const { failures, missing } = run(source, extra);
	const didFail = failures.length > 0 || missing.length > 0;
	try {
		assert.equal(
			didFail,
			expectFail,
			`${expectFail ? 'expected a failure' : 'expected a pass'}, got ${JSON.stringify([...failures, ...missing])}`,
		);
	} catch (ex) {
		failed++;
		console.error(`FAIL  ${name}: ${ex.message}`);
	}
}

// findDependencies reports the kind and specifier for the forms that matter
assert.deepEqual(
	findDependencies(
		`/// <reference types="a" />\n/// <reference path="./b.d.ts" />\nimport "c";\nexport {\n x,\n y\n} from "d";\nexport type T = import("e").X;\nimport f = require("g");\ndeclare module "h" {}\n// import "nope";`,
	)
		.map(d => `${d.kind}:${d.specifier}`)
		.sort(),
	[
		'import-from:d',
		'import-side-effect:c',
		'import-type-expression:e',
		'module-augmentation:h',
		'reference-path:./b.d.ts',
		'reference-types:a',
		'require:g',
	].sort(),
);

if (failed > 0) {
	console.error(`${failed} declaration-graph self-test case(s) failed.`);
	process.exit(1);
}

console.log(`Declaration-graph self-test passed (${cases.length} cases).`);
