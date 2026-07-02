import type { AIProviderContext } from '../context.js';

/** Inert provider context for construction-only tests — nothing under test may reach it */
export function createStubProviderContext(): AIProviderContext {
	return {
		fetch: () => Promise.reject(new Error('not used')),
		getApiKey: () => Promise.resolve(undefined),
		getProviderConfig: () => ({ enabled: true }),
		getOrPromptUrl: () => Promise.resolve(undefined),
	};
}
