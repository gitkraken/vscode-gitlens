export const deletedOrMissing = '0000000000000000000000000000000000000000-';
export const uncommitted = '0000000000000000000000000000000000000000';
export const uncommittedStaged = '0000000000000000000000000000000000000000:';
// This is a root sha of all git repo's if using sha1
export const rootSha = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export type GitRevisionRange =
	| `${GitRevisionRangeNotation}${string}`
	| `${string}${GitRevisionRangeNotation}`
	| `${string}${GitRevisionRangeNotation}${string}`;

export type GitRevisionRangeNotation = '..' | '...';
