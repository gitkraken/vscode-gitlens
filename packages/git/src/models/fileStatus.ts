export declare type GitFileStatus = GitFileConflictStatus | GitFileIndexStatus | GitFileWorkingTreeStatus;

export const GitFileConflictStatus = {
	AddedByBoth: 'AA',
	AddedByUs: 'AU',
	AddedByThem: 'UA',
	DeletedByBoth: 'DD',
	DeletedByUs: 'DU',
	DeletedByThem: 'UD',
	ModifiedByBoth: 'UU',
} as const satisfies Record<string, string>;
export type GitFileConflictStatus = (typeof GitFileConflictStatus)[keyof typeof GitFileConflictStatus];

export const GitFileIndexStatus = {
	Modified: 'M',
	TypeChanged: 'T',
	Added: 'A',
	Deleted: 'D',
	Renamed: 'R',
	Copied: 'C',
	Unchanged: '.',
	Untracked: '?',
	Ignored: '!',
	UpdatedButUnmerged: 'U',
} as const satisfies Record<string, string>;
export type GitFileIndexStatus = (typeof GitFileIndexStatus)[keyof typeof GitFileIndexStatus];

export const GitFileWorkingTreeStatus = {
	Modified: 'M',
	Added: 'A',
	Deleted: 'D',
	Untracked: '?',
	Ignored: '!',
} as const satisfies Record<string, string>;
export type GitFileWorkingTreeStatus = (typeof GitFileWorkingTreeStatus)[keyof typeof GitFileWorkingTreeStatus];
