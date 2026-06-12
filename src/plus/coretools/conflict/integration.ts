import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { CancellationTokenSource } from 'vscode';
import { applyResolutions, defaultVerifier, extractConflict, resolveConflict } from '@gitkraken/conflict-tools';
import type { AIChatMessage, AIChatMessageRole, AIProviderResponse } from '@gitlens/ai/models/provider.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import type { AiTokenUsage, GitExecOptions } from '../compose/types.js';
import type {
	Conflict,
	ConflictGitPort,
	ConflictModelParams,
	ConflictModelPort,
	ConflictModelResult,
	ConflictProgressEvent,
	Resolution,
	ResolutionContext,
	ResolverConfig,
	StepResult,
	UnmergedEntry,
	UnmergedReason,
} from './types.js';

export interface ResolveSingleArgs {
	svc: GitRepositoryService;
	conflict: Conflict;
	context?: ResolutionContext;
	config?: ResolverConfig;
	signal?: AbortSignal;
	onProgress?: (event: ConflictProgressEvent) => void;
	/** Session-scoped conversation ID forwarded with every AI request so the backend charges its
	 *  flat per-feature fee once per resolution session instead of once per request. */
	conversationId?: string;
}

export interface ExtractArgs {
	svc: GitRepositoryService;
	filePath: string;
	reason?: string;
	signal?: AbortSignal;
}

export interface ApplyBatchArgs {
	svc: GitRepositoryService;
	resolutions: readonly Resolution[];
}

export interface ResolveAllParallelArgs {
	svc: GitRepositoryService;
	/** Unmerged entries (repo-relative path + conflict reason) to resolve — from
	 *  {@link ConflictToolsIntegration.listUnmergedEntries}. The reason lets delete/modify
	 *  conflicts extract as resolvable instead of appearing marker-less. */
	entries: readonly UnmergedEntry[];
	context?: ResolutionContext;
	config?: ResolverConfig;
	signal?: AbortSignal;
	onProgress?: (event: ConflictProgressEvent) => void;
	/** Max resolutions in flight at once. Defaults to {@link ResolveConcurrency}. */
	concurrency?: number;
	/** Session-scoped conversation ID forwarded with every AI request so the backend charges its
	 *  flat per-feature fee once per resolution session instead of once per request. */
	conversationId?: string;
}

/** Default max in-flight AI resolutions for the parallel batch path — balances throughput against
 *  hammering the AI provider with too many concurrent requests. */
const ResolveConcurrency = 5;

/** Porcelain-v2 unmerged `XY` codes → conflict reasons — same mapping conflict-tools uses internally. */
const unmergedReasonsByXY: Record<string, UnmergedReason> = {
	DD: 'both-deleted',
	AU: 'added-by-us',
	UD: 'deleted-by-them',
	UA: 'added-by-them',
	DU: 'deleted-by-us',
	AA: 'both-added',
	UU: 'both-modified',
};

export class ConflictToolsIntegration {
	constructor(protected readonly container: Container) {}

	async extract(args: ExtractArgs): Promise<Conflict | null> {
		const git = createConflictGitPort(args.svc);
		return extractConflict(args.filePath, { git: git, signal: args.signal }, args.reason);
	}

	async resolveSingle(args: ResolveSingleArgs, telemetrySource: Source): Promise<Resolution> {
		const git = createConflictGitPort(args.svc);
		const model = createAiModelPort(this.container, telemetrySource, args.conversationId);
		return resolveConflict(args.conflict, args.context ?? {}, {
			git: git,
			model: model,
			verifier: defaultVerifier,
			config: args.config,
			signal: args.signal,
			onProgress: args.onProgress,
		});
	}

	async applyBatch(args: ApplyBatchArgs): Promise<void> {
		const git = createConflictGitPort(args.svc);
		await applyResolutions([...args.resolutions], { git: git });
	}

