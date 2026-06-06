/**
 * Shared git actions for webview apps.
 *
 * Standalone functions that any webview's Actions class can delegate to.
 * Each function accepts the relevant service method via structural typing,
 * so it works with any webview service that has a matching method signature.
 */
import type { Signal } from '@lit-labs/signals';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import { fireAndForget, fireRpc } from './rpc.js';

// ============================================================
// Repository Operations (fire-and-forget — backend shows UI)
// ============================================================

export function fetch(git: { fetch(repoPath: string): Promise<void> }, repoPath: string): void {
	fireAndForget(git.fetch(repoPath), 'fetch');
}

export function push(git: { push(repoPath: string): Promise<void> }, repoPath: string): void {
	fireAndForget(git.push(repoPath), 'push');
}

export function pull(git: { pull(repoPath: string): Promise<void> }, repoPath: string): void {
	fireAndForget(git.pull(repoPath), 'pull');
}

export function switchBranch(git: { switchBranch(repoPath: string): Promise<void> }, repoPath: string): void {
	fireAndForget(git.switchBranch(repoPath), 'switch branch');
}

// ============================================================
// Staging Operations (fireRpc — sets error signal for UI feedback)
// ============================================================

export function stageFile(
	errorSignal: Signal.State<string | undefined>,
	git: { stageFile(file: GitFileChangeShape): Promise<void> },
	file: GitFileChangeShape,
): void {
	fireRpc(errorSignal, git.stageFile(file), 'stage file');
}

export function unstageFile(
	errorSignal: Signal.State<string | undefined>,
	git: { unstageFile(file: GitFileChangeShape): Promise<void> },
	file: GitFileChangeShape,
): void {
	fireRpc(errorSignal, git.unstageFile(file), 'unstage file');
}

export function stageFiles(
	errorSignal: Signal.State<string | undefined>,
	git: { stageFiles(files: GitFileChangeShape[]): Promise<void> },
	files: GitFileChangeShape[],
): void {
	fireRpc(errorSignal, git.stageFiles(files), 'stage files');
}

export function unstageFiles(
	errorSignal: Signal.State<string | undefined>,
	git: { unstageFiles(files: GitFileChangeShape[]): Promise<void> },
	files: GitFileChangeShape[],
): void {
	fireRpc(errorSignal, git.unstageFiles(files), 'unstage files');
}

export function discardFile(
	errorSignal: Signal.State<string | undefined>,
	git: { discardFile(file: GitFileChangeShape): Promise<void> },
	file: GitFileChangeShape,
): void {
	fireRpc(errorSignal, git.discardFile(file), 'discard file');
}

export function discardFiles(
	errorSignal: Signal.State<string | undefined>,
	git: { discardFiles(files: GitFileChangeShape[]): Promise<void> },
	files: GitFileChangeShape[],
): void {
	fireRpc(errorSignal, git.discardFiles(files), 'discard files');
}

export function stashFile(
	errorSignal: Signal.State<string | undefined>,
	git: { stashFile(file: GitFileChangeShape): Promise<void> },
	file: GitFileChangeShape,
): void {
	fireRpc(errorSignal, git.stashFile(file), 'stash file');
}

export function stashFiles(
	errorSignal: Signal.State<string | undefined>,
	git: { stashFiles(files: GitFileChangeShape[]): Promise<void> },
	files: GitFileChangeShape[],
): void {
	fireRpc(errorSignal, git.stashFiles(files), 'stash files');
}

export function discardUnstagedFiles(
	errorSignal: Signal.State<string | undefined>,
	git: { discardUnstagedFiles(repoPath: string): Promise<void> },
	repoPath: string,
): void {
	fireRpc(errorSignal, git.discardUnstagedFiles(repoPath), 'discard unstaged files');
}

export function discardStagedFiles(
	errorSignal: Signal.State<string | undefined>,
	git: { discardStagedFiles(repoPath: string): Promise<void> },
	repoPath: string,
): void {
	fireRpc(errorSignal, git.discardStagedFiles(repoPath), 'discard staged files');
}
