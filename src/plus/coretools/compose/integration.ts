import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { CancellationTokenSource } from 'vscode';
import type { AIChatMessage, AIProviderResponse } from '@gitlens/ai/models/provider.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { showLargePromptWarning } from '../../ai/utils/-webview/ai.utils.js';
import type {
	AiGenerateParams,
	AiGenerateResult,
	AiModelPort,
	AiTokenUsage,
	ComposeApplyPlan,
	ComposeGitPort,
	ComposeHunk,
	ComposePlan,
	ComposeSource,
	GitExecOptions,
	OnBeforePrompt,
	UndoForceOptions,
} from './types.js';
import { undoCompose, validateUndoCompose } from './utils.js';

/**
 * Shape cached between generate + apply phases. UX-specific subclasses may carry
 * additional opaque fields (e.g. graph's `excludedFiles` filter snapshot).
 */
export interface CachedPlan {
	plan: ComposePlan;
	snapshot: ComposeApplyPlan['snapshot'];
	source: ComposeSource;
	sourceHunks: ComposeHunk[];
	/** File paths the user (or AI policy) excluded at compose time. The apply step
	 *  must re-apply the same filter, otherwise the diff-hash safety check fails. */
	excludedFiles?: readonly string[];
}

/**
 * Base class for `@gitkraken/compose-tools` integrations.
 *
 * Owns the cross-cutting concerns shared by every consumer:
 *   - Two-phase plan cache keyed by `cacheKey` strings.
 *   - Port adapters (`createGitPort`, `createAiModelPort`).
 *   - Large-prompt gate hook for the library's `onBeforePrompt`.
 *   - Undo / validateUndo passthroughs.
 *
 * Subclasses add UX-specific orchestration:
 *   - `ComposerComposeIntegration` for the legacy composer webview.
 *   - `GraphComposeIntegration` for the graph-details compose panel.
 *
 * Scope here is deliberately narrow:
 *   - No UI concerns (those stay in the webview provider).
 *   - No telemetry emission (the caller builds events from our return data).
 *   - No cancellation UX (VS Code's `CancellationToken` comes in, `AbortSignal`
 *     goes out; the caller owns token lifecycle).
 */
export class ComposeToolsIntegration {
	protected readonly _cache = new Map<string, CachedPlan>();

	constructor(protected readonly container: Container) {}

	/** Drop a cached plan without applying it. Used on webview close / a fresh compose click. */
	discardCachedPlan(cacheKey: string): void {
		this._cache.delete(cacheKey);
	}

	/** Get the library hunks for a cached plan. */
	getCachedSourceHunks(cacheKey: string): ComposeHunk[] | undefined {
		return this._cache.get(cacheKey)?.sourceHunks;
	}

	/** Run the library's undo against a prior compose's manifest. */
	async undoCompose(input: {
		repo: GlRepository;
		undoId: string;
		force?: boolean | UndoForceOptions;
	}): Promise<void> {
		const git = createComposeGitPort(this.container, input.repo);
		await undoCompose({ git: git, undoId: input.undoId, force: input.force });
	}

	/** Dry-run validation of an undo against a prior compose's manifest. */
	async validateUndoCompose(input: {
		repo: GlRepository;
		undoId: string;
	}): Promise<{ safe: boolean; blockers: { type: string; message: string }[] }> {
		const git = createComposeGitPort(this.container, input.repo);
		const result = await validateUndoCompose({ git: git, undoId: input.undoId });
		return { safe: result.safe, blockers: result.blockers };
	}

	protected createGitPort(repo: GlRepository): ComposeGitPort {
		return createComposeGitPort(this.container, repo);
	}

	protected createAiModelPort(telemetrySource: Source): AiModelPort {
		return createAiModelPort(this.container, telemetrySource);
	}

	protected buildLargePromptGate(initiallySuppressed: boolean): OnBeforePrompt {
		return buildLargePromptGate(initiallySuppressed);
	}