	/**
	 * Resolves the given unmerged files with AI, running up to `concurrency` resolutions in flight
	 * at once (a rolling worker pool — always N busy, not naive batches). Each file is isolated: a
	 * failure (extract or resolve) is recorded in `errors[]` and the pool keeps going, so one bad file
	 * never stops the rest. Used instead of `@gitkraken/conflict-tools`' `resolveConflicts`, which is
	 * sequential-only. Returns the same `StepResult` shape (`previousResolutions` chaining is dropped —
	 * incompatible with parallelism). Every input entry is accounted for in the result — resolved,
	 * errored, or skipped — so no conflicted file silently vanishes from the outcome.
	 */
	async resolveAllParallel(args: ResolveAllParallelArgs, telemetrySource: Source): Promise<StepResult> {
		const git = createConflictGitPort(args.svc);
		const model = createAiModelPort(this.container, telemetrySource, args.conversationId);
		const entries = [...args.entries];
		const resolutions: Resolution[] = [];
		const errors: { filePath: string; error: Error }[] = [];
		const skipped: { filePath: string; reason: string }[] = [];

		let next = 0;
		const worker = async (): Promise<void> => {
			// `next++` is atomic between awaits (single-threaded), so workers never claim the same index.
			for (let i = next++; i < entries.length; i = next++) {
				if (args.signal?.aborted) return;

				const { path: filePath, reason } = entries[i];
				try {
					// `reason` lets delete/modify conflicts extract as resolvable `delete-modify`
					// conflicts (matching the library's sequential batch) instead of returning null.
					const conflict = await extractConflict(filePath, { git: git, signal: args.signal }, reason);
					if (conflict == null) {
						// Git still reports the file unmerged but there are no parseable conflict
						// markers (binary, symlink, add/add without content markers, …) — record it
						// so the file shows up in the results instead of silently vanishing.
						skipped.push({ filePath: filePath, reason: 'no-markers' });
						args.onProgress?.({
							type: 'conflict:skipped',
							filePath: filePath,
							reason: 'no-markers',
							entryReason: reason,
						});
						continue;
					}

					args.onProgress?.({
						type: 'conflict:found',
						filePath: filePath,
						conflictType: conflict.type,
						markerCount: conflict.markers.length,
					});
					const resolution = await resolveConflict(conflict, args.context ?? {}, {
						git: git,
						model: model,
						verifier: defaultVerifier,
						config: args.config,
						signal: args.signal,
						onProgress: args.onProgress,
					});
					resolutions.push(resolution);
					args.onProgress?.({
						type: 'resolution:applied',
						filePath: filePath,
						strategy: resolution.strategy,
						confidence: resolution.confidence,
						description: resolution.description,
					});
				} catch (ex) {
					const error = ex instanceof Error ? ex : new Error(String(ex));
					errors.push({ filePath: filePath, error: error });
					args.onProgress?.({ type: 'resolution:failed', filePath: filePath, error: error });
				}
			}
		};

		const poolSize = Math.min(Math.max(1, args.concurrency ?? ResolveConcurrency), entries.length || 1);
		await Promise.all(Array.from({ length: poolSize }, () => worker()));

		return { resolutions: resolutions, errors: errors, skipped: skipped };
	}

	/**
	 * Reads the current working-tree content of the given paths (CRLF-normalized to LF, matching the
	 * content conflict-tools produces). Used to snapshot the conflicted files — with their markers —
	 * for a resolved-vs-conflicted preview before anything is applied. Unreadable paths are skipped.
	 */
	async readWorkingFiles(svc: GitRepositoryService, paths: readonly string[]): Promise<Map<string, string>> {
		const git = createConflictGitPort(svc);
		const out = new Map<string, string>();
		await Promise.all(
			paths.map(async path => {
				try {
					out.set(path, await git.readFile!(path));
				} catch {
					// Skip files that can't be read (e.g. deleted) — they just won't get a preview side.
				}
			}),
		);
		return out;
	}

	/**
	 * Lists the repo's unmerged (conflicted) entries with their conflict reasons (porcelain v2 `u`
	 * lines). The reason lets {@link extractConflict} treat delete/modify conflicts as resolvable
	 * `delete-modify` conflicts rather than marker-less files. Mirrors conflict-tools' internal
	 * `unmergedEntries` dispatch (the function itself isn't exported from the package).
	 */
	async listUnmergedEntries(svc: GitRepositoryService): Promise<UnmergedEntry[]> {
		const git = createConflictGitPort(svc);
		// `-z` terminates records with NUL and leaves paths verbatim — without it git C-quotes
		// paths containing spaces/special characters (per `core.quotePath`), which wouldn't
		// round-trip to filesystem access.
		const output = await git.exec!(['status', '--porcelain=v2', '-z']);
		const entries: UnmergedEntry[] = [];
		for (const record of output.split('\0')) {
			if (!record.startsWith('u ')) continue;

			// `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`
			const fields = record.split(' ');
			const path = fields.slice(10).join(' ');
			if (!path) continue;

			entries.push({ path: path, reason: unmergedReasonsByXY[fields[1]] ?? fields[1] });
		}
		return entries;
	}

	/**
	 * Lists the repo's currently-unmerged (conflicted) paths, repo-relative. Used to re-validate a
	 * cached resolution set just before applying — a file resolved/aborted externally between
	 * generation and apply must NOT be overwritten with stale AI content (data-loss guard).
	 */
	async listUnmergedPaths(svc: GitRepositoryService): Promise<Set<string>> {
		const git = createConflictGitPort(svc);
		try {
			// `-z` for verbatim NUL-terminated paths — see {@link listUnmergedEntries}.
			const out = await git.exec!(['diff', '--name-only', '--diff-filter=U', '-z']);
			return new Set(out.split('\0').filter(Boolean));
		} catch {
			return new Set();
		}
	}
}

