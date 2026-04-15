import { Uri } from 'vscode';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import { isLoggable } from '@gitlens/utils/loggable.js';
import { getCancellationTokenId, isCancellationToken } from '../../system/-webview/cancellation.js';
import { loggingJsonReplacer } from './json.js';

export function defaultResolver(...args: unknown[]): string {
	if (args.length === 0) return '';
	if (args.length > 1) return safeStringify(args);

	const [arg] = args;
	if (arg == null) return '';

	switch (typeof arg) {
		case 'string':
			return arg;

		case 'number':
		case 'boolean':
		case 'undefined':
		case 'symbol':
		case 'bigint':
			return String(arg);

		default:
			if (arg instanceof Error) return String(arg);
			if (arg instanceof Uri) {
				if ('sha' in arg && typeof arg.sha === 'string' && arg.sha) {
					return `${arg.sha}:${arg.toString()}`;
				}
				return arg.toString();
			}
			if (isCancellationToken(arg)) return getCancellationTokenId(arg);

			if (isLoggable(arg)) return arg.toLoggable();

			return safeStringify(arg);
	}
}

const _fallbackCounter = getScopedCounter();
const _objectIds = new WeakMap<object, number>();

/**
 * JSON.stringify with protection against RangeError from objects
 * that serialize beyond JavaScript's string length limit.
 * Returns a stable identity per object via WeakMap.
 */
function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, loggingJsonReplacer);
	} catch (ex) {
		if (ex instanceof RangeError) {
			if (value != null && typeof value === 'object') {
				let id = _objectIds.get(value);
				if (id == null) {
					id = _fallbackCounter.next();
					_objectIds.set(value, id);
				}
				return `#${id}`;
			}
			return `#${_fallbackCounter.next()}`;
		}
		throw ex;
	}
}
