import { Uri } from 'vscode';
import { isContainer } from '../../container';
import { isBranch } from '../../git/models/branch';
import { isCommit } from '../../git/models/commit';
import { isRepository } from '../../git/models/repository';
import { isTag } from '../../git/models/tag';
import { isViewNode } from '../../views/nodes/abstract/viewNode';

export function loggingJsonReplacer(key: string, value: unknown): unknown {
	if (key === '' || value == null || typeof value !== 'object') return value;
	if (key.startsWith('_')) return undefined;

	if (value instanceof Error) return String(value);
	if (value instanceof Uri) {
		if ('sha' in value && typeof value.sha === 'string' && value.sha) {
			return `${value.sha}:${value.toString()}`;
		}
		return value.toString();
	}
	if (isRepository(value) || isBranch(value) || isCommit(value) || isTag(value) || isViewNode(value)) {
		return value.toString();
	}
	if (isContainer(value)) return '<container>';

	return value;
}

export function serializeJsonReplacer(this: any, key: string, value: unknown): unknown {
	if (value instanceof Date) return value.getTime();
	if (value instanceof Map || value instanceof Set) return [...value.entries()];
	if (value instanceof Function || value instanceof Error) return undefined;
	if (value instanceof RegExp) return value.toString();
	if (value instanceof Uri) return value.toString();
	if (isContainer(value)) return undefined;

	const original = this[key];
	return original instanceof Date ? original.getTime() : original instanceof Uri ? original.toString() : value;
}
