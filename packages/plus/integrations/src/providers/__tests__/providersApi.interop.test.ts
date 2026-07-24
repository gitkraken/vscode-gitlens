import * as assert from 'node:assert/strict';
import { before, suite, test } from 'mocha';

// Guards the CJS->ESM interop that `providersApi.ts` depends on. `@gitkraken/provider-apis`
// ships as CommonJS whose callable factory lives on the `default` export; the raw module
// namespace (what webpack's `__webpack_require__` and Node's `require` return) is NOT itself
// callable. `providersApi.ts` normalizes with `(ProviderApis.default ?? ProviderApis)`.
//
// The test bundler (esbuild) auto-unwraps a static `import ProviderApis from '...'` into the
// callable factory directly, which would mask a regression. So we load the module through a
// dynamic `import()` with a non-literal specifier — esbuild leaves it as a runtime import, and
// Node surfaces the CJS module as `{ default: module.exports }`, i.e. the same raw namespace
// webpack exposes (factory under `.default`). If provider-apis ever changes shape (ships a
// callable default or real ESM), these assertions flag it so the normalization can be revisited.
suite('@gitkraken/provider-apis CJS interop (providersApi factory normalization)', () => {
	// `rawBinding` mirrors what `__webpack_require__('@gitkraken/provider-apis')` returns.
	let rawBinding: { default?: unknown } & ((opts: unknown) => unknown);

	before(async () => {
		// Non-literal specifier so esbuild leaves this as a runtime dynamic import.
		const specifier = ['@gitkraken', 'provider-apis'].join('/');
		const ns = (await import(specifier)) as { default: typeof rawBinding };
		rawBinding = ns.default;
	});

	test('the raw module binding is not directly callable (webpack/Node namespace shape)', () => {
		assert.equal(typeof rawBinding, 'object');
		assert.notEqual(typeof rawBinding, 'function');
	});

	test('the factory lives on the `default` export', () => {
		assert.equal(typeof rawBinding.default, 'function');
	});

	test('the `(default ?? module)` normalization yields a callable factory', () => {
		const createProviderApis = (rawBinding.default ?? rawBinding) as (opts: {
			request: () => Promise<unknown>;
		}) => { github?: { getCurrentUser?: unknown } };
		assert.equal(typeof createProviderApis, 'function');

		const apis = createProviderApis({ request: () => Promise.resolve({ status: 200, headers: {}, body: {} }) });
		assert.equal(typeof apis.github?.getCurrentUser, 'function');
	});
});
