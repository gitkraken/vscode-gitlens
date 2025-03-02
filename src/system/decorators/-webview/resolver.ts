import { Uri } from 'vscode';
import { loggingJsonReplacer } from '@env/json';
import { isContainer } from '../../../container';
import { isBranch } from '../../../git/models/branch';
import { isCommit } from '../../../git/models/commit';
import { isRepository } from '../../../git/models/repository';
import { isTag } from '../../../git/models/tag';
import { isViewNode } from '../../../views/nodes/utils/-webview/node.utils';

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
			if (isRepository(arg) || isBranch(arg) || isCommit(arg) || isTag(arg) || isViewNode(arg)) {
				return arg.toString();
			}
			if (isContainer(arg)) return '<container>';

			return JSON.stringify(arg, loggingJsonReplacer);
	}
}

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
