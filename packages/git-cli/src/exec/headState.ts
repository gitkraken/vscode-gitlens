import { resolve as resolvePath } from 'node:path';
import type { Cache } from '@gitlens/git/cache.js';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import { FileType } from '@gitlens/git/context.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath } from '@gitlens/utils/uri.js';

/**
 * What a worktree's HEAD is on: the full name of its branch (`refs/heads/main`), `'detached'`, or `undefined` when
 * unknown — unreadable, not a branch name git allows, or a HEAD kept as a symlink to its branch
 * (`core.preferSymlinkRefs`). Reading such a HEAD follows the link to the branch's object id, as a detached HEAD
 * reads, so it is unknown when the git dir's listing flags it as a link, and `'detached'` on a host whose listing
 * doesn't.
 */
export type HeadState = { readonly branch: string } | 'detached' | undefined;

const headBranchRegex = /^ref:\s*(refs\/heads\/\S+)\s*$/;
const headShaRegex = /^(?:[0-9a-f]{40}|[0-9a-f]{64})\s*$/;
const gitFileRegex = /^gitdir:\s*(.+?)\s*$/m;

/**
 * Reads `repoPath`'s HEAD from the worktree's own `HEAD` file, without running git: read around a write, it says which
 * branch that write moved, whatever a switch outside core left in the caches. The git dir is the cached one, else the
 * one `<repoPath>/.git` is or points to, so a worktree core never registered is read without spawning git either.
 * A reftable repository's `HEAD` file holds the placeholder `refs/heads/.invalid` (its real HEAD is in the tables),
 * which is no branch name git allows, so it reads as unknown, as does a branch that is a symbolic ref to another (a
 * `master` kept pointing at `main`), since git follows it and a write moves the target. An object id is detached only
 * when the git dir's listing doesn't flag `HEAD` as a symlink (a host's `stat` may follow the link): read as detached,
 * a symlinked HEAD would say a write on its branch moved no branch. Never rejects.
 */
export async function readHeadState(repoPath: string, fs: FileSystemProvider, cache: Cache): Promise<HeadState> {
	try {
		const cached = cache.gitDir.get(repoPath);
		const gitDir =
			cached != null ? { uri: cached.uri, commonUri: cached.commonUri } : await findGitDir(repoPath, fs);
		if (gitDir == null) return undefined;

		const decoder = new TextDecoder();
		const head = decoder.decode(await fs.readFile(joinUriPath(gitDir.uri, 'HEAD')));
		if (headShaRegex.test(head)) {
			const entries = await fs.readDirectory(gitDir.uri);
			const linked = entries.some(([name, type]) => name === 'HEAD' && (type & FileType.SymbolicLink) !== 0);
			return linked ? undefined : 'detached';
		}

		const ref = headBranchRegex.exec(head)?.[1];
		if (ref == null || ref.split('/').some(part => part.startsWith('.'))) return undefined;

		// Packed refs can't hold a symbolic ref, so a missing loose file is a plain branch
		let target: string | undefined;
		try {
			target = decoder.decode(await fs.readFile(joinUriPath(gitDir.commonUri ?? gitDir.uri, ref)));
		} catch {}
		return target?.startsWith('ref:') ? undefined : { branch: ref };
	} catch {
		return undefined;
	}
}

/**
 * The path of `repoPath`'s common git dir, without running git: the cached one, else the folder `<repoPath>/.git` is,
 * or the shared one a linked worktree's `gitdir:` file leads to. `undefined` when it can't be read. Never rejects.
 */
export async function readCommonGitDir(
	repoPath: string,
	fs: FileSystemProvider,
	cache: Cache,
): Promise<string | undefined> {
	try {
		const gitDir = cache.gitDir.get(repoPath) ?? (await findGitDir(repoPath, fs));
		if (gitDir == null) return undefined;

		return (gitDir.commonUri ?? gitDir.uri).fsPath;
	} catch {
		return undefined;
	}
}

/**
 * The git dir `<repoPath>/.git` is: the folder itself, or the one a linked worktree's `gitdir:` file names, whose
 * `commondir` file names the repository's shared one
 */
async function findGitDir(
	repoPath: string,
	fs: FileSystemProvider,
): Promise<{ readonly uri: Uri; readonly commonUri: Uri | undefined } | undefined> {
	const dotGit = joinUriPath(fileUri(repoPath), '.git');
	const stat = await fs.stat(dotGit);
	if (stat == null) return undefined;
	if (stat.type & FileType.Directory) return { uri: dotGit, commonUri: undefined };

	const dir = gitFileRegex.exec(new TextDecoder().decode(await fs.readFile(dotGit)))?.[1];
	if (dir == null) return undefined;

	const gitDir = resolvePath(repoPath, dir);
	let commonDir: string | undefined;
	try {
		commonDir = new TextDecoder().decode(await fs.readFile(joinUriPath(fileUri(gitDir), 'commondir'))).trim();
	} catch {}
	return { uri: fileUri(gitDir), commonUri: commonDir ? fileUri(resolvePath(gitDir, commonDir)) : undefined };
}

/**
 * Which branch a write that moves only HEAD's branch moved, from HEAD read before and after it: that branch when HEAD
 * was on the same one both times, `'detached'` (no branch) when it was detached both times, otherwise `undefined` — a
 * hook or an outside switch moved HEAD meanwhile, or a read failed, so the moved branch is unknown.
 */
export function getMovedHead(before: HeadState, after: HeadState): HeadState {
	if (before == null || after == null) return undefined;
	if (before === 'detached') return after === 'detached' ? 'detached' : undefined;
	if (after === 'detached') return undefined;

	return before.branch === after.branch ? before : undefined;
}
