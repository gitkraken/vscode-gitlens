import { CancellationError } from '@gitlens/utils/cancellation.js';

export function toCancellationError(ex: unknown): unknown {
	return ex instanceof Error && ex.name === 'AbortError' ? new CancellationError(ex) : ex;
}
