import { defaultResolver } from '@env/resolver';

export type Resolver<T extends (...arg: any) => any> = (...args: Parameters<T>) => string;

export function resolveProp<T extends (...arg: any) => any>(
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
			resolved = defaultResolver(...(args as any));
		}
	} else {
		resolved = defaultResolver(...(args as any));
	}

	return `${key}$${resolved}`;
}
