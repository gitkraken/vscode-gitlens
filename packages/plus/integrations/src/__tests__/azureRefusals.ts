import { GitCloudHostIntegrationId } from '../constants.js';
import { AuthenticationError, AuthenticationErrorReason } from '../errors.js';

/**
 * Azure DevOps refusals as `throwProviderError` wraps them: an `AuthenticationError` whose `original` carries the
 * SDK adapter's `{ status, headers, body }` (see `providersApi.ts`). Unless noted, each shape was captured live
 * against dev.azure.com (#5890). Not named `*.test.ts` so the runner's glob leaves it alone.
 */
function azureRefusal(status: 401 | 403, headers: Record<string, string>, body: unknown): AuthenticationError {
	const original = Object.assign(new Error(`(${status}) ${status === 401 ? 'Unauthorized' : 'Forbidden'}.`), {
		response: {
			status: status,
			statusText: status === 401 ? 'Unauthorized' : 'Forbidden',
			headers: headers,
			body: body,
		},
	});
	return new AuthenticationError(
		{
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			microHash: undefined,
			cloud: true,
			type: 'oauth',
			scopes: [],
		},
		status === 401 ? AuthenticationErrorReason.Unauthorized : AuthenticationErrorReason.Forbidden,
		original,
	);
}

/**
 * An OAuth token, sent as Basic the way core sends it, to an organization whose "Third-party application access via
 * OAuth" policy is off. An expired token gets this exact answer too. The cookie stands in for the session cookie
 * the real response sets.
 */
export function oauthAppNotAllowed(): AuthenticationError {
	return azureRefusal(
		401,
		{
			'www-authenticate': 'Basic realm="https://tfsprodneu1.visualstudio.com/"',
			'set-cookie': 'VstsSession=secret',
		},
		'',
	);
}

/** A sound credential sent to an organization the account is not a member of. */
export function noAccess(): AuthenticationError {
	return azureRefusal(
		401,
		{ 'www-authenticate': 'TFS-Federated, Bearer' },
		{
			$id: '1',
			innerException: null,
			message:
				"TF400813: The user 'fb80544b-3a07-6095-8fcc-5e895f9d39c4' is not authorized to access this resource.",
			typeName:
				'Microsoft.TeamFoundation.Framework.Server.UnauthorizedRequestException, Microsoft.TeamFoundation.Framework.Server',
			typeKey: 'UnauthorizedRequestException',
			errorCode: 0,
			eventId: 3000,
		},
	);
}

/** A Conditional Access block. Not captured here: the shape gitkraken.dev handles (`connection-error-copy.ts`). */
export function conditionalAccess(): AuthenticationError {
	return azureRefusal(
		403,
		{},
		{
			$id: '1',
			message:
				'VS403463: The conditional access policy defined by your Azure Active Directory administrator has failed.',
		},
	);
}

/** A global PAT refused by an organization that allowlists them; only `X-TFS-ServiceError` explains it. */
export function globalPatNotAllowed(): AuthenticationError {
	return azureRefusal(
		401,
		{
			'www-authenticate': 'Basic realm="https://tfsprodwus21.app.visualstudio.com/"',
			'x-tfs-serviceerror': encodeURIComponent(
				"The organization's security policy prohibits access by global Personal Access Token (PAT) unless you are on an allowlist. Contact your organization administrator to be included on the allowlist.",
			),
		},
		'<!DOCTYPE html ><html><head><title>The organization&#39;s security policy prohibits access</title></head></html>',
	);
}

/** A 401 Azure explains with something other than `TF400813`. Not captured: stands in for any such explanation. */
export function explainedRefusal(): AuthenticationError {
	return azureRefusal(
		401,
		{},
		{ $id: '1', message: 'VS30063: You are not authorized to access https://dev.azure.com.' },
	);
}
