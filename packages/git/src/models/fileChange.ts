import { loggable } from '@gitlens/utils/decorators/log.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { DiffRange } from '../providers/types.js';
import type { GitFileStatus } from './fileStatus.js';
import { GitFileConflictStatus } from './fileStatus.js';

export interface GitFileChangeShape {
	readonly repoPath: string;
	readonly path: string;
	readonly status: GitFileStatus;

	readonly originalPath?: string | undefined;
	readonly staged?: boolean;

	/** Git file mode (e.g., 100644=regular, 100755=executable, 120000=symlink, 160000=submodule) */
	readonly mode?: string | undefined;
	/** For submodule (gitlink) entries, contains the submodule's commit SHAs */
	readonly submodule?: { readonly oid: string; readonly previousOid?: string } | undefined;
}

@loggable(i => i.path)
export class GitFileChange implements GitFileChangeShape {
	private readonly _uri: Uri;
	private readonly _originalUri: Uri | undefined;

	constructor(
		public readonly repoPath: string,
		public readonly path: string,
		public readonly status: GitFileStatus,
		uri: Uri,
		public readonly originalPath?: string | undefined,
		originalUri?: Uri | undefined,
		public readonly previousSha?: string | undefined,
		public readonly stats?: GitFileChangeStats | undefined,
		public readonly staged?: boolean,
		public readonly range?: DiffRange | undefined,
		public readonly mode?: string | undefined,
		public readonly submodule?: { readonly oid: string; readonly previousOid?: string } | undefined,
	) {
		this._uri = uri;
		this._originalUri = originalUri;
	}

	get hasConflicts(): boolean {
		switch (this.status) {
			case GitFileConflictStatus.AddedByThem:
			case GitFileConflictStatus.AddedByUs:
			case GitFileConflictStatus.AddedByBoth:
			case GitFileConflictStatus.DeletedByThem:
			case GitFileConflictStatus.DeletedByUs:
			case GitFileConflictStatus.DeletedByBoth:
			case GitFileConflictStatus.ModifiedByBoth:
				return true;

			default:
				return false;
		}
	}

	/** Indicates this is a submodule (gitlink) rather than a regular file */
	get isSubmodule(): boolean {
		return this.submodule != null;
	}

	get uri(): Uri {
		return this._uri;
	}

	get originalUri(): Uri | undefined {
		return this._originalUri;
	}

	static is(file: unknown): file is GitFileChange {
		return file instanceof GitFileChange;
	}
}

export interface GitFileChangeStats {
	additions: number;
	deletions: number;
	changes: number;
}
