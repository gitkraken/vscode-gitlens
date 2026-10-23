import type { FileSystemProvider } from '@gitlens/git/context.js';
import type { GitDir } from '@gitlens/git/models/repository.js';
import { joinUriPath } from '@gitlens/utils/uri.js';

/**
 * What a worktree's own `HEAD` file says: the branch it is on (`ref` is the full name, `refs/heads/main`), a detached
 * HEAD (the file holds a bare object id), or `unknown` for anything else (unreadable, a reftable repository's
 * placeholder `refs/heads/.invalid`, whose real HEAD is in the tables, or a branch that is itself a symbolic ref to
 * another, such as a `master` kept pointing at `main`)
 */
export type HeadFileState =
	| { readonly kind: 'branch'; readonly ref: string }
	| { readonly kind: 'detached' }
	| { readonly kind: 'unknown' };

const branchHeadRegex = /^ref:\s*(refs\/heads\/\S+)\s*$/;
const detachedHeadRegex = /^(?:[0-9a-f]{40}|[0-9a-f]{64})\s*$/i;

/** Reads the worktree's `HEAD` file; no git runs, so it is always as current as the file */
export async function readHeadFile(
	fs: FileSystemProvider,
	getGitDir: (repoPath: string) => Promise<GitDir>,
	repoPath: string,
): Promise<HeadFileState> {
	const decoder = new TextDecoder();
	try {
		const gitDir = await getGitDir(repoPath);
		const head = decoder.decode(await fs.readFile(joinUriPath(gitDir.uri, 'HEAD')));

		const ref = branchHeadRegex.exec(head)?.[1];
		if (ref == null) return detachedHeadRegex.test(head) ? { kind: 'detached' } : { kind: 'unknown' };

		if (ref.split('/').some(part => part.startsWith('.'))) return { kind: 'unknown' };

		// git follows a branch that is a symbolic ref through to its target, whose config says where it pushes; the
		// alias's own record has none. Packed refs can't hold a symbolic ref, so a missing loose file is a plain branch
		let target: string | undefined;
		try {
			target = decoder.decode(await fs.readFile(joinUriPath(gitDir.commonUri ?? gitDir.uri, ref)));
		} catch {}

		return target?.startsWith('ref:') ? { kind: 'unknown' } : { kind: 'branch', ref: ref };
	} catch {
		return { kind: 'unknown' };
	}
}
