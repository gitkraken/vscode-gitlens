import type { GitHubSession } from '../context.js';
import type { GitHubTokenInfo } from './token.js';

/**
 * Converts a {@link GitHubSession} to a {@link GitHubTokenInfo} suitable for API calls.
 */
export function toTokenInfo(providerId: string, session: GitHubSession): GitHubTokenInfo {
	return {
		providerId: providerId,
		accessToken: session.accessToken,
		cloud: session.cloud,
		type: session.type,
		scopes: session.scopes,
	};
}
