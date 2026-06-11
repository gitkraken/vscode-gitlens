import type { Event, FileStat } from 'vscode';
import { EventEmitter, FileType } from 'vscode';
import type {
	VirtualContentChangeEvent,
	VirtualContentProvider,
	VirtualParent,
} from '../../../virtual/virtualContentProvider.js';

/** Namespace key for registration with {@link VirtualFileSystemService}. */
export const GraphResolveVirtualNamespace = 'graph-resolve';

/** The two virtual "sides" of a resolved file. `resolved`'s parent is `conflicted`, so the existing
 *  compare-previous plumbing renders an AI-resolved-vs-conflicted diff with no write to disk. */
export const ResolveVirtualSide = {
	conflicted: 'conflicted',
	resolved: 'resolved',
} as const;
export type ResolveVirtualSide = (typeof ResolveVirtualSide)[keyof typeof ResolveVirtualSide];

/** Per-file snapshot the graph webview hands off at resolve time. */
export interface GraphResolveVirtualFileInput {
	readonly path: string;
	/** Working-tree content at resolve time — the file with conflict markers (the diff's left side). */
	readonly conflictedContent: string;
	/** AI-resolved content (the diff's right side). */
	readonly resolvedContent: string;
}

interface Session {
	readonly sessionId: string;
	readonly repoPath: string;
	readonly files: Map<string, GraphResolveVirtualFileInput>;
}

/**
 * Surfaces a conflict-resolution result's proposed file contents as readable virtual files, so the
 * user can preview the AI-resolved content against the conflicted working tree before applying.
 *
 * Each file is a two-node chain: the `conflicted` side is a standalone snapshot (no parent) and the
 * `resolved` side's parent is the `conflicted` side. A single `resolved` virtual ref therefore feeds
 * the same `openVirtualFileComparePrevious` path the compose panel uses, yielding a resolved-vs-
 * conflicted diff — purely in-editor, nothing touches the working tree until the user applies.
 */
export class GraphResolveVirtualContentProvider implements VirtualContentProvider {
	readonly namespace = GraphResolveVirtualNamespace;

	private readonly _sessions = new Map<string, Session>();
	private readonly _onDidChangeContent = new EventEmitter<VirtualContentChangeEvent>();
	get onDidChangeContent(): Event<VirtualContentChangeEvent> {
		return this._onDidChangeContent.event;
	}

	private _nextSessionSeq = 0;

	dispose(): void {
		this._sessions.clear();
		this._onDidChangeContent.dispose();
	}

	/** Start a new resolve session and return its id, superseding any prior session for this webview. */
	startSession(
		input: { repoPath: string; files: readonly GraphResolveVirtualFileInput[] },
		supersedeSessionId?: string,
	): string {
		if (supersedeSessionId != null) {
			this.endSession(supersedeSessionId);
		}

		const sessionId = `resolve-${String(this._nextSessionSeq++)}`;
		this._sessions.set(sessionId, {
			sessionId: sessionId,
			repoPath: input.repoPath,
			files: new Map(input.files.map(f => [f.path, f])),
		});
		return sessionId;
	}

	/** Replaces one file's content in an existing session (e.g. after a per-file feedback retry) so
	 *  its `resolved` virtual ref re-reads the new content — the `sessionId`/ref stays stable, keeping
	 *  the row's "View diff" valid. Fires a change event so any open diff for that file re-renders. */
	updateFile(sessionId: string, file: GraphResolveVirtualFileInput): void {
		const session = this._sessions.get(sessionId);
		if (session == null) return;

		session.files.set(file.path, file);
		this._onDidChangeContent.fire({ sessionId: sessionId, paths: [file.path] });
	}

	endSession(sessionId: string): void {
		const session = this._sessions.get(sessionId);
		if (session == null) return;

		this._sessions.delete(sessionId);
		// Fire change events so any open editors pointing at this session re-read and fail gracefully.
		const paths = [...session.files.keys()];
		if (paths.length > 0) {
			this._onDidChangeContent.fire({ sessionId: sessionId, paths: paths });
		}
	}

	getLabel(_sessionId: string, commitId: string): string {
		return commitId === ResolveVirtualSide.resolved ? 'AI-resolved' : 'conflicted';
	}

	getRepoPath(sessionId: string, _commitId: string): string {
		return this._sessions.get(sessionId)?.repoPath ?? '';
	}

	getParent(sessionId: string, commitId: string): Promise<VirtualParent | undefined> {
		// `resolved`'s previous is the `conflicted` snapshot; `conflicted` is standalone (no parent).
		if (commitId === ResolveVirtualSide.resolved && this._sessions.has(sessionId)) {
			return Promise.resolve({ kind: 'virtual', commitId: ResolveVirtualSide.conflicted });
		}
		return Promise.resolve(undefined);
	}

	stat(sessionId: string, _commitId: string, path: string): Promise<FileStat> {
		const exists = this._sessions.get(sessionId)?.files.has(path) ?? false;
		if (!exists) {
			return Promise.reject(new Error(`virtual session/file not found: ${sessionId}/${path}`));
		}
		return Promise.resolve({ type: FileType.File, size: 0, ctime: 0, mtime: 0 });
	}

	readFile(sessionId: string, commitId: string, path: string): Promise<Uint8Array> {
		const session = this._sessions.get(sessionId);
		if (session == null) throw new Error(`virtual session not found: ${sessionId}`);

		const file = session.files.get(path);
		if (file == null) throw new Error(`virtual file not found: ${sessionId}/${path}`);

		const content = commitId === ResolveVirtualSide.resolved ? file.resolvedContent : file.conflictedContent;
		return Promise.resolve(new TextEncoder().encode(content));
	}
}
