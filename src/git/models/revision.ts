export const deletedOrMissing = '0000000000000000000000000000000000000000-';
export const uncommitted = '0000000000000000000000000000000000000000';
export const uncommittedStaged = '0000000000000000000000000000000000000000:';

export type GitRevisionRange =
	| `${'..' | '...'}${string}`
	| `${string}${'..' | '...'}`
	| `${string}${'..' | '...'}${string}`;
