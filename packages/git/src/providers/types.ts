import type { Uri } from '@gitlens/utils/uri.js';
import type { LineRange } from '../models/lineRange.js';

export interface DiffRange extends LineRange {
	readonly active?: 'start' | 'end';
}

export interface RevisionUri {
	/** The URI for this revision — `gitlens://` for committed/staged revisions, `file://` for working tree */
	uri: Uri;
	/** The file path (relative to repo root) */
	path: string;
	/** The revision SHA or ref */
	sha?: string;
	/** The repository path */
	repoPath: string;
}

export type GitProviderId = 'git' | 'github' | 'vsls';

export interface GitProviderDescriptor {
	readonly id: GitProviderId;
	readonly name: string;
	readonly virtual: boolean;
}

export type RepositoryVisibility = 'private' | 'public' | 'local';

export interface RepositoryVisibilityInfo {
	visibility: RepositoryVisibility;
	timestamp: number;
	remotesHash?: string;
}
