import { dirname, isAbsolute, isDescendant, joinPaths, normalizePath, relative } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';

export function getRepositoryOrWorktreePath(uri: Uri): string {
	return uri.scheme === 'file' ? normalizePath(uri.fsPath) : uri.toString();
}

export function getCommonRepositoryPath(commonUri: Uri): string {
	const uri = getCommonRepositoryUri(commonUri);
	return getRepositoryOrWorktreePath(uri);
}

export function getCommonRepositoryUri(commonUri: Uri): Uri {
	if (commonUri?.path.endsWith('/.git')) {
		return commonUri.with({ path: commonUri.path.substring(0, commonUri.path.length - 5) });
	}
	return commonUri;
}

/**
 * A path relative to the common `.git` directory that is a linked worktree's admin entry, `worktrees/<id>`, or a file
 * in it: its admin id, and the file's path within the entry (`undefined` for the entry itself)
 */
export function parseWorktreeAdminPath(
	relativePath: string,
): { readonly id: string; readonly file: string | undefined } | undefined {
	if (relativePath.length <= 10 || !relativePath.startsWith('worktrees/')) return undefined;

	const idEnd = relativePath.indexOf('/', 10);
	if (idEnd === -1) return { id: relativePath.substring(10), file: undefined };
	if (idEnd === 10) return undefined;

	return { id: relativePath.substring(10, idEnd), file: relativePath.substring(idEnd + 1) };
}

/** The admin id of the linked worktree whose git dir is `gitDirPath`: the `<id>` of `<commonGitDirPath>/worktrees/<id>` */
export function getWorktreeAdminId(gitDirPath: string, commonGitDirPath: string): string | undefined {
	if (!isDescendant(gitDirPath, commonGitDirPath)) return undefined;

	const entry = parseWorktreeAdminPath(relative(commonGitDirPath, gitDirPath));
	return entry != null && entry.file == null ? entry.id : undefined;
}

/**
 * Whether the linked worktree whose admin entry is `adminDir` lies under one of `ignoredRoots` (see
 * `GitProvider.getIgnoredWorktreeRoots`), from the content of the entry's `gitdir` file; `undefined` when that names no
 * worktree's `.git`, as when it couldn't be read
 */
export function isIgnoredWorktreeEntry(
	adminDir: string,
	gitdir: Uint8Array | undefined,
	ignoredRoots: readonly string[],
): boolean | undefined {
	// Git writes the path of the worktree's `.git` file, relative to the entry under `worktree.useRelativePaths`
	const dotGit = gitdir != null ? new TextDecoder().decode(gitdir).trim() : '';
	const dotGitPath = dotGit ? normalizePath(isAbsolute(dotGit) ? dotGit : joinPaths(adminDir, dotGit)) : '';
	if (!dotGitPath.endsWith('/.git')) return undefined;

	const worktreePath = dirname(dotGitPath);
	return ignoredRoots.some(root => isDescendant(worktreePath, root));
}
