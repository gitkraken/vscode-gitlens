import { isLoggable } from '../loggable.js';

export type Resolver<T extends (...args: any[]) => any> = (...args: Parameters<T>) => string;

let _defaultResolverOverride: ((...args: unknown[]) => string) | undefined;

/**
 * Sets a custom default resolver that will be used by `defaultResolver`, `resolveProp`,
 * and all decorators that depend on them (`@gate`, `@sequentialize`, `@memoize`).
 *
 * Call this early in your application startup to inject environment-specific argument resolution
 * (e.g., handling VS Code Uri, CancellationToken, or other platform-specific types).
 */
export function setDefaultResolver(resolver: ((...args: unknown[]) => string) | undefined): void {
	_defaultResolverOverride = resolver;
}

export function resolveProp<T extends (...args: any[]) => any>(
	key: string,
	resolver: Resolver<T> | undefined,
	...args: Parameters<T>
): string {
	if (args.length === 0) return key;

	let resolved;
	if (resolver != null) {
		try {
			resolved = resolver(...args);
		} catch {
			debugger;
			resolved = defaultResolver(...args);
		}
	} else {
		resolved = defaultResolver(...args);
	}

	return `${key}$${resolved}`;
}

export function defaultResolver(...args: unknown[]): string {
	if (_defaultResolverOverride != null) return _defaultResolverOverride(...args);

	if (args.length === 0) return '';
	if (args.length > 1) return JSON.stringify(args);

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

			return JSON.stringify(arg);
	}
}
