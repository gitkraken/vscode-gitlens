import type { Event, FileStat } from 'vscode';

/**
 * Identifies a virtual ref — a point-in-time identifier owned by a registered
 * {@link VirtualContentProvider}. The `namespace` picks the provider; `sessionId` scopes
 * to a concurrent session inside that provider; `commitId` is opaque to the
 * infrastructure and meaningful only to the provider.
 */
export interface VirtualRef {
	readonly namespace: string;
	readonly sessionId: string;
	readonly commitId: string;
}

/** A virtual ref's parent — either another virtual ref in the same session, or a real git ref. */
export type VirtualParent =
	| { readonly kind: 'virtual'; readonly commitId: string }
	| { readonly kind: 'ref'; readonly repoPath: string; readonly sha: string };

/**
 * Handler interface implemented by each feature that wants to surface virtual content
 * to the VS Code diff editor (graph compose, standalone composer, AI suggestions,
 * merge-conflict vis, ephemeral stash, etc.). Registered with {@link VirtualFileSystemService}
 * under a unique `namespace`.
 */
export interface VirtualContentProvider {
	/** Unique key. Included in the URI authority; matches to dispatch. */
	readonly namespace: string;

	readFile(sessionId: string, commitId: string, path: string): Promise<Uint8Array>;
	stat(sessionId: string, commitId: string, path: string): Promise<FileStat>;

	/**
	 * Optional. Returns the virtual ref's parent — another virtual ref in the same session, or
	 * a real git ref (SHA). Return `undefined` for standalone snapshots (e.g. the 'ours' / 'theirs'
	 * sides of a merge) where the caller pairs refs explicitly via
	 * {@link VirtualFileSystemService.buildDiffArgs}. Required for
	 * {@link VirtualFileSystemService.getComparePreviousUris} to function.
	 */
	getParent?(sessionId: string, commitId: string): Promise<VirtualParent | undefined>;

	/** Human-readable label for diff titles and tooltips (e.g. `"compose 2 of 5"`, `"theirs"`). */
	getLabel(sessionId: string, commitId: string): string;

	/** Repository path the virtual ref belongs to. Used when building real-ref `gitlens://` LHS URIs. */
	getRepoPath(sessionId: string, commitId: string): string;

	/**
	 * Optional. Fires when the provider's content for one or more virtual refs changes, so
	 * the service can invalidate cached URI reads and tell VS Code to re-fetch.
	 */
	readonly onDidChangeContent?: Event<VirtualContentChangeEvent>;
}

/** Fired by a provider to signal invalidation. `paths: undefined` means "everything in the session". */
export interface VirtualContentChangeEvent {
	readonly sessionId: string;
	readonly commitId?: string;
	readonly paths?: readonly string[];
}
