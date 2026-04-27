import type { Event, FileStat } from 'vscode';
import { EventEmitter, FileType } from 'vscode';
import { ShowError } from '@gitlens/git/errors.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import type { ApplyableHunk } from '../../../virtual/hunkApply.js';
import { applyHunks } from '../../../virtual/hunkApply.js';
import type {
	VirtualContentChangeEvent,
	VirtualContentProvider,
	VirtualParent,
} from '../../../virtual/virtualContentProvider.js';
import type { ComposerHunk } from '../composer/protocol.js';

/** Namespace key for registration with {@link VirtualFileSystemService}. */
export const GraphComposeVirtualNamespace = 'graph-compose';

/** Information the graph webview hands off per proposed commit. */
export interface GraphComposeVirtualCommitInput {
	readonly id: string;
	readonly message: string;
	readonly hunks: readonly ComposerHunk[];
}

interface Session {
	readonly sessionId: string;
	readonly repoPath: string;
	readonly baseSha: string;
	readonly baseLabel: string;
	readonly commits: readonly GraphComposeVirtualCommitInput[];
	/**
	 * Cached synthesized content per `(commitId, path)`. Cleared when the session is disposed
	 * or superseded. Keys use `"<commitId>\0<path>"` to avoid a nested Map.
	 */
	readonly contentCache: Map<string, Uint8Array>;
}

/**
 * Handler that surfaces the graph compose panel's proposed commits as readable virtual files.
 *
 * Each session owns a parent-chained list of proposed commits anchored to a real base SHA; the
 * first commit's parent is `{ kind: 'ref', sha: baseSha }`, subsequent commits point at their
 * predecessor. File content at commit N is synthesized by starting from the base file and
 * applying in order every earlier commit's hunks that touch the requested path.
 */
export class GraphComposeVirtualContentProvider implements VirtualContentProvider {
	readonly namespace = GraphComposeVirtualNamespace;

	private readonly _sessions = new Map<string, Session>();
	private readonly _onDidChangeContent = new EventEmitter<VirtualContentChangeEvent>();
	get onDidChangeContent(): Event<VirtualContentChangeEvent> {
		return this._onDidChangeContent.event;
	}

	private _nextSessionSeq = 0;

	constructor(private readonly container: Container) {}

	dispose(): void {
		this._sessions.clear();
		this._onDidChangeContent.dispose();
	}

	/**
	 * Start a new virtual-compose session and return its id. Replaces any prior session with the
	 * same `supersedeSessionId` so that only the latest compose result for a given webview is live.
	 */
	startSession(
		input: {
			repoPath: string;
			baseSha: string;
			baseLabel?: string;
			commits: readonly GraphComposeVirtualCommitInput[];
		},
		supersedeSessionId?: string,
	): string {
		if (supersedeSessionId != null) {
			this.endSession(supersedeSessionId);
		}

		const sessionId = `compose-${Date.now().toString(36)}-${String(this._nextSessionSeq++)}`;
		this._sessions.set(sessionId, {
			sessionId: sessionId,
			repoPath: input.repoPath,
			baseSha: input.baseSha,
			baseLabel: input.baseLabel ?? input.baseSha.slice(0, 7),
			commits: input.commits,
			contentCache: new Map(),
		});
		return sessionId;
	}

	endSession(sessionId: string): void {
		const session = this._sessions.get(sessionId);
		if (session == null) return;
		this._sessions.delete(sessionId);
		// Fire change events so any open editors pointing at this session re-read and fail gracefully.
		const paths = new Set<string>();
		for (const commit of session.commits) {
			for (const h of commit.hunks) {
				paths.add(h.fileName);
				if (h.originalFileName != null) {
					paths.add(h.originalFileName);
				}
			}
		}
		if (paths.size > 0) {
			this._onDidChangeContent.fire({ sessionId: sessionId, paths: [...paths] });
		}
	}

	getLabel(sessionId: string, commitId: string): string {
		const session = this._sessions.get(sessionId);
		if (session == null) return commitId;
		const idx = session.commits.findIndex(c => c.id === commitId);
		if (idx < 0) return commitId;
		return `compose ${String(idx + 1)} of ${String(session.commits.length)}`;
	}

	getRepoPath(sessionId: string, _commitId: string): string {
		const session = this._sessions.get(sessionId);
		return session?.repoPath ?? '';
	}