function createConflictGitPort(svc: GitRepositoryService): ConflictGitPort {
	const git = svc.createUnsafeGit();
	if (git == null) throw new Error('Conflict resolution is not available in virtual repositories');

	const run = async (args: string[], options?: GitExecOptions): Promise<string> => {
		const result = await git.run(args, {
			env: options?.env,
			stdin: options?.stdin,
			cancellation: options?.signal,
			errors: 'throw',
		});
		return result.stdout;
	};

	// `readFile` and `writeFile` are required because the library has no `exec` fallback for them —
	// they read/write the working-tree file directly, bypassing git. We resolve relative paths
	// against the repo root that the underlying GitRepositoryService is rooted at.
	const resolvePath = (path: string): string => (isAbsolute(path) ? path : join(svc.path, path));

	return {
		exec: run,
		readFile: async (path: string): Promise<string> => {
			// Library's parser splits on '\n' only and matches markers via startsWith — a CRLF file
			// leaves '\r' on each marker line, breaking '=======\r' detection and surfacing the
			// next '<<<<<<<' as a phantom nested marker. Normalize on read; the writer below restores
			// the original EOL on (re-)write.
			const raw = await fs.readFile(resolvePath(path), 'utf8');
			return raw.replace(/\r\n/g, '\n');
		},
		writeFile: async (path: string, content: string): Promise<void> => {
			// The library composes content with '\n' only (it normalizes on read above), so write it
			// back with the original file's line endings — otherwise a CRLF file silently flips to LF
			// on batch resolution. Detect the existing on-disk EOL just before overwriting; this is
			// self-contained, so it works even though `resolveAllParallel` and `applyBatch` use separate
			// port instances. Normalize-then-convert avoids '\r\r\n' if content ever already had CRLF.
			const resolved = resolvePath(path);
			let crlf = false;
			try {
				crlf = (await fs.readFile(resolved, 'utf8')).includes('\r\n');
			} catch {
				// New file (no existing content) — default to LF.
			}
			const out = crlf ? content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : content;
			await fs.writeFile(resolved, out, 'utf8');
		},
		// `force` makes the delete idempotent — a `deleted` resolution can meet an already-absent
		// file (e.g. removed manually between generation and apply, while still unmerged in the
		// index), and the library's apply loop has no per-file error handling, so an ENOENT here
		// would abort the remaining resolutions and the final staging.
		removeFile: async (path: string): Promise<void> => fs.rm(resolvePath(path), { force: true }),
	};
}

function createAiModelPort(container: Container, source: Source, conversationId?: string): ConflictModelPort {
	return {
		generate: async (params: ConflictModelParams): Promise<ConflictModelResult> => {
			const cancellationSource = new CancellationTokenSource();
			const abortHandler = () => cancellationSource.cancel();
			params.signal?.addEventListener('abort', abortHandler);
			if (params.signal?.aborted) {
				cancellationSource.cancel();
			}

			try {
				// Widened to include 'system' — bare `AIChatMessage` defaults to assistant/user, but
				// providers forward roles verbatim, and `getMessages` below isn't constrained to the
				// narrow type (the provider literal passes through `as any` at `sendRequest`).
				const messages: AIChatMessage<AIChatMessageRole>[] = [];
				if (params.system) {
					messages.push({ role: 'system', content: params.system });
				}
				for (const msg of params.messages) {
					if (msg.role === 'tool') {
						messages.push({
							role: 'user' as const,
							content: `Tool result (${msg.toolName}): ${msg.content}`,
						});
						continue;
					}

					const text = typeof msg.content === 'string' ? msg.content : '';
					if (text) {
						messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
					}
				}

				const provider = {
					getMessages: (): Promise<AIChatMessage<AIChatMessageRole>[]> => Promise.resolve(messages),
					getProgressTitle: () => 'Resolving conflicts…',
					getTelemetryInfo: (model: {
						provider: { id: string; name: string };
						id: string;
						name: string;
					}) => ({
						key: 'ai/generate' as const,
						data: {
							type: 'resolveConflicts' as const,
							'model.id': model.id,
							'model.provider.id': model.provider.id,
							'model.provider.name': model.provider.name,
							'retry.count': 0,
							duration: 0,
						},
					}),
				};

				const result = await container.ai.sendRequest(
					'conflict-resolution',
					undefined,
					// biome-ignore lint/suspicious/noExplicitAny: AIRequestProvider telemetry type is deeply private; we supply the minimum shape
					provider as any,
					source,
					{
						cancellation: cancellationSource.token,
						conversationId: conversationId,
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
