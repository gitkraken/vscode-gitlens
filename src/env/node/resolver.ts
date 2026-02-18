import { Uri } from 'vscode';
import { getCancellationTokenId, isCancellationToken } from '../../system/-webview/cancellation.js';
import { isLoggable } from '../../system/loggable.js';
import { loggingJsonReplacer } from './json.js';

export function defaultResolver(...args: unknown[]): string {
	if (args.length === 0) return '';
	if (args.length > 1) return JSON.stringify(args, loggingJsonReplacer);

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

			return JSON.stringify(arg, loggingJsonReplacer);
	}
}
