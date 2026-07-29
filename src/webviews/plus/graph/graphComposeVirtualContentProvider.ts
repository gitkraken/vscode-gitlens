import type { Event, FileStat } from 'vscode';
import { EventEmitter, FileType } from 'vscode';
import { ShowError } from '@gitlens/git/errors.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import { applyHunks } from '../../../virtual/hunkApply.js';
import type {
	VirtualContentChangeEvent,
	VirtualContentProvider,
	VirtualParent,
} from '../../../virtual/virtualContentProvider.js';
import type { ComposerHunk } from './compose/protocol.js';

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
	/**
	 * Cached base-content reads, keyed by path (baseSha is session-scoped). `null` is the
	 * "fetched and known absent" sentinel — distinguishes a real miss from "not yet fetched"
	 * so re-reads of new files don't redundantly hit git.
	 */
	readonly baseContentCache: Map<string, Uint8Array | null>;
}

/**
 * Handler that surfaces the graph compose panel's proposed commits as readable virtual files.
 *
 * Each session owns a parent-chained list of proposed commits anchored to a real base SHA; the
 * first commit's parent is `{ kind: 'ref', sha: baseSha }`, subsequent commits point at their
 * predecessor. File content at commit N is synthesized by taking the base file and applying, in a
 * single pass and in base order, every hunk from commits 0..N keyed under the requested path — read
 * from the base name {@link resolveBasePath} resolves for it.
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
			baseContentCache: new Map(),
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

		// Every hunk comes from one combined `base..final` diff, so a file's hunks are keyed under its
		// final name in every proposed commit they're split across — a rename never re-keys them
		// commit by commit, which is why matching each commit on the requested path is correct here.
		//
		// Because that diff is base-relative, every `@@` header is too — never relative to the
		// preceding commit — so they have to be applied in one pass against the base. `index` is
		// that diff's emission order, i.e. ascending old-line order per file.
		const hunks: ComposerHunk[] = [];
		for (let i = 0; i <= commitIdx; i++) {
			for (const h of session.commits[i].hunks) {
				if (h.fileName === path) {
					hunks.push(h);
				}
			}
		}
		hunks.sort((a, b) => a.index - b.index);

		// Base content comes from the pre-rename name when the file was renamed.
		const basePath = resolveBasePath(session.commits, commitIdx, path);
		const result = applyHunks(await this.getBaseContent(session, basePath), hunks);
		session.contentCache.set(cacheKey, result);
		return result;
	}

	private async getBaseContent(session: Session, path: string): Promise<Uint8Array | undefined> {
		const cached = session.baseContentCache.get(path);
		if (cached !== undefined) return cached ?? undefined;

		let result: Uint8Array | undefined;
		try {
			const svc = this.container.git.getRepositoryService(session.repoPath);
			result = await svc.revision.getRevisionContent(path, session.baseSha);
		} catch (ex) {
			// File didn't exist at base - that's a valid new-file scenario. Log only for truly
			// unexpected errors so diagnostics aren't drowned out.
			if (!ShowError.is(ex, 'invalidObject') && !ShowError.is(ex, 'invalidRevision')) {
				Logger.error(ex, `GraphComposeVirtualContentProvider.getBaseContent('${path}'@'${session.baseSha}')`);
			}
			result = undefined;
		}

		session.baseContentCache.set(path, result ?? null);
		return result;
	}
}

/**
 * Resolve the base-revision name of the file whose hunks are keyed under `path`, looking only at the
 * commits up to and including `throughIdx`. Returns `path` itself when nothing renamed it.
 *
 * Rename-with-edits carries `originalFileName` on every hunk of the file with `isRename: false`,
 * while a pure rename carries one hunk with `isRename: true` — taking the first `originalFileName`
 * among the file's hunks covers both shapes without depending on `isRename`. Uniform tagging is
 * compose-tools' doing, not this repo's: it collects hunks once over the whole `base..final` range
 * and the plan only slices that one list by index, so no per-commit re-keying happens.
 *
 * The diff editor does ask for the pre-rename name, but only on the left side of a rename row, and
 * `buildDiffArgs` resolves that side against the row's *parent* — and a rename row is only ever
 * rendered for the earliest commit holding the file's hunks (`resolveProposedFileStatus` in
 * `compose/utils.ts`, gated on `earliestCommitByFile`; change that ownership rule and this reasoning
 * needs re-checking). So the pre-rename name arrives with a `throughIdx` that excludes every hunk of
 * that file, and returning it unchanged is what makes that side read as the untouched base.
 */
function resolveBasePath(commits: readonly GraphComposeVirtualCommitInput[], throughIdx: number, path: string): string {
	for (let i = 0; i <= throughIdx; i++) {
		for (const h of commits[i].hunks) {
			if (h.fileName === path && h.originalFileName != null) return h.originalFileName;
		}
	}
	return path;
}
