import { authentication, extensions } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch.js';
import type { IntegrationIds } from '../../../../constants.integrations.js';
import type { Container } from '../../../../container.js';
import { sequentialize } from '../../../../system/function.js';
import { getScopedLogger, maybeStartLoggableScope } from '../../../../system/logger.scope.js';
import type { IntegrationAuthenticationSessionDescriptor } from '../../../integrations/authentication/integrationAuthenticationProvider.js';
import type { ProviderAuthenticationSession } from '../../../integrations/authentication/models.js';

const failedAuthProviderIds = new Set<string>();

export const getBuiltInIntegrationSession = sequentialize(
	(
		container: Container,
		id: IntegrationIds,
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?:
			| { createIfNeeded: true; silent?: never; forceNewSession?: never }
			| { createIfNeeded?: never; silent: true; forceNewSession?: never }
			| { createIfNeeded?: never; silent?: never; forceNewSession: true },
	): Promise<ProviderAuthenticationSession | undefined> =>
		wrapForForcedInsecureSSL(
			container.integrations.ignoreSSLErrors({ id: id, domain: descriptor.domain }),
			async () => {
				if (failedAuthProviderIds.has(id)) return undefined;

				using scope = getScopedLogger() ?? maybeStartLoggableScope(`getBuiltInIntegrationSession(${id})`);

				if (id === 'github') {
					const extension = extensions.getExtension('vscode.github-authentication');
					if (extension == null) {
						failedAuthProviderIds.add(id);
						scope?.warn(`Authentication provider '${id}' is not registered; User has disabled it`);
						return undefined;
					}
				}

				try {
					const session = await authentication.getSession(id, descriptor.scopes, {
						createIfNone: options?.createIfNeeded,
						silent: options?.silent,
						forceNewSession: options?.forceNewSession,
					});
					if (session == null) return undefined;

					return {
						...session,
						cloud: false,
						type: undefined,
						domain: descriptor.domain,
					};
				} catch (ex) {
					if (typeof ex === 'string' && ex === 'Timed out waiting for authentication provider to register') {
						failedAuthProviderIds.add(id);
						scope?.warn(`Authentication provider '${id}' is not registered; User likely has disabled it`);
						return undefined;
					}

					scope?.error(ex);
					throw ex;
				}
			},
		),
);
