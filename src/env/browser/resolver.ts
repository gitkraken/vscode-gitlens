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

			if (isLoggable(arg)) return arg.toLoggable();

			return JSON.stringify(arg, loggingJsonReplacer);
	}
}
