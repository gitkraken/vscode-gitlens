/**
 * Shared file actions for webview apps.
 *
 * Standalone functions for file viewing operations. Each function accepts
 * the relevant commands service method via structural typing.
 *
 * Also exports `FileShowOptions` — a portable subset of VS Code's
 * `TextDocumentShowOptions` that crosses the RPC boundary safely.
 */
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { FileShowOptions, OpenMultipleChangesArgs } from '../../../rpc/services/types.js';
import { notifyService } from './rpc.js';

// Re-export for consumers that import from this module
export type { FileShowOptions, OpenMultipleChangesArgs } from '../../../rpc/services/types.js';

/** Scope used by the WIP smart Copy/Open Changes buttons.
 *  - `staged`   → HEAD ↔ index   (conflicts counted as staged-needing-attention)
 *  - `unstaged` → index ↔ working tree
 *  - `all`      → HEAD ↔ working tree
 */
export type WipScope = 'all' | 'staged' | 'unstaged';

/** Detail of the `copy-wip-patch` custom event dispatched by `gl-wip-tree-pane`'s Copy button.
 *  `uris` carries the repo-relative paths for the files matching `scope` so the host-side
 *  `getDiff` call can pathspec-filter to exactly that set — keeping Copy's patch contents in
 *  sync with what Open Multi-Diff shows for the same scope. Undefined for `scope: 'all'`,
 *  where the server-side `git diff HEAD` is correct without a filter (and the implicit
 *  `intentToAdd` untracked-staging needs git's whole-repo view). */
export interface CopyWipPatchEventDetail {
	repoPath: string;
	scope: WipScope;
	uris?: readonly string[];
}

/** Detail of the `copy-commit-patch` custom event dispatched by the commit/stash file header's
 *  Copy button. Copies the whole commit's diff (`getDiff(to, from)`), mirroring the existing
 *  `CopyPatchToClipboardCommand` (`to: ref`, `from: ref^`). `from` is the parent sha; undefined
 *  for a root commit, where the host falls back to `${to}^`. */
export interface CopyCommitPatchEventDetail {
	repoPath: string;
	to: string;
	from?: string;
}

// ============================================================
// File Operations (fire-and-forget — backend opens editors)
// ============================================================

export function openFile(
	commands: {
		openFile(
			file: GitFileChangeShape,
			showOptions?: FileShowOptions,
			ref?: { ref: string; stash?: boolean },
		): Promise<void>;
	},
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
	ref?: { ref: string; stash?: boolean },
): void {
	notifyService(commands, 'open file', svc => svc.openFile(file, showOptions, ref));
}

export function openFileOnRemote(
	commands: { openFileOnRemote(file: GitFileChangeShape, ref?: { ref: string; stash?: boolean }): Promise<void> },
	file: GitFileChangeShape,
	ref?: { ref: string; stash?: boolean },
): void {
	notifyService(commands, 'open file on remote', svc => svc.openFileOnRemote(file, ref));
}

export function openFileCompareWorking(
	commands: {
		openFileCompareWorking(
			file: GitFileChangeShape,
			showOptions?: FileShowOptions,
			ref?: { ref: string; stash?: boolean },
		): Promise<void>;
	},
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
	ref?: { ref: string; stash?: boolean },
): void {
	notifyService(commands, 'compare file with working', svc => svc.openFileCompareWorking(file, showOptions, ref));
}

export function openFileComparePrevious(
	commands: {
		openFileComparePrevious(
			file: GitFileChangeShape,
			showOptions?: FileShowOptions,
			ref?: { ref: string; stash?: boolean },
		): Promise<void>;
	},
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
	ref?: { ref: string; stash?: boolean },
): void {
	notifyService(commands, 'compare file with previous', svc => svc.openFileComparePrevious(file, showOptions, ref));
}

export function openFileCompareWipChanges(
	commands: {
		openFileCompareWipChanges(file: GitFileChangeShape, showOptions?: FileShowOptions): Promise<void>;
	},
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
): void {
	notifyService(commands, 'compare WIP file changes', svc => svc.openFileCompareWipChanges(file, showOptions));
}

export function openFileCompareBetween(
	commands: {
		openFileCompareBetween(
			file: GitFileChangeShape,
			showOptions?: FileShowOptions,
			lhsRef?: string,
			rhsRef?: string,
		): Promise<void>;
	},
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
	lhsRef?: string,
	rhsRef?: string,
): void {
	notifyService(commands, 'compare file between refs', svc =>
		svc.openFileCompareBetween(file, showOptions, lhsRef, rhsRef),
	);
}

// ============================================================
// Virtual-ref operations (pre-commit / ephemeral content)
// ============================================================

export type VirtualRefShape = { namespace: string; sessionId: string; commitId: string };

export function openVirtualFile(
	commands: {
		openVirtualFile(ref: VirtualRefShape, file: GitFileChangeShape, showOptions?: FileShowOptions): Promise<void>;
	},
	ref: VirtualRefShape,
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
): void {
	notifyService(commands, 'open virtual file', svc => svc.openVirtualFile(ref, file, showOptions));
}

export function openVirtualFileComparePrevious(
	commands: {
		openVirtualFileComparePrevious(
			ref: VirtualRefShape,
			file: GitFileChangeShape,
			showOptions?: FileShowOptions,
		): Promise<void>;
	},
	ref: VirtualRefShape,
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
): void {
	notifyService(commands, 'compare virtual file with previous', svc =>
		svc.openVirtualFileComparePrevious(ref, file, showOptions),
	);
}

export function openVirtualMultipleChanges(
	commands: {
		openVirtualMultipleChanges(
			ref: VirtualRefShape,
			files: readonly GitFileChangeShape[],
			showOptions?: FileShowOptions,
		): Promise<void>;
	},
	ref: VirtualRefShape,
	files: readonly GitFileChangeShape[],
	showOptions?: FileShowOptions,
): void {
	notifyService(commands, 'open virtual multi-diff', svc => svc.openVirtualMultipleChanges(ref, files, showOptions));
}

export function executeFileAction(
	commands: {
		executeFileAction(
			file: GitFileChangeShape,
			showOptions?: FileShowOptions,
			ref?: { ref: string; stash?: boolean },
		): Promise<void>;
	},
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
	ref?: { ref: string; stash?: boolean },
): void {
	notifyService(commands, 'file action', svc => svc.executeFileAction(file, showOptions, ref));
}

export function openMultipleChanges(
	commands: { openMultipleChanges(args: OpenMultipleChangesArgs): Promise<void> },
	args: OpenMultipleChangesArgs,
): void {
	notifyService(commands, 'open multiple changes', svc => svc.openMultipleChanges(args));
}
