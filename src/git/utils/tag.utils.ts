import type { GitReference } from '../models/reference';

export function getTagId(repoPath: string, name: string): string {
	return `${repoPath}|tag/${name}`;
}

export function isOfTagRefType(tag: GitReference | undefined) {
	return tag?.refType === 'tag';
}
