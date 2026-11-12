import type { IntegrationStorageProvider } from '@gitlens/integrations/context.js';
import { escapeRegex } from '@gitlens/utils/string.js';
import type { Container } from '../../../container.js';

export function createStorageAdapter(container: Container): IntegrationStorageProvider {
	// The host's `Storage` class uses key-mapping types for compile-time
	// validation; the package owns its own keys, so cast to `never`.
	return {
		get: <T>(key: string) => container.storage.get(key as never) as T | undefined,
		store: <T>(key: string, value: T) => container.storage.store(key as never, value as never),
		delete: (key: string) => container.storage.delete(key as never),
		deleteWithPrefix: (prefix: string) => {
			if (!prefix.endsWith(':')) return container.storage.deleteWithPrefix(prefix as never);

			const namespace = prefix.slice(0, -1);
			return container.storage.deleteWithPrefixCore(
				namespace as never,
				new RegExp(`^${escapeRegex(namespace)}$`),
			);
		},
		getWorkspace: <T>(key: string) => container.storage.getWorkspace(key as never) as T | undefined,
		storeWorkspace: <T>(key: string, value: T) => container.storage.storeWorkspace(key as never, value as never),
		deleteWorkspace: (key: string) => container.storage.deleteWorkspace(key as never),
		// The package emits un-prefixed secret keys (`integration.auth[.cloud]:…`); GitLens owns the
		// `gitlens.` SecretStorage namespace, so re-prepend it here. Keeps stored keys byte-identical to
		// pre-extraction (no orphaned tokens on upgrade) while the package stays prefix-agnostic.
		getSecret: (key: string) => container.storage.getSecret(`gitlens.${key}` as never),
		storeSecret: (key: string, value: string) => container.storage.storeSecret(`gitlens.${key}` as never, value),
		deleteSecret: (key: string) => container.storage.deleteSecret(`gitlens.${key}` as never),
	};
}
