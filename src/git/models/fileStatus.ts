export declare type GitFileStatus = GitFileConflictStatus | GitFileIndexStatus | GitFileWorkingTreeStatus;

export const enum GitFileConflictStatus {
	AddedByBoth = 'AA',
	AddedByUs = 'AU',
	AddedByThem = 'UA',
	DeletedByBoth = 'DD',
	DeletedByUs = 'DU',
	DeletedByThem = 'UD',
	ModifiedByBoth = 'UU',
}

export const enum GitFileIndexStatus {
	Modified = 'M',
	TypeChanged = 'T',
	Added = 'A',
	Deleted = 'D',
	Renamed = 'R',
	Copied = 'C',
	Unchanged = '.',
	Untracked = '?',
	Ignored = '!',
	UpdatedButUnmerged = 'U',
}

export const enum GitFileWorkingTreeStatus {
	Modified = 'M',
	Added = 'A',
	Deleted = 'D',
	Untracked = '?',
	Ignored = '!',
}
