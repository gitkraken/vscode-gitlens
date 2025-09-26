import { loggingJsonReplacer } from './json';

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

			// In webview context, we can't import VSCode modules or complex GitLens models
			// So we provide a simplified resolver that handles basic types
			if (arg && typeof arg === 'object') {
				// Check for common object patterns without importing specific types
				if ('toString' in arg && typeof arg.toString === 'function') {
					try {
						// eslint-disable-next-line @typescript-eslint/no-base-to-string
						const stringified = String(arg);
						// Avoid circular references and overly long strings
						if (stringified !== '[object Object]' && stringified.length < 1000) {
							return stringified;
						}
					} catch {
						// Fall through to JSON.stringify
					}
				}
			}

			return JSON.stringify(arg, loggingJsonReplacer);
	}
}
