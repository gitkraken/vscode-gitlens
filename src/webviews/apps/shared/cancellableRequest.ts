/**
 * Manages a single cancellable RPC request slot.
 *
 * Calling `run()` aborts any previous in-flight request and runs the new one.
 * The AbortSignal is sent to the backend via supertalk's AbortSignalHandler,
 * enabling cooperative cancellation of expensive operations.
 *
 * Lifecycle:
 * - New request: previous controller is aborted (sends 'abort' to receiver)
 * - Request completes: controller is aborted with 'completed' (sends 'release')
 * - Request cancelled: returns `undefined` to the caller
 *
 * Usage:
 * ```typescript
 * private _commitRequest = new CancellableRequest();
 *
 * async fetchCommit(repoPath: string, sha: string): Promise<void> {
 *   const result = await this._commitRequest.run(signal =>
 *     this.services.git.getCommit(repoPath, sha, signal),
 *   );
 *   if (result == null) return; // cancelled
 *   state.currentCommit.set(result.value);
 * }
 * ```
 */
export class CancellableRequest {
	private _controller?: AbortController;

	/** Cancel any in-flight request. */
	cancel(): void {
		this._controller?.abort();
	}

	/**
	 * Run an async operation with automatic cancellation support.
	 *
	 * - Aborts any previous in-flight call (sends 'abort' to receiver)
	 * - Passes a fresh AbortSignal to `fn`
	 * - Returns `{ value }` on success, `undefined` if cancelled
	 * - Re-throws non-cancellation errors
	 * - Sends 'release' to receiver on normal completion (automatic cleanup)
	 */
	async run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<{ value: T } | undefined> {
		this._controller?.abort();
		const controller = new AbortController();
		this._controller = controller;
		try {
			const value = await fn(controller.signal);
			if (controller.signal.aborted) return undefined;
			return { value: value };
		} catch (ex) {
			if (controller.signal.aborted) return undefined;
			throw ex;
		} finally {
			// Only send 'release' if this is still the current controller
			// and it hasn't been aborted by a newer request
			if (this._controller === controller && !controller.signal.aborted) {
				controller.abort('completed');
			}
		}
	}
}
