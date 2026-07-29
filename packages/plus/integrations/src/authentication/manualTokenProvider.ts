// Convenience for "manual token" auth — when a consumer already has an access
// token (CLI flag, env var, secret manager) and just wants the package to use
// it without an OAuth dance. Wire it into the manager via the
// `createAuthenticationProvider` hook:
//
//   const manager = createIntegrationManager({
//       ...runtime,
//       hooks: {
//           createAuthenticationProvider: async ({ id }) =>
//               id === GitCloudHostIntegrationId.GitHub
//                   ? createManualTokenAuthProvider({
//                         id: id,
//                         token: process.env.GITHUB_TOKEN!,
//                         account: { id: 'me', label: 'CLI Token' },
//                     })
//                   : undefined,
//       },
//   });
//
// The provider is intentionally minimal — sessions are non-cancellable, never
// expire, and persist for the lifetime of the manager. For OAuth flows or
// refreshable tokens, implement `IntegrationAuthenticationProvider` yourself.

import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { IntegrationIds } from '../constants.js';
import type {
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationSessionDescriptor,
} from './integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from './models.js';

export interface ManualTokenAuthProviderOptions {
	readonly id: IntegrationIds;
	readonly token: string;
	readonly account: { readonly id: string; readonly label: string };
	readonly scopes?: readonly string[];
	readonly domain?: string;
	readonly cloud?: boolean;
	readonly appKey?: string;
}

export function createManualTokenAuthProvider(
	options: ManualTokenAuthProviderOptions,
): IntegrationAuthenticationProvider {
	const onDidChange = new Emitter<void>();
	const session: ProviderAuthenticationSession = {
		id: `manual:${options.id}`,
		accessToken: options.token,
		account: options.account,
		scopes: options.scopes ?? [],
		cloud: options.cloud ?? true,
		type: undefined,
		domain: options.domain ?? '',
		appKey: options.appKey,
	};

	return {
		get onDidChange(): Event<void> {
			return onDidChange.event;
		},
		getSession: (
			descriptor: IntegrationAuthenticationSessionDescriptor,
			options?: Parameters<IntegrationAuthenticationProvider['getSession']>[1],
		) =>
			// A manual token represents only the implicit primary connection. It cannot prove that an
			// arbitrary connection selector owns the token, so fail closed instead of leaking it across
			// accounts. Empty legacy selectors still resolve as primary.
			//
			// It also can't be refreshed; on a forced new session, return undefined rather than handing
			// back the same likely-rejected token and looping a reauthenticate-on-failure flow.
			Promise.resolve(
				options?.forceNewSession || (descriptor.connectionId?.length ?? 0) > 0 ? undefined : session,
			),
		deleteSession: () => Promise.resolve(),
		deleteAllSessions: () => Promise.resolve(),
		dispose: () => onDidChange.dispose(),
	};
}
