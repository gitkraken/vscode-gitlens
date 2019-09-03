'use strict';

import { Git } from '../git';

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
