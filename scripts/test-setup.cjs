'use strict';

// scripts/esbuild.tests.mjs bundles every `*.test.ts` file independently (no code splitting,
// since esbuild doesn't support it for CJS output). Any Lit component transitively imported by
// more than one test file is therefore inlined into every bundle that reaches it, and its
// module-scope `@customElement(...)` runs once per bundle. `@lit-labs/ssr-dom-shim` owns the
// `customElements` registry in this Node test host and is externalized by `nodeExternalsPlugin`,
// so it's a single shared instance across all the bundles Mocha loads into one process — the
// second `define()` call for the same tag name throws and aborts the whole run before a single
// test executes.
//
// `require()` the shim directly (rather than letting a Lit component pull it in first) so it
// installs the real, shared `globalThis.customElements` right now, before any test bundle runs.
// A guard that only checked `globalThis.customElements` here would silently no-op: the shim
// doesn't exist as a global until something imports it.
//
// `@lit-labs/ssr-dom-shim` isn't reachable as a bare specifier from this file: pnpm gives each
// package its own private `node_modules`, and this script isn't one of its dependents. `lit` is
// hoisted to the workspace root, and it depends on `@lit/reactive-element`, which depends on the
// shim -- so resolve through that same chain the test bundles themselves rely on at runtime.
const path = require('node:path');

const reactiveElementEntry = require.resolve('@lit/reactive-element', {
	paths: [path.dirname(require.resolve('lit'))],
});
const shimEntry = require.resolve('@lit-labs/ssr-dom-shim', { paths: [path.dirname(reactiveElementEntry)] });
const { customElements } = require(shimEntry);

const originalDefine = customElements.define.bind(customElements);

// Tolerate a name being redefined with a constructor that's structurally identical to the one
// already registered -- that's exactly what per-bundle duplication produces, and it's harmless.
// A name reused by a genuinely different constructor is still worth surfacing, so it's logged
// rather than silently dropped.
customElements.define = (name, ctor) => {
	const existing = customElements.get(name);
	if (existing == null) {
		originalDefine(name, ctor);
		return;
	}

	if (existing.toString() !== ctor.toString()) {
		console.warn(
			`[test-setup] Custom element "${name}" was already defined with a different constructor; ignoring the redefinition.`,
		);
	}
};
