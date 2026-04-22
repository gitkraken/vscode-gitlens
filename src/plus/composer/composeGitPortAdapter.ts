import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type {
	ApplyPatchOptions,
	CheckoutOptions,
	CleanOptions,
	CommitTreeOptions,
	ComposeGitPort,
	DeleteBranchOptions,
	DiffTreeOptions,
	ForEachRefOptions,
	IndexScopedOptions,
	LogOptions,
	OpOptions,
	StageAllOptions,
	StashPushOptions,
	UpdateRefOptions,
} from '@gitkraken/compose-tools';
import type { GitExecOptions } from '@gitkraken/shared-tools';
import type { CancellationToken } from 'vscode';
import type { Container } from '../../container.js';
import type { GlRepository } from '../../git/models/repository.js';

/*
 * Adapts `@gitkraken/compose-tools`'s ComposeGitPort to GitLens's git
 * infrastructure.
 *
 * Provides a raw `exec()` via child_process (`git` on PATH, `cwd` = repo root).
 * Where GitLens has obviously-better semantics than the default CLI path (author-
 * aware commit creation with optional signing), provides high-level ops that
 * delegate to the existing git-cli sub-providers.
 *
 * This is the primary surface where GitLens's existing git conventions (signing,
 * author preservation, stash UX) reach the library. When the library gains Gap 7
 * (pluggable apply strategy), more ops will migrate off exec into this adapter.
 */
export function createComposeGitPort(_container: Container, repo: GlRepository): ComposeGitPort {
	const repoPath = repo.path;

	const exec = (args: string[], options?: GitExecOptions): Promise<string> => {
		return new Promise<string>((resolve, reject) => {
			const child = spawn('git', args, {
				cwd: repoPath,
				// `globalThis.process` satisfies the `no-restricted-globals: process` rule
				// while still reaching the Node process env (needed so git inherits PATH, HOME, etc.).
				env: { ...globalThis.process.env, ...(options?.env ?? {}) },
				signal: options?.signal,
				stdio: options?.stdin != null ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
			});

			// StringDecoder buffers incomplete UTF-8 sequences across chunk boundaries.
			// Using `chunk.toString('utf8')` on each chunk independently corrupts any
			// multi-byte UTF-8 character that straddles a chunk boundary — the decoder
			// emits U+FFFD for the incomplete sequence and again for the continuation
			// bytes in the next chunk. Because chunk boundaries are non-deterministic
			// (OS pipe scheduling), the same git command can return different strings
			// across calls, which breaks any downstream hashing over the output.
			const stdoutDecoder = new StringDecoder('utf8');
			const stderrDecoder = new StringDecoder('utf8');
			let stdout = '';
			let stderr = '';
			child.stdout?.on('data', (chunk: Buffer) => {
				stdout += stdoutDecoder.write(chunk);
			});
			child.stderr?.on('data', (chunk: Buffer) => {
				stderr += stderrDecoder.write(chunk);
			});

			child.on('error', err => reject(err));
			child.on('close', code => {
				stdout += stdoutDecoder.end();
				stderr += stderrDecoder.end();
				if (code === 0) {
					resolve(stdout);
				} else {
					const err = new Error(
						`git ${args.join(' ')} failed with exit code ${String(code)}: ${stderr.trim()}`,
					);
					(err as { exitCode?: number }).exitCode = code ?? undefined;
					(err as { stderr?: string }).stderr = stderr;
					reject(err);
				}
			});

			if (options?.stdin != null) {
				child.stdin?.end(options.stdin);
			}
		});
	};

	// No high-level op overrides for MVP — GitLens uses CLI git under the hood, so
	// the library's default exec path produces identical commits to GitLens's own
	// `createUnreachableCommitsFromPatches`. The read-tree → apply → write-tree →
	// commit-tree algorithm is the same.
	//
	// When Gap 7 (ComposeApplyStrategy) lands, GitLens will plug in
	// `strategy.createCommits` to batch-commit via `createUnreachableCommitsFromPatches`
	// (replacing the library's loop). That's the right granularity for overriding
	// commit-chain creation wholesale. A Desktop adapter (libgit2) will instead
	// provide libgit2-backed versions of the four primitives (readTree,
	// applyPatchToIndex, writeTree, commitTree) so the library's chain logic
	// works unchanged.
	return { exec: exec };
}

/**
 * Helper: convert a VS Code `CancellationToken` to an `AbortSignal` the library
 * and adapter ops understand. The signal aborts when the token is cancelled.
 */
export function cancellationTokenToSignal(token: CancellationToken | undefined): AbortSignal | undefined {
	if (!token) return undefined;
	const controller = new AbortController();
	if (token.isCancellationRequested) {
		controller.abort();
	} else {
		token.onCancellationRequested(() => controller.abort());
	}
	return controller.signal;
}

// Re-export option types for convenience at the integration layer.
export type {
	ApplyPatchOptions,
	CheckoutOptions,
	CleanOptions,
	CommitTreeOptions,
	DeleteBranchOptions,
	DiffTreeOptions,
	ForEachRefOptions,
	IndexScopedOptions,
	LogOptions,
	OpOptions,
	StageAllOptions,
	StashPushOptions,
	UpdateRefOptions,
};
