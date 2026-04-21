import type { Uri } from '@gitlens/utils/uri.js';
import type {
	GitDiff,
	GitDiffFiles,
	GitDiffFilter,
	GitDiffShortStat,
	ParsedGitDiff,
	ParsedGitDiffHunks,
} from '../models/diff.js';
import type { GitFile } from '../models/file.js';
import type { GitRevisionRange, GitRevisionRangeNotation } from '../models/revision.js';
import type { DisposableTemporaryGitIndex } from './staging.js';
import type { DiffRange, RevisionUri } from './types.js';

export interface NextComparisonUrisResult {
	current: RevisionUri;
	next: RevisionUri | undefined;
	deleted?: boolean | undefined;
}

export interface PreviousComparisonUrisResult {
	current: RevisionUri;
	previous: RevisionUri | undefined;
}

export interface PreviousRangeComparisonUrisResult extends PreviousComparisonUrisResult {
	range: DiffRange;
}

export interface GitDiffSubProvider {
	getChangedFilesCount(
		repoPath: string,
		to?: string,
		from?: string,
		options?: { uris?: (string | Uri)[]; includeUntracked?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitDiffShortStat | undefined>;
	getDiff?(
		repoPath: string,
		to: string,
		from?: string,
		options?: {
			context?: number;
			index?: DisposableTemporaryGitIndex;
			notation?: GitRevisionRangeNotation;
			uris?: (string | Uri)[];
		},
		cancellation?: AbortSignal,
	): Promise<GitDiff | undefined>;
	/**
	 * Runs `git diff` and returns the fully parsed structure (files with hunks together) in a
	 * single call. Equivalent to `getDiff` followed by `parseGitDiff` on the resulting contents.
	 *
	 * For rendering-friendly line ordering, split each `hunk.content` on newlines and read the
	 * `+`/`-`/` ` prefix on each line.
	 */
	getParsedDiff?(
		repoPath: string,
		to: string,
		from?: string,
		options?: {
			context?: number;
			notation?: GitRevisionRangeNotation;
			uris?: (string | Uri)[];
		},
		cancellation?: AbortSignal,
	): Promise<ParsedGitDiff | undefined>;
	getDiffFiles?(repoPath: string, contents: string, cancellation?: AbortSignal): Promise<GitDiffFiles | undefined>;
	getDiffStatus(
		repoPath: string,
		ref1OrRange: string | GitRevisionRange,
		ref2?: string,
		options?: {
			filters?: GitDiffFilter[];
			includeUntracked?: boolean;
			path?: string;
			renameLimit?: number;
			similarityThreshold?: number;
		},
	): Promise<GitFile[] | undefined>;
	getDiffTool?(repoPath?: string): Promise<string | undefined>;
	getNextComparisonUris(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
		skip?: number,
		options?: { ordering?: 'date' | 'author-date' | 'topo' | null },
		cancellation?: AbortSignal,
	): Promise<NextComparisonUrisResult | undefined>;
	getPreviousComparisonUris(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
		skip?: number,
		unsaved?: boolean,
		options?: { ordering?: 'date' | 'author-date' | 'topo' | null },
		cancellation?: AbortSignal,
	): Promise<PreviousComparisonUrisResult | undefined>;
	getPreviousComparisonUrisForRange(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
		range: DiffRange,
		options?: { ordering?: 'date' | 'author-date' | 'topo' | null; skipFirstRev?: boolean },
		cancellation?: AbortSignal,
	): Promise<PreviousRangeComparisonUrisResult | undefined>;
	openDiffTool?(
		repoPath: string,
		pathOrUri: string | Uri,
		options?: {
			ref1?: string | undefined;
			ref2?: string | undefined;
			staged?: boolean | undefined;
			tool?: string | undefined;
		},
	): Promise<void>;
	openDirectoryCompare?(repoPath: string, ref1: string, ref2?: string, tool?: string): Promise<void>;

	getDiffForFile?(
		repoPath: string,
		path: string,
		ref1: string | undefined,
		ref2?: string,
		options?: { encoding?: string },
	): Promise<ParsedGitDiffHunks | undefined>;
	getDiffForFileContents?(
		repoPath: string,
		path: string,
		ref: string,
		contents: string,
		options?: { encoding?: string },
	): Promise<ParsedGitDiffHunks | undefined>;
}
