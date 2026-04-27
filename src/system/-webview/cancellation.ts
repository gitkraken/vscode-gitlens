import type { CancellationToken, Disposable } from 'vscode';
import { CancellationTokenSource } from 'vscode';
import { getScopedCounter } from '@gitlens/utils/counter.js';

export class TimedCancellationSource implements CancellationTokenSource, Disposable {
	private readonly cancellation = new CancellationTokenSource();
	private readonly timer: ReturnType<typeof setTimeout>;

	constructor(timeout: number) {
		this.timer = setTimeout(() => this.cancellation.cancel(), timeout);
	}

	dispose(): void {
		clearTimeout(this.timer);
		this.cancellation.dispose();
	}

	cancel(): void {
		clearTimeout(this.timer);
		this.cancellation.cancel();
	}

	get token(): CancellationToken {
		return this.cancellation.token;
	}
}

/**
 * Converts a VS Code CancellationToken (or AbortSignal) to a standard AbortSignal.
 * If an AbortSignal is passed, it is returned as-is. Use at call sites that have a CancellationToken
 * but need to pass to sub-providers (which accept AbortSignal).
 */
export function toAbortSignal(token: CancellationToken | AbortSignal | undefined): AbortSignal | undefined {
	if (token == null) return undefined;
	if (!isCancellationToken(token)) return token;
	if (token.isCancellationRequested) return AbortSignal.abort();

	const controller = new AbortController();
	token.onCancellationRequested(() => controller.abort());
	return controller.signal;
}

/**
 * Converts an AbortSignal (or CancellationToken) to a VS Code CancellationToken.
 * If a CancellationToken is passed, it is returned as-is with a no-op `dispose`. Use at call sites
 * that have an AbortSignal but need to pass to APIs that accept CancellationToken.
 *
 * Always call `dispose()` once the operation completes to release the underlying source.
 */
export function fromAbortSignal(signal: AbortSignal | CancellationToken | undefined): {
	token: CancellationToken | undefined;
	dispose: () => void;
} {
	if (signal == null) return { token: undefined, dispose: () => {} };
	if (isCancellationToken(signal)) return { token: signal, dispose: () => {} };

	const source = new CancellationTokenSource();
	if (signal.aborted) {
		source.cancel();
		return { token: source.token, dispose: () => source.dispose() };
	}

	const onAbort = () => source.cancel();
	signal.addEventListener('abort', onAbort, { once: true });
	return {
		token: source.token,
		dispose: () => {
			signal.removeEventListener('abort', onAbort);
			source.dispose();
		},
	};
}

export function isCancellationToken(arg: unknown): arg is CancellationToken {
	return (
		typeof arg === 'object' && arg != null && 'isCancellationRequested' in arg && 'onCancellationRequested' in arg
	);
}

const cancellationWeakmap = new WeakMap<CancellationToken, number>();
const counter = getScopedCounter();

export function getCancellationTokenId(cancellation: CancellationToken | undefined): string {
	if (cancellation == null) return '';

	let id = cancellationWeakmap.get(cancellation);
	if (id == null) {
		id = counter.next();
		cancellationWeakmap.set(cancellation, id);
	}
	return String(id);
}
