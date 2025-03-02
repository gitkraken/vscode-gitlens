import { authentication } from 'vscode';
import { wrapForForcedInsecureSSL } from '@env/fetch';
import type { IntegrationId } from '../../../../constants.integrations';
import type { Container } from '../../../../container';
import { sequentialize } from '../../../../system/function';
import type { IntegrationAuthenticationSessionDescriptor } from '../../../integrations/authentication/integrationAuthenticationProvider';
import type { ProviderAuthenticationSession } from '../../../integrations/authentication/models';

export const getBuiltInIntegrationSession = sequentialize(
	(
		container: Container,
		id: IntegrationId,
		descriptor: IntegrationAuthenticationSessionDescriptor,
		options?:
			| { createIfNeeded: true; silent?: never; forceNewSession?: never }
			| { createIfNeeded?: never; silent: true; forceNewSession?: never }
			| { createIfNeeded?: never; silent?: never; forceNewSession: true },
	): Promise<ProviderAuthenticationSession | undefined> =>
		wrapForForcedInsecureSSL(
			container.integrations.ignoreSSLErrors({ id: id, domain: descriptor.domain }),
			async () => {
				const session = await authentication.getSession(id, descriptor.scopes, {
					createIfNone: options?.createIfNeeded,
					silent: options?.silent,
					forceNewSession: options?.forceNewSession,
				});
				if (session == null) return undefined;

				return {
					...session,
					cloud: false,
					domain: descriptor.domain,
				};
			},
		),
);
