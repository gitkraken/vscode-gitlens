/**
 * Per-connection recovery state for a cloud token the provider REFUSED — a revoked grant, retired scopes, an
 * app removed from the org. A purely predictive refresh (`expiresIn < 60`) cannot see that case, because the
 * backend still believes the token is valid, so without this the refused token is re-sent on every read and
 * the failure only clears when the user reconnects by hand.
 *
 * One recovery refresh per connection, then the connection is the failure budget's problem:
 * - {@link recordRejection} on an `AuthenticationError` — arms the refresh, or reports that the rejection is
 *   not recoverable so the caller counts it as a real failure instead.
 * - {@link claimRefresh} before the next read resolves its session — spends the rejection, so the refresh
 *   fires once and no further read of that connection asks the cloud again.
 *
 * Deliberately NOT re-armed when the refresh hands back a different token. The GK cloud mints a new access
 * token on every `/refresh`, so a credential the provider refuses for a reason a refresh cannot fix (retired
 * scopes being the plain case) would look "rotated" on each attempt: re-arming on that would refresh on every
 * read forever and the failure budget — the thing that disconnects and prompts a reconnect — would never
 * advance. What resets this instead is {@link clear}, called by every path that replaces or removes the stored
 * tokens; a connection that is simply working never reaches here at all.
 */
export class RejectedTokenTracker {
	private readonly _rejections = new Map<string, 'armed' | 'spent'>();

	/**
	 * Whether a read of `connectionId` must force the cloud refresh of a token known to be refused, spending
	 * the rejection so the refresh runs at most once. Spent here rather than after the read because a resolve
	 * that throws must not leave the refresh armed and ask the cloud again on the next read.
	 */
	claimRefresh(connectionId: string): boolean {
		if (this._rejections.get(connectionId) !== 'armed') return false;

		this._rejections.set(connectionId, 'spent');
		return true;
	}

	/**
	 * Arms the recovery refresh for `connectionId`. Returns `false` once this connection has had its refresh
	 * (or already has one pending), so the caller falls back to its own failure handling: a token still
	 * refused after the refresh is not self-healing, and only the failure budget ends in a reconnect prompt.
	 */
	recordRejection(connectionId: string): boolean {
		if (this._rejections.has(connectionId)) return false;

		this._rejections.set(connectionId, 'armed');
		return true;
	}

	/** Drops all state, for when the stored tokens a rejection could name are replaced or gone. */
	clear(): void {
		this._rejections.clear();
	}

	/** Whether any connection is holding a rejection. For assertions; the read path uses {@link claimRefresh}. */
	get empty(): boolean {
		return this._rejections.size === 0;
	}
}
