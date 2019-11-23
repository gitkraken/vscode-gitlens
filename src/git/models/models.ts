'use strict';
import { Git } from '../git';

const revisionRangeRegex = /([^.]*)(\.\.\.?)([^.]*)/;

export namespace GitRevision {
	export function createRange(
		ref1: string | undefined,
		ref2: string | undefined,
		notation: '..' | '...' = '..'
	): string {
		return `${ref1 || ''}${notation}${ref2 || ''}`;
	}

	export function toParams(ref: string | undefined) {
		if (ref == null || ref.length === 0) return [];

		const match = revisionRangeRegex.exec(ref);
		if (match == null) return [ref];

		const [, ref1, notation, ref2] = match;

		const range = [];
		if (ref1) {
			range.push(ref1);
		}
		range.push(notation);
		if (ref2) {
			range.push(ref2);
		}
		return range;
	}
}

export interface GitReference {
	readonly refType: 'branch' | 'tag' | 'revision';
	name: string;
	ref: string;
}

export namespace GitReference {
	export function create(
		ref: string,
		{ name, refType }: { name?: string; refType?: 'branch' | 'tag' } = {}
	): GitReference {
		return { name: name || Git.shortenSha(ref, { force: true }), ref: ref, refType: refType || 'revision' };
	}

	export function isOfRefType(ref: GitReference | undefined, refType: 'branch' | 'tag' | 'revision' = 'revision') {
		return ref !== undefined && ref.refType === refType;
	}
}

export * from './blame';
export * from './blameCommit';
export * from './branch';
export * from './commit';
export * from './contributor';
export * from './diff';
export * from './file';
export * from './log';
export * from './logCommit';
export * from './remote';
export * from './repository';
export * from './reflog';
export * from './shortlog';
export * from './stash';
export * from './stashCommit';
export * from './status';
export * from './tag';
export * from './tree';
