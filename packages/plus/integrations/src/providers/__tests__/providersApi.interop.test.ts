import * as assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { suite, test } from 'mocha';

// Guards the `@gitkraken/provider-apis` exports core binds by name, in both formats the package publishes: a consumer's
// resolver picks one, and the default export means different things to each (the factory under `import`, a namespace
// holding it under `require`, which is why core doesn't use it). The test bundler would resolve a static import itself,
// so these load the module through Node with a non-literal specifier that esbuild leaves as a runtime call.
const specifier = ['@gitkraken', 'provider-apis'].join('/');

type ProviderApisModule = {
	makeProviderAPIs: (opts: { request: () => Promise<unknown> }) => { github?: { getCurrentUser?: unknown } };
	GraphQLErrors: new (message: string) => Error;
};

const formats: { format: string; load: () => Promise<ProviderApisModule> }[] = [
	{ format: 'import', load: () => import(specifier) as Promise<ProviderApisModule> },
	{ format: 'require', load: () => Promise.resolve(createRequire(__filename)(specifier) as ProviderApisModule) },
];

suite('@gitkraken/provider-apis module formats', () => {
	for (const { format, load } of formats) {
		test(`${format}: the named factory builds the providers`, async () => {
			const { makeProviderAPIs } = await load();
			const apis = makeProviderAPIs({ request: () => Promise.resolve({ status: 200, headers: {}, body: {} }) });
			assert.equal(typeof apis.github?.getCurrentUser, 'function');
		});

		test(`${format}: GraphQLErrors carries the name core recognizes it by`, async () => {
			const { GraphQLErrors } = await load();
			assert.equal(new GraphQLErrors('Repository a/b not found').name, 'GraphQLErrors');
		});
	}
});
