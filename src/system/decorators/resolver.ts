import { Uri } from 'vscode';
import { isContainer } from '../../container';
import { isBranch } from '../../git/models/branch';
import { isCommit } from '../../git/models/commit';
import { isTag } from '../../git/models/tag';
import { isViewNode } from '../../views/nodes/abstract/viewNode';

function replacer(key: string, value: any): any {
	if (key === '' || value == null || typeof value !== 'object') return value;

	if (value instanceof Error) return String(value);
	if (value instanceof Uri) {
		if ('sha' in value && typeof value.sha === 'string' && value.sha) {
			return `${value.sha}:${value.toString()}`;
		}
		return value.toString();
	}
	if (isBranch(value) || isCommit(value) || isTag(value) || isViewNode(value)) {
		return value.toString();
	}
	if (isContainer(value)) return '<container>';

	return value;
}

export function defaultResolver(...args: any[]): string {
	if (args.length === 0) return '';
	if (args.length > 1) return JSON.stringify(args, replacer);

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
			if (isBranch(arg) || isCommit(arg) || isTag(arg) || isViewNode(arg)) {
				return arg.toString();
			}
			if (isContainer(arg)) return '<container>';

			return JSON.stringify(arg, replacer);
	}
}

export type Resolver<T extends (...arg: any) => any> = (...args: Parameters<T>) => string;

export function resolveProp<T extends (...arg: any) => any>(
	key: string,
	resolver: Resolver<T> | undefined,
	...args: Parameters<T>
) {
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
