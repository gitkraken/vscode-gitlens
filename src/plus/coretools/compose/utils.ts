import type { CancellationToken } from 'vscode';

/**
 * Centralized value re-exports from `@gitkraken/compose-tools`.
 *
 * Consumers across GitLens should import compose-tools functions FROM HERE, not directly
 * from the upstream package. Pair with `./types.js` for type-only re-exports.
 *
 * Note: re-exporting these from this file pulls compose-tools' Node-only runtime into
 * the importing module. Worker-bundle code paths must NOT value-import from here —
 * they should rely on `./types.js` (type-only) instead.
 */
export { applyComposePlan, composePlan, undoCompose, validateUndoCompose } from '@gitkraken/compose-tools';

/**
 * Convert a VS Code `CancellationToken` to an `AbortSignal` the compose-tools
 * library and adapter ops understand. The signal aborts when the token is cancelled.
 */
export function cancellationTokenToSignal(token: CancellationToken | undefined): AbortSignal | undefined {
	if (!token) return undefined;
	const controller = new AbortController();
	if (token.isCancellationRequested) {
		controller.abort();
	} else {
		token.onCancellationRequested(() => controller.abort());
	}
	return controller.signal;
}