	protected createCacheKey(repoPath: string): string {
		return `${repoPath}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
	}
}

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
 * author preservation, stash UX) reach the library.
 */
function createComposeGitPort(_container: Container, repo: GlRepository): ComposeGitPort {
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

	return { exec: exec };
}

/*
 * Adapts `@gitkraken/compose-tools`'s AiModelPort to GitLens's AIProviderService.
 *
 * Each `generate()` call:
 *   1. Resolves GitLens's currently-selected model.
 *   2. Passes the library's prompt through as `AIChatMessage[]` — we bypass the
 *      `getPrompt` template lookup entirely. The library bakes its own prompts.
 *   3. Maps the provider response back to `AiGenerateResult`.
 *   4. Translates AbortSignal <-> CancellationToken at the boundary.
 *
 * ToS confirmation, API key gathering, and feature gating are handled inside
 * `sendRequest` itself — this adapter inherits them for free.
 *
 * Large-prompt gating is handled via the library's `onBeforePrompt` hook
 * (supplied by the integration layer), not here.
 *
 * Cancellation (`'cancelled'` outcome from sendRequest) surfaces as a thrown
 * `ComposeWorkflowError('CANCELLED')` from the library, because the library catches
 * adapter errors and wraps cancellation.
 */
function createAiModelPort(container: Container, source: Source): AiModelPort {
	return {
		generate: async (params: AiGenerateParams): Promise<AiGenerateResult> => {
			const cancellationSource = new CancellationTokenSource();
			const abortHandler = () => cancellationSource.cancel();
			params.signal?.addEventListener('abort', abortHandler);

			try {
				const messages: AIChatMessage[] = [];
				if (params.system) {
					// GitLens's AIChatMessage union allows 'user' | 'assistant' by default;
					// system messages use the wider role and the `sendRequestConversation`
					// path accepts them. For `sendRequest` we embed the system prompt at
					// the head of the conversation.
					messages.push({ role: 'system' as 'user', content: params.system });
				}
				for (const msg of params.messages) {
					messages.push({ role: msg.role, content: msg.content });
				}

				const provider = {
					getMessages: (): Promise<AIChatMessage[]> => Promise.resolve(messages),
					getProgressTitle: () => 'Composing commits…',
					getTelemetryInfo: (model: {
						provider: { id: string; name: string };
						id: string;
						name: string;
					}) => ({
						key: 'ai/generate' as const,
						data: {
							type: 'commits' as const,
							'model.id': model.id,
							'model.provider.id': model.provider.id,
							'model.provider.name': model.provider.name,
							'retry.count': 0,
							duration: 0,
						},
					}),
				};

				const result = await container.ai.sendRequest(
					'generate-commits',
					undefined,
					// biome-ignore lint/suspicious/noExplicitAny: AIRequestProvider telemetry type is deeply private; we supply the minimum shape
					provider as any,
					source,
					{
						cancellation: cancellationSource.token,
						modelOptions: {
							outputTokens: params.maxTokens,
							temperature: params.temperature,
						},
					},
				);

				if (result === 'cancelled') {
					throw Object.assign(new Error('Operation cancelled'), { name: 'AbortError' });
				}
				if (result == null) {
					throw new Error('AI request returned no result');
				}

				const response = await result.promise;
				if (response === 'cancelled') {
					throw Object.assign(new Error('Operation cancelled'), { name: 'AbortError' });
				}
				if (response == null) {
					throw new Error('AI request produced no response');
				}

				return {
					text: response.content,
					usage: mapUsage(response),
				};
			} finally {
				params.signal?.removeEventListener('abort', abortHandler);
				cancellationSource.dispose();
			}
		},
	};
}

function mapUsage(response: AIProviderResponse<void>): AiTokenUsage | undefined {
	if (!response.usage) return undefined;
	return {
		inputTokens: response.usage.promptTokens ?? 0,
		outputTokens: response.usage.completionTokens ?? 0,
	};
}

/**
 * Build the library's `onBeforePrompt` hook that surfaces the same large-prompt
 * warning the legacy path shows (driven by `gitlens.ai.largePromptWarningThreshold`).
 *
 * The library calls this immediately before each model.generate — we check the
 * token estimate, show the warning modal once per workflow when over threshold,
 * and return false to abort when the user declines. After a confirmed prompt
 * (or when the webview already has `_suppressLargePromptWarning = true`), we
 * short-circuit to a pass-through so retries don't re-prompt.
 */
function buildLargePromptGate(initiallySuppressed: boolean): OnBeforePrompt {
	let hasConfirmed = initiallySuppressed;
	return async (info): Promise<boolean> => {
		if (hasConfirmed) return true;
		const threshold = configuration.get('ai.largePromptWarningThreshold', undefined, 10000);
		if (info.tokenEstimate <= threshold) return true;
		const proceed = await showLargePromptWarning(Math.ceil(info.tokenEstimate / 100) * 100, threshold);
		if (!proceed) return false;
		hasConfirmed = true;
		return true;
	};
}