	getParent(sessionId: string, commitId: string): Promise<VirtualParent | undefined> {
		const session = this._sessions.get(sessionId);
		if (session == null) return Promise.resolve(undefined);

		const idx = session.commits.findIndex(c => c.id === commitId);
		if (idx < 0) return Promise.resolve(undefined);
		if (idx === 0) {
			return Promise.resolve({ kind: 'ref', repoPath: session.repoPath, sha: session.baseSha });
		}
		return Promise.resolve({ kind: 'virtual', commitId: session.commits[idx - 1].id });
	}

	stat(sessionId: string, commitId: string, _path: string): Promise<FileStat> {
		// We don't track mtime/size for virtual content; returning zeros is sufficient for the diff
		// editor, which never inspects these fields.
		const exists = this._sessions.get(sessionId)?.commits.some(c => c.id === commitId) ?? false;
		if (!exists) {
			return Promise.reject(new Error(`virtual session/commit not found: ${sessionId}/${commitId}`));
		}
		return Promise.resolve({ type: FileType.File, size: 0, ctime: 0, mtime: 0 });
	}

	async readFile(sessionId: string, commitId: string, path: string): Promise<Uint8Array> {
		const session = this._sessions.get(sessionId);
		if (session == null) throw new Error(`virtual session not found: ${sessionId}`);

		const cacheKey = `${commitId}|${path}`;
		const cached = session.contentCache.get(cacheKey);
		if (cached != null) return cached;

		const commitIdx = session.commits.findIndex(c => c.id === commitId);
		if (commitIdx < 0) throw new Error(`virtual commit not found: ${sessionId}/${commitId}`);

		// Start with the base file content for this path; undefined if the file is new in the plan.
		let content = await this.getBaseContent(session.repoPath, session.baseSha, path);

		// Walk every commit up to and including `commitIdx`; apply any hunks that touch `path`.
		// Track renames so a file that arrived at its final path via an earlier commit's rename still
		// resolves to the correct base content.
		let currentPath = path;
		for (let i = 0; i <= commitIdx; i++) {
			const commit = session.commits[i];
			const hunks = collectHunksForPath(commit.hunks, currentPath);
			if (hunks.length === 0) continue;

			// If any hunk in this commit renames to `currentPath` from an older name, re-root from
			// that old name's content - otherwise we'd stack hunks onto the wrong base.
			const pathAtThisStep = currentPath;
			const renameFrom = hunks.find(h => h.isRename && h.toPath === pathAtThisStep)?.fromPath;
			if (renameFrom != null && renameFrom !== currentPath) {
				content = await this.getBaseContent(session.repoPath, session.baseSha, renameFrom);
				currentPath = renameFrom;
			}

			content = applyHunks(
				content,
				hunks.map(h => h.hunk),
			);
		}

		// Coerce to empty bytes for the "file doesn't exist at base and no hunks matched" case so
		// the FS provider returns a consistent result instead of surfacing undefined.
		const result = content ?? new Uint8Array(0);
		session.contentCache.set(cacheKey, result);
		return result;
	}

	private async getBaseContent(repoPath: string, baseSha: string, path: string): Promise<Uint8Array | undefined> {
		try {
			const svc = this.container.git.getRepositoryService(repoPath);
			return await svc.revision.getRevisionContent(path, baseSha);
		} catch (ex) {
			// File didn't exist at base - that's a valid new-file scenario. Log only for truly
			// unexpected errors so diagnostics aren't drowned out.
			if (!ShowError.is(ex, 'invalidObject') && !ShowError.is(ex, 'invalidRevision')) {
				Logger.error(ex, `GraphComposeVirtualContentProvider.getBaseContent('${path}'@'${baseSha}')`);
			}
			return undefined;
		}
	}
}

/** Narrow a commit's hunks to those affecting `path`, converting to `{ hunk, isRename, toPath, fromPath }`. */
function collectHunksForPath(
	hunks: readonly ComposerHunk[],
	path: string,
): Array<{ hunk: ApplyableHunk; isRename: boolean; toPath: string; fromPath: string }> {
	const out: Array<{ hunk: ApplyableHunk; isRename: boolean; toPath: string; fromPath: string }> = [];
	for (const h of hunks) {
		if (h.fileName !== path) continue;
		out.push({
			hunk: h,
			isRename: h.isRename === true,
			toPath: h.fileName,
			fromPath: h.originalFileName ?? h.fileName,
		});
	}
	return out;
}
