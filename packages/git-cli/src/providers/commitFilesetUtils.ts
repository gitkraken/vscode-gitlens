import type { GitCommitFileset } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri, joinUriPath } from '@gitlens/utils/uri.js';
import type { ParsedCommit, ParsedStash, ParsedStashWithFiles } from '../parsers/logParser.js';

export function createCommitFileset(
	c: ParsedCommit | ParsedStash | ParsedStashWithFiles,
	repoPath: string,
	pathspec: string | undefined,
): GitCommitFileset {
	// If the files are missing or it's a merge commit without files or pathspec, then consider the files unloaded
	if (c.files == null || (!c.files.length && pathspec == null && c.parents.includes(' '))) {
		return {
			files: undefined,
			filtered: pathspec ? { files: undefined, pathspec: pathspec } : undefined,
		};
	}

	const repoUri = fileUri(normalizePath(repoPath));
	const files = c.files.map(
		f =>
			new GitFileChange(
				repoPath,
				f.path,
				f.status as GitFileStatus,
				joinUriPath(repoUri, normalizePath(f.path)),
				f.originalPath,
				f.originalPath != null ? joinUriPath(repoUri, normalizePath(f.originalPath)) : undefined,
				undefined,
				f.additions != null || f.deletions != null
					? { additions: f.additions ?? 0, deletions: f.deletions ?? 0, changes: 0 }
					: undefined,
				undefined,
				f.range
					? { startLine: f.range.startLine, startCharacter: 1, endLine: f.range.endLine, endCharacter: 1 }
					: undefined,
				f.mode,
				f.oid ? { oid: f.oid, previousOid: f.previousOid } : undefined,
			),
	);

	return pathspec ? { files: undefined, filtered: { files: files, pathspec: pathspec } } : { files: files };
}
