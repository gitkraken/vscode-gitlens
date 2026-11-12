import { resolve as resolvePath } from 'node:path';
import type { Cache } from '@gitlens/git/cache.js';
import type { FileSystemProvider } from '@gitlens/git/context.js';
import { FileType } from '@gitlens/git/context.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath } from '@gitlens/utils/uri.js';
import { parseCommonDir, parseGitFile } from './gitDirResolver.js';

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
		const gitDir = await resolveGitDir(repoPath, fs, cache);
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
 * A stamp of `repoPath`'s `HEAD` file — its modification and change times and size — read without running git, or
 * `undefined` when it can't be read. Git rewrites `HEAD` by writing `HEAD.lock` and renaming it over `HEAD` (a checkout
 * or a rebase), which changes the stamp; a commit, merge or fast-forward moves the branch `HEAD` names and leaves the
 * file be, so a stamp that differs between two reads says a write rewrote the file. Never rejects.
 */
export async function readHeadStamp(
	repoPath: string,
	fs: FileSystemProvider,
	cache: Cache,
): Promise<string | undefined> {
	try {
		const gitDir = await resolveGitDir(repoPath, fs, cache);
		if (gitDir == null) return undefined;

		const stat = await fs.stat(joinUriPath(gitDir.uri, 'HEAD'));
		return stat != null ? `${stat.mtime}:${stat.ctime}:${stat.size}` : undefined;
	} catch {
		return undefined;
	}
}

/** What `repoPath`'s HEAD is on and the stamp of its file, read together (see {@link readHeadState}, {@link readHeadStamp}) */
export interface HeadSnapshot {
	readonly state: HeadState;
	readonly stamp: string | undefined;
}

/** Reads `repoPath`'s HEAD and its file's stamp concurrently. Never rejects. */
export async function readHeadSnapshot(repoPath: string, fs: FileSystemProvider, cache: Cache): Promise<HeadSnapshot> {
	const [state, stamp] = await Promise.all([readHeadState(repoPath, fs, cache), readHeadStamp(repoPath, fs, cache)]);
	return { state: state, stamp: stamp };
}

/**
 * How a write changed HEAD, from {@link HeadSnapshot}s read before and after it: `detached` when HEAD was on a branch
 * and is on none now (a rebase stopped partway), `rewrote` when it stayed on a branch and the file was rewritten (a
 * rebase that finished replays its commits with HEAD detached, then points it back). Each is `false` when a read
 * failed, so a write is announced no more than one that left HEAD be would be.
 */
export function getHeadWrite(
	before: HeadSnapshot,
	after: HeadSnapshot,
): { readonly detached: boolean; readonly rewrote: boolean } {
	const detached = before.state != null && before.state !== 'detached' && after.state === 'detached';
	const rewrote = !detached && before.stamp != null && after.stamp != null && before.stamp !== after.stamp;
	return { detached: detached, rewrote: rewrote };
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

async function resolveGitDir(
	repoPath: string,
	fs: FileSystemProvider,
	cache: Cache,
): Promise<{ readonly uri: Uri; readonly commonUri: Uri | undefined } | undefined> {
	const cached = cache.gitDir.get(repoPath);
	return cached != null ? { uri: cached.uri, commonUri: cached.commonUri } : findGitDir(repoPath, fs);
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

	const dir = parseGitFile(new TextDecoder().decode(await fs.readFile(dotGit)));
	if (dir == null) return undefined;

	const gitDir = resolvePath(repoPath, dir);
	let commonDir: string | undefined;
	try {
		commonDir = parseCommonDir(
			new TextDecoder().decode(await fs.readFile(joinUriPath(fileUri(gitDir), 'commondir'))),
		);
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
