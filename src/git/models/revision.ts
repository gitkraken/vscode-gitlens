export const deletedOrMissing = '0000000000000000000000000000000000000000-';
export const uncommitted = '0000000000000000000000000000000000000000';
export const uncommittedStaged = '0000000000000000000000000000000000000000:';

export type GitRevisionRange =
	| `${GitRevisionRangeNotation}${string}`
	| `${string}${GitRevisionRangeNotation}`
	| `${string}${GitRevisionRangeNotation}${string}`;

export type GitRevisionRangeNotation = '..' | '...';
