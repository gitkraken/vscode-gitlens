import { Uri } from 'vscode';
import { isContainer } from '../../container.js';
import { isBranch } from '../../git/models/branch.js';
import { isCommit } from '../../git/models/commit.js';
import { isRemote } from '../../git/models/remote.js';
import { isRepository } from '../../git/models/repository.js';
import { isTag } from '../../git/models/tag.js';
import { isWorktree } from '../../git/models/worktree.js';
import { getCancellationTokenId, isCancellationToken } from '../../system/-webview/cancellation.js';
import { isViewNode } from '../../views/nodes/utils/-webview/node.utils.js';
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
			if (
				isRepository(arg) ||
				isBranch(arg) ||
				isCommit(arg) ||
				isRemote(arg) ||
				isTag(arg) ||
				isWorktree(arg) ||
				isViewNode(arg)
			) {
				return arg.toString();
			}
			if (isContainer(arg)) return '<container>';
			if (isCancellationToken(arg)) return getCancellationTokenId(arg);

			return JSON.stringify(arg, loggingJsonReplacer);
	}
}
