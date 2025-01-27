import type { GitReference, GitTagReference } from '../models/reference';

export function getTagId(repoPath: string, name: string): string {
	return `${repoPath}|tag/${name}`;
}

export function isOfTagRefType(tag: GitReference | undefined): tag is GitTagReference {
	return tag?.refType === 'tag';
}
