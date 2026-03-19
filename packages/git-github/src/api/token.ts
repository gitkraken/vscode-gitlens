/**
 * Simplified token info for the library.
 * The extension bridges from its `TokenWithInfo` (which depends on `IntegrationIds`)
 * to this VS Code-free representation.
 */
export interface GitHubTokenInfo {
	readonly providerId: string;
	readonly accessToken: string;
	/** First 3 chars of md5 hash of the token (for logging). */
	readonly microHash?: string;
	readonly cloud: boolean;
	readonly type: string | undefined;
	readonly scopes?: readonly string[];
	readonly expiresAt?: Date;
}
