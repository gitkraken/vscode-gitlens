/**
 * Shared file actions for webview apps.
 *
 * Standalone functions for file viewing operations. Each function accepts
 * the relevant commands service method via structural typing.
 *
 * Also exports `FileShowOptions` — a portable subset of VS Code's
 * `TextDocumentShowOptions` that crosses the RPC boundary safely.
 */
import type { GitFileChangeShape } from '../../../../git/models/fileChange.js';
import type { FileShowOptions } from '../../../rpc/services/types.js';
import { fireAndForget } from './rpc.js';

// Re-export for consumers that import from this module
export type { FileShowOptions } from '../../../rpc/services/types.js';

// ============================================================
// File Operations (fire-and-forget — backend opens editors)
// ============================================================

export function openFile(
	commands: { openFile(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void> },
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
	ref?: string,
): void {
	fireAndForget(commands.openFile(file, showOptions, ref), 'open file');
}

export function openFileOnRemote(
	commands: { openFileOnRemote(file: GitFileChangeShape, ref?: string): Promise<void> },
	file: GitFileChangeShape,
	ref?: string,
): void {
	fireAndForget(commands.openFileOnRemote(file, ref), 'open file on remote');
}

export function openFileCompareWorking(
	commands: {
		openFileCompareWorking(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void>;
	},
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
	ref?: string,
): void {
	fireAndForget(commands.openFileCompareWorking(file, showOptions, ref), 'compare file with working');
}

export function openFileComparePrevious(
	commands: {
		openFileComparePrevious(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void>;
	},
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
	ref?: string,
): void {
	fireAndForget(commands.openFileComparePrevious(file, showOptions, ref), 'compare file with previous');
}

export function executeFileAction(
	commands: {
		executeFileAction(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void>;
	},
	file: GitFileChangeShape,
	showOptions?: FileShowOptions,
	ref?: string,
): void {
	fireAndForget(commands.executeFileAction(file, showOptions, ref), 'file action');
}
