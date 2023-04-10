import { Uri } from 'vscode';
import { isContainer } from '../../container';
import { isBranch } from '../../git/models/branch';
import { isCommit } from '../../git/models/commit';
import { isTag } from '../../git/models/tag';
import { isViewNode } from '../../views/nodes/viewNode';

function replacer(key: string, value: any): any {
	if (key === '') return value;

	if (value == null) return value;
	if (typeof value !== 'object') return value;

	if (value instanceof Error) return String(value);
	if (value instanceof Uri) {
		if ('sha' in (value as any) && (value as any).sha) {
			return `${(value as any).sha}:${value.toString()}`;
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
	if (args.length !== 1) {
		return JSON.stringify(args, replacer);
	}

	const arg0 = args[0];
	if (arg0 == null) return '';
	switch (typeof arg0) {
		case 'string':
			return arg0;

		case 'number':
		case 'boolean':
		case 'undefined':
		case 'symbol':
		case 'bigint':
			return String(arg0);

		default:
			if (arg0 instanceof Error) return String(arg0);
			if (arg0 instanceof Uri) {
				if ('sha' in arg0 && typeof arg0.sha === 'string' && arg0.sha) {
					return `${arg0.sha}:${arg0.toString()}`;
				}
				return arg0.toString();
			}
			if (isBranch(arg0) || isCommit(arg0) || isTag(arg0) || isViewNode(arg0)) {
				return arg0.toString();
			}
			if (isContainer(arg0)) return '<container>';

			return JSON.stringify(arg0, replacer);
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
