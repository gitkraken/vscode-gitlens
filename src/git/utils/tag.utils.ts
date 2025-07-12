import type { GitReference, GitTagReference } from '../models/reference';

export function getTagId(repoPath: string, name: string): string {
	return `${repoPath}|tags/${name}`;
}

export function isOfTagRefType(tag: GitReference | undefined): tag is GitTagReference {
	return tag?.refType === 'tag';
}

const tagsPrefixRegex = /^(refs\/)?tags\//i;

export function parseRefName(refName: string): { name: string } {
	// Strip off refs/tags/
	const name = refName.replace(tagsPrefixRegex, '');
	return { name: name };
}
