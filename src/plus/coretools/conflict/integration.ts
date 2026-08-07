import { promises as fs } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { applyResolutions, defaultVerifier, extractConflict, resolveConflict } from '@gitkraken/conflict-tools';
import { CancellationTokenSource } from 'vscode';
import type { AIModel } from '@gitlens/ai/models/model.js';
import type {
	AIChatMessage,
	AIChatMessageRole,
	AIProviderResponse,
	AIToolDefinition,
} from '@gitlens/ai/models/provider.js';
import { filterDiffFiles } from '@gitlens/git/parsers/diffParser.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import { AIIgnoreCache } from '../../ai/aiIgnoreCache.js';
import type { AIRequestProvider } from '../../ai/aiProviderService.js';
import type { AiTokenUsage, GitExecOptions } from '../compose/types.js';
import type { DetectedEncoding } from './encoding.js';
import { decodeBuffer, detectEncoding, encodeContent } from './encoding.js';
import type {
	BlameOptions,
	Conflict,
	ConflictDiffOptions,
	ConflictGitPort,
	ConflictModelMessage,
	ConflictModelParams,
	ConflictModelPort,
	ConflictModelResult,
	ConflictProgressEvent,
	GrepOptions,
	LogOptions,
	OpOptions,
	Resolution,
	ResolutionContext,
	ResolverConfig,
	ShowFileOptions,
	ShowOptions,
	StepResult,
	ToolDefinition,
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
	/** Session-scoped conversation ID forwarded with every AI request. Required: it scopes the
	 *  backend's flat per-feature fee to once per resolution session instead of once per request, and
	 *  the GitKraken proxy *rejects* a tools request without it when routing to Gemini. */
	conversationId: string;
	/** Model resolved up front by the caller. Passing it keeps `sendRequest` from resolving one lazily,
	 *  which can open the model picker mid-request — see {@link ResolveAllParallelArgs.model}. */
	model?: AIModel;
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
	/** Session-scoped conversation ID forwarded with every AI request. Required: it scopes the
	 *  backend's flat per-feature fee to once per resolution session instead of once per request, and
	 *  the GitKraken proxy *rejects* a tools request without it when routing to Gemini. */
	conversationId: string;
	/** Model resolved up front by the caller. Without it `sendRequest` resolves one per request, and a
	 *  non-silent resolve can show the model picker — so files resolving in parallel would each race to
	 *  open a picker VS Code can only show one of, cancelling the rest as "the AI couldn't resolve". */
	model?: AIModel;
}

/** Default max in-flight AI resolutions for the parallel batch path — balances throughput against
 *  hammering the AI provider with too many concurrent requests. */
const ResolveConcurrency = 5;

/**
 * Bounds on the resolver's agentic loops, stated explicitly rather than left to the library's
 * defaults so the cost of repo consultation is visible here.
 *
 * `maxSteps` must NOT be tightened casually: the library spends this budget on tool-calling steps
 * *and* on re-prompts after a parse/validation/verification failure. Lowering it converts recoverable
 * retries into `AIError('VALIDATION_EXHAUSTED')`, which surfaces as a failed file and — in an
 * automatic rebase — an escalation. 15 is the library's own default.
 */
const resolverDefaults = { maxSteps: 15, refineMaxSteps: 5 } satisfies ResolverConfig;

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
		const git = createConflictGitPort(this.container, args.svc);
		return extractConflict(args.filePath, { git: git, signal: args.signal }, args.reason);
	}

	async resolveSingle(args: ResolveSingleArgs, telemetrySource: Source): Promise<Resolution> {
		const git = createConflictGitPort(this.container, args.svc, {
			inScopePaths: [args.conflict.filePath],
		});
		const model = createAiModelPort(this.container, telemetrySource, args.conversationId, args.model);
		return resolveConflict(args.conflict, args.context ?? {}, {
			git: git,
			model: model,
			verifier: defaultVerifier,
			config: { ...resolverDefaults, ...args.config },
			signal: args.signal,
			onProgress: args.onProgress,
		});
	}

	async applyBatch(args: ApplyBatchArgs): Promise<void> {
		// The override map is built per call and captured only by this port instance, so it can never
		// leak into another operation's apply.
		const git = createConflictGitPort(this.container, args.svc, {
			mergedTakeContents: collectMergedTakeContents(args.resolutions),
		});
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
		const git = createConflictGitPort(this.container, args.svc, {
			inScopePaths: args.entries.map(e => e.path),
		});
		const model = createAiModelPort(this.container, telemetrySource, args.conversationId, args.model);
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

				// A both-deleted (DD) file has no content on either side to keep — the only possible
				// resolution is to delete it, so resolve it automatically rather than asking the user to
				// confirm the obvious. A content-less `deleted` resolution is applied via `git rm` by the
				// library's `applyResolutions` (the same shape a manual take-side delete queues). This also
				// collapses the redundant original-path row of a rename/rename (git records it as DD).
				// Extraction is skipped entirely — the working-tree file is absent, so it would throw ENOENT.
				if (reason === 'both-deleted') {
					const description = 'Deleted on both sides — removed automatically.';
					resolutions.push({
						filePath: filePath,
						content: '',
						strategy: 'deleted',
						confidence: 1,
						description: description,
					});
					args.onProgress?.({
						type: 'resolution:applied',
						filePath: filePath,
						strategy: 'deleted',
						confidence: 1,
						description: description,
					});
					continue;
				}

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
						config: { ...resolverDefaults, ...args.config },
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
		const git = createConflictGitPort(this.container, svc);
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
		const git = createConflictGitPort(this.container, svc);
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
		const git = createConflictGitPort(this.container, svc);
		try {
			// `-z` for verbatim NUL-terminated paths — see {@link listUnmergedEntries}.
			const out = await git.exec!(['diff', '--name-only', '--diff-filter=U', '-z']);
			return new Set(out.split('\0').filter(Boolean));
		} catch {
			return new Set();
		}
	}
}

/**
 * Working-tree content to write instead of checking out a side's whole blob, keyed by repo-relative
 * path — see {@link createConflictGitPort}'s `checkoutFile`.
 *
 * `@gitkraken/conflict-tools` labels any resolution whose chunks all pick the same side as a
 * file-level `take-ours`/`take-theirs` (true of the most common shape — one marker, "the AI picked a
 * side") and applies it with `checkoutFile`, i.e. the whole stage-2/stage-3 blob. That discards
 * every region git had already merged cleanly outside the markers. The resolution's own `content` is
 * the correct marker-level merge — and is what we record as the summary's "AI-resolved" side — so
 * writing it instead both prevents the silent loss and keeps what's committed identical to what the
 * user reviews.
 *
 * Only chunked takes qualify: the library sets `content: ''` for `deleted` and for marker-less files
 * (binary, delete/modify), where writing it would truncate the file — those keep the real checkout.
 */
function collectMergedTakeContents(resolutions: readonly Resolution[]): Map<string, string> {
	const contents = new Map<string, string>();
	for (const r of resolutions) {
		if ((r.strategy === 'take-ours' || r.strategy === 'take-theirs') && (r.chunks?.length ?? 0) > 0) {
			contents.set(r.filePath, r.content);
		}
	}
	return contents;
}

/** Max lines returned by the `diff` tool — the library caps every other read tool, but not this one. */
const diffMaxLines = 1000;

/** Returned instead of content when a tool targets a path excluded by the AI file-exclusion rules.
 *  Bracketed to match the library's own actionable-message convention, and phrased so the model
 *  looks elsewhere rather than retrying the same path. */
const excludedMessage = '[Path excluded by the AI file-exclusion rules. Do not retry this path.]';

/** Returned for a `grep` that ran cleanly and matched nothing — see the `grep` op for why the empty
 *  result can't be left to surface as the exit-1 failure git reports it as. */
const noMatchesMessage = '[No matches. The pattern does not appear anywhere in the searched scope.]';

interface ConflictGitPortOptions {
	/** See {@link collectMergedTakeContents} — apply-time content overrides keyed by repo-relative path. */
	mergedTakeContents?: ReadonlyMap<string, string>;
	/**
	 * Repo-relative paths of the files this operation is resolving. Exempt from the AI file-exclusion
	 * rules: the user explicitly asked for these, and the library reads them internally (extraction and
	 * the prompt's three-way diff) — blinding those while still sending the file's conflict markers
	 * would degrade the resolution without protecting anything. Exclusions still govern every *other*
	 * path a repo-inspection tool reaches for.
	 */
	inScopePaths?: readonly string[];
}

function createConflictGitPort(
	container: Container,
	svc: GitRepositoryService,
	options?: ConflictGitPortOptions,
): ConflictGitPort {
	const { mergedTakeContents, inScopePaths } = options ?? {};
	const inScope = inScopePaths?.length ? new Set(inScopePaths) : undefined;
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

	// Built on first use rather than per port — most port instances (apply, unmerged listing) never
	// run a repo-inspection tool, and the cache eagerly loads patterns in its constructor.
	let aiIgnore: AIIgnoreCache | undefined;
	const isExcluded = (path: string | undefined): Promise<boolean> => {
		if (!path || inScope?.has(path)) return Promise.resolve(false);

		aiIgnore ??= new AIIgnoreCache(container, svc.path);
		return aiIgnore.isIgnored(path);
	};
	const excludeIgnored = (paths: string[]): Promise<string[]> => {
		aiIgnore ??= new AIIgnoreCache(container, svc.path);
		return aiIgnore.excludeIgnored(paths);
	};

	// `readFile` and `writeFile` are required because the library has no `exec` fallback for them —
	// they read/write the working-tree file directly, bypassing git. We resolve relative paths
	// against the repo root that the underlying GitRepositoryService is rooted at.
	const resolvePath = (path: string): string => (isAbsolute(path) ? path : join(svc.path, path));

	// The library composes content with '\n' only (it normalizes on read below), so write it back with
	// the original file's encoding + line endings — otherwise a CRLF file silently flips to LF, or a
	// UTF-16 file to UTF-8, on batch resolution. Detect both from the existing on-disk bytes just
	// before overwriting; this is self-contained, so it works even though `resolveAllParallel` and
	// `applyBatch` use separate port instances. Normalize-then-convert avoids '\r\r\n' if content ever
	// already had CRLF.
	const writeWorkingFile = async (path: string, content: string): Promise<void> => {
		const resolved = resolvePath(path);
		let encoding: DetectedEncoding = { encoding: 'utf8', hasBom: false };
		let crlf = false;
		try {
			const existing = await fs.readFile(resolved);
			encoding = detectEncoding(existing);
			crlf = decodeBuffer(existing, encoding).includes('\r\n');
		} catch {
			// New file (no existing content) — default to UTF-8 / LF.
		}
		const out = crlf ? content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : content;
		await fs.writeFile(resolved, encodeContent(out, encoding));
	};

	return {
		exec: run,
		readFile: async (path: string): Promise<string> => {
			// Read as bytes and decode by the file's actual encoding — a UTF-16/BOM file read as UTF-8
			// is mojibake with no parseable markers, so it would be silently skipped. Then normalize
			// EOL: the library's parser splits on '\n' only and matches markers via startsWith, so a
			// CRLF file leaves '\r' on each marker line, breaking '=======\r' detection and surfacing
			// the next '<<<<<<<' as a phantom nested marker. The writer above restores the original
			// encoding + EOL on (re-)write.
			const raw = await fs.readFile(resolvePath(path));
			return decodeBuffer(raw).replace(/\r\n/g, '\n');
		},
		writeFile: writeWorkingFile,
		// A `take-ours`/`take-theirs` resolution the library computed content for must be written, not
		// checked out — see {@link collectMergedTakeContents}. Anything unmapped (marker-less takes, or
		// a port built for a non-apply operation) still gets the real checkout, matching the fallback
		// the library would otherwise take through `exec`.
		checkoutFile: async (path: string, side: 'ours' | 'theirs', options?: OpOptions): Promise<void> => {
			const content = mergedTakeContents?.get(path);
			if (content != null) return writeWorkingFile(path, content);

			await run(['checkout', `--${side}`, '--', path], { signal: options?.signal });
		},
		// `force` makes the delete idempotent — a `deleted` resolution can meet an already-absent
		// file (e.g. removed manually between generation and apply, while still unmerged in the
		// index), and the library's apply loop has no per-file error handling, so an ENOENT here
		// would abort the remaining resolutions and the final staging.
		removeFile: async (path: string): Promise<void> => fs.rm(resolvePath(path), { force: true }),

		// The repo-inspection ops below back the resolver's six read-only tools. The library would
		// otherwise build them from `exec` itself, but routing them through here is what lets us apply
		// the AI file-exclusion rules to everything a tool reads — the port is the only boundary
		// between the model and the repository. Each mirrors the command the library's dispatcher
		// would have run, so behavior is unchanged apart from the exclusions. Output caps still come
		// from the library, which applies them after we return (except for `diff`, capped here).
		showFile: async (ref: string, path: string, options?: ShowFileOptions): Promise<string> => {
			if (await isExcluded(path)) return excludedMessage;

			const content = await run(['show', `${ref}:${path}`], { signal: options?.signal });
			return sliceLines(content, options?.startLine, options?.endLine);
		},
		blame: async (path: string, options?: BlameOptions): Promise<string> => {
			if (await isExcluded(path)) return excludedMessage;

			const args = ['blame', '--porcelain'];
			const start = options?.startLine;
			const end = options?.endLine;
			if (start != null && end != null) {
				args.push('-L', `${Math.max(1, start)},${Math.max(1, end)}`);
			} else if (start != null) {
				args.push('-L', `${Math.max(1, start)},`);
			} else if (end != null) {
				args.push('-L', `1,${Math.max(1, end)}`);
			}
			if (options?.ref) {
				args.push(options.ref);
			}
			args.push('--', path);
			return run(args, { signal: options?.signal });
		},
		grep: async (pattern: string, options?: GrepOptions): Promise<string> => {
			// `-I` skips binary files: their matches are useless to the model, and git reports them as
			// `Binary file <path> matches` — a line the exclusion filter below can't parse a path out of,
			// so an excluded binary's name would survive it. `-z` NUL-terminates the path and line number
			// so the filter can parse paths containing `:` instead of splitting on the first colon.
			const args = ['grep', '-I', '-n', '-z', '--', pattern];
			if (options?.ref) {
				args.push(options.ref);
			}

			let output;
			try {
				output = await run(args, { signal: options?.signal });
			} catch (ex) {
				// `git grep` exits 1 with no output when nothing matched. That's an *answer* — usually the
				// most informative one ("this symbol is referenced nowhere else") — but `run` throws on any
				// non-zero exit, which would hand the model an opaque command-failure string flagged as an
				// error. Anything else (bad ref, bad pattern, cancellation) still propagates: the library
				// reports it to the model as a tool error, which is correct for a genuine failure.
				if (isNoMatchExit(ex)) return noMatchesMessage;

				throw ex;
			}

			// `grep` takes no path argument, so exclusions have to be applied to its results. `-z` output
			// is `path\0line\0text` (or `ref:path\0line\0text` when searching a ref).
			return filterGrepOutput(output, options?.ref != null, excludeIgnored);
		},
		log: async (options?: LogOptions): Promise<string> => {
			if (await isExcluded(options?.path)) return excludedMessage;

			const args = ['log', '--oneline', '-n', String(options?.maxCount ?? 100)];
			if (options?.ref) {
				args.push(options.ref);
			}
			if (options?.path) {
				args.push('--', options.path);
			}
			return run(args, { signal: options?.signal });
		},
		show: async (sha: string, options?: ShowOptions): Promise<string> => {
			if (await isExcluded(options?.path)) return excludedMessage;

			const args = ['show', sha];
			if (options?.path) {
				args.push('--', options.path);
			}
			const output = await run(args, { signal: options?.signal });

			// Unscoped, `git show` emits a patch spanning every file in the commit, so excluded files
			// have to be stripped from the diff body.
			return options?.path ? output : filterDiffFiles(output, excludeIgnored);
		},
		diff: async (from: string, to: string, options?: ConflictDiffOptions): Promise<string> => {
			if (await isExcluded(options?.path)) return excludedMessage;

			const args = ['diff', from, to];
			if (options?.path) {
				args.push('--', options.path);
			}
			const output = await run(args, { signal: options?.signal });
			// This op is the only one the library also calls internally — `buildThreeWayDiff` computes
			// `base..ours` / `base..theirs` for the conflicted file — and that diff is the prompt's primary
			// evidence, so it must not be filtered or capped. `inScope` separates the two callers exactly:
			// the library only ever diffs the file being resolved, which is what `inScopePaths` holds, and
			// no other port instance calls `diff` at all.
			if (options?.path != null && inScope?.has(options.path)) return output;

			// Everything else is a tool call. `diff` is also the one tool the library doesn't cap, so even
			// a path-scoped diff over a wide ref range could return an unbounded patch — filter and cap it
			// here in the library's style.
			const filtered = options?.path ? output : await filterDiffFiles(output, excludeIgnored);
			return truncateLines(
				filtered,
				diffMaxLines,
				options?.path
					? `Output capped at ${diffMaxLines} lines. Narrow the ref range to see less at once.`
					: `Output capped at ${diffMaxLines} lines. Use path to scope the diff to a single file.`,
			);
		},
	};
}

/** Extracts 1-indexed inclusive `startLine`..`endLine`, matching the library's exec-fallback behavior
 *  (which we bypass by supplying `showFile` ourselves). */
function sliceLines(content: string, startLine?: number, endLine?: number): string {
	if (startLine == null && endLine == null) return content;
	if (startLine != null && endLine != null && startLine > endLine) {
		return `[Invalid range: startLine=${startLine}, endLine=${endLine} (startLine must be <= endLine).]`;
	}

	const lines = content.split('\n');
	const start = Math.max(1, startLine ?? 1);
	const end = Math.min(lines.length, endLine ?? lines.length);
	if (start > lines.length) {
		return `[Range out of bounds: file has ${lines.length} lines, requested startLine=${start}.]`;
	}

	return lines.slice(start - 1, end).join('\n');
}

/**
 * Whether a thrown git error is `git grep`'s "matched nothing" exit rather than a real failure.
 *
 * Exit 1 with both streams empty is the only way git reports no matches. A genuine failure (bad ref,
 * bad pattern) exits 128 and writes to stderr, and a cancellation throws `CancellationError`, which
 * carries no `exitCode` — so neither is mistaken for an empty result.
 */
function isNoMatchExit(ex: unknown): boolean {
	const e = ex as { exitCode?: number | string; stdout?: string; stderr?: string } | undefined;
	return e?.exitCode === 1 && !e.stdout && !e.stderr;
}

/** Truncates to `maxLines`, prepending an actionable header when the cap fires. */
function truncateLines(content: string, maxLines: number, hint: string): string {
	const lines = content.split('\n');
	if (lines.length <= maxLines) return content;

	return `[${hint}]\n\n${lines.slice(0, maxLines).join('\n')}`;
}

/** Drops `git grep -z` result lines whose file is excluded by the AI file-exclusion rules, and
 *  restores the conventional `path:line:text` format. `-z` NUL-terminates the path and line number
 *  (`path\0line\0text`, or `ref:path\0line\0text` for a ref search), so a path containing `:` can't
 *  be mis-split and slip past the exclusion check — ref names can never contain `:`, so the first
 *  colon of the prefix always separates ref from path. */
async function filterGrepOutput(
	output: string,
	hasRef: boolean,
	excludeIgnored: (paths: string[]) => Promise<string[]>,
): Promise<string> {
	if (!output) return output;

	const lines = output.split('\n');
	const pathOf = (line: string): string | undefined => {
		const [prefix] = line.split('\0', 1);
		const path = hasRef ? prefix.substring(prefix.indexOf(':') + 1) : prefix;
		return path || undefined;
	};

	const paths = [...new Set(lines.map(pathOf).filter(p => p != null))];
	if (!paths.length) return output;

	const allowed = new Set(await excludeIgnored(paths));
	return lines
		.filter(l => !l || allowed.has(pathOf(l) ?? ''))
		.map(l => l.replaceAll('\0', ':'))
		.join('\n');
}

function createAiModelPort(
	container: Container,
	source: Source,
	conversationId: string,
	resolvedModel?: AIModel,
): ConflictModelPort {
	// The library's `ToolCall` has no field for the GitKraken proxy's `thought_signature`, so it would
	// be lost on the round trip back through `runResolverLoop`. Stash signatures by tool-call id here
	// and re-attach them when replaying the assistant turn — Anthropic rejects a tool result whose
	// preceding turn dropped its signature. Scoped to this port instance (one per operation), so it
	// can't leak across sessions.
	const signatures = new Map<string, string>();
	// Latched when a provider rejects the `tools` field, so the rest of the session degrades to the
	// single-shot text path instead of retrying tools on every step.
	let toolsUnsupported = false;

	return {
		generate: async (params: ConflictModelParams): Promise<ConflictModelResult> => {
			const cancellationSource = new CancellationTokenSource();
			const abortHandler = () => cancellationSource.cancel();
			params.signal?.addEventListener('abort', abortHandler);
			if (params.signal?.aborted) {
				cancellationSource.cancel();
			}

			try {
				const useTools = !toolsUnsupported && (params.tools?.length ?? 0) > 0;
				const tools = useTools ? params.tools!.map(toAiToolDefinition) : undefined;

				// `getMessages` is re-invoked on a provider retry with a reduced token budget, so build
				// the history per attempt rather than once — see `buildMessages`.
				const provider: AIRequestProvider = {
					getMessages: (_model, _reporting, _cancellation, _maxInputTokens, retries) =>
						Promise.resolve(buildMessages(params, useTools, signatures, retries)),
					getProgressTitle: () => 'Resolving conflicts…',
					getTelemetryInfo: model => ({
						key: 'ai/generate' as const,
						data: {
							type: 'resolveConflicts' as const,
							id: undefined,
							'model.id': model.id,
							'model.provider.id': model.provider.id,
							'model.provider.name': model.provider.name,
							'retry.count': 0,
						},
					}),
				};

				const result = await container.ai.sendRequest('conflict-resolution', resolvedModel, provider, source, {
					cancellation: cancellationSource.token,
					conversationId: conversationId,
					modelOptions: {
						outputTokens: params.maxTokens,
						temperature: params.temperature,
					},
					tools: tools,
					// Resolution is always a driven loop — many steps per file, up to `ResolveConcurrency`
					// files at once. The service's interactive error prompts are `await`ed, so leaving them
					// on would park every in-flight file behind its own un-dismissable notification and
					// freeze the run (an automatic rebase would sit mid-step with even Cancel inert).
					// `throwAIErrors` keeps the real `AIError` — the caller reports it per file instead.
					silent: true,
					throwAIErrors: true,
				});

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

				if (response.toolsRejected) {
					toolsUnsupported = true;
				}

				const toolCalls = response.toolCalls?.map(c => {
					if (c.providerSignature != null) {
						signatures.set(c.id, c.providerSignature);
					}
					return { id: c.id, name: c.name, args: c.args };
				});

				return {
					text: response.content,
					...(toolCalls?.length ? { toolCalls: toolCalls } : undefined),
					usage: mapUsage(response),
				};
			} finally {
				params.signal?.removeEventListener('abort', abortHandler);
				cancellationSource.dispose();
			}
		},
	};
}

function toAiToolDefinition(tool: ToolDefinition): AIToolDefinition {
	return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

/**
 * Maps the library's message history onto `AIChatMessage`s.
 *
 * When tools are in play the mapping must be faithful: an assistant turn keeps its `toolCalls` even
 * with no text (dropping it would leave a tool result with no matching request), and tool results
 * keep their `toolCallId`. Without tool support we fall back to flattening everything to text, which
 * is what shipped before tool calls existed.
 *
 * `retries` drives context-window recovery. A provider retry means the previous attempt overflowed,
 * and tool output is what inflates this history — so drop the oldest `retries` tool round-trips.
 * Round-trips are dropped as *units* (the assistant turn together with the tool results answering
 * it): an orphaned `tool_call_id` is a 400 from both OpenAI and Anthropic.
 */
function buildMessages(
	params: ConflictModelParams,
	useTools: boolean,
	signatures: ReadonlyMap<string, string>,
	retries: number,
): AIChatMessage<AIChatMessageRole>[] {
	const messages: AIChatMessage<AIChatMessageRole>[] = [];
	if (params.system) {
		messages.push({ role: 'system', content: params.system });
	}

	const source = retries > 0 ? dropOldestToolRoundTrips(params.messages, retries) : params.messages;

	for (const msg of source) {
		if (msg.role === 'tool') {
			if (useTools) {
				messages.push({
					role: 'tool',
					content: msg.content,
					toolCallId: msg.toolCallId,
					toolName: msg.toolName,
				});
			} else {
				messages.push({ role: 'user', content: `Tool result (${msg.toolName}): ${msg.content}` });
			}
			continue;
		}

		if (msg.role === 'assistant' && useTools && msg.toolCalls?.length) {
			messages.push({
				role: 'assistant',
				content: msg.content ?? '',
				toolCalls: msg.toolCalls.map(c => {
					const signature = signatures.get(c.id);
					return {
						id: c.id,
						name: c.name,
						args: c.args,
						...(signature != null ? { providerSignature: signature } : undefined),
					};
				}),
			});
			continue;
		}

		const text = typeof msg.content === 'string' ? msg.content : '';
		if (text) {
			messages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: text });
		}
	}

	return messages;
}

/**
 * Removes the oldest `count` tool round-trips, replacing them with a single note so the model knows
 * why its earlier findings are missing. An assistant turn and the `tool` messages answering it are
 * removed together to keep every remaining `toolCallId` paired.
 */
function dropOldestToolRoundTrips(messages: readonly ConflictModelMessage[], count: number): ConflictModelMessage[] {
	const out: ConflictModelMessage[] = [];
	let dropped = 0;
	let droppedIds: Set<string> | undefined;
	let noted = false;

	for (const msg of messages) {
		if (msg.role === 'assistant' && msg.toolCalls?.length && dropped < count) {
			dropped++;
			droppedIds ??= new Set();
			for (const call of msg.toolCalls) {
				droppedIds.add(call.id);
			}
			if (!noted) {
				noted = true;
				out.push({
					role: 'user',
					content: '[Earlier tool results were omitted to fit the context window.]',
				});
			}
			continue;
		}

		// Drop the results belonging to any round-trip we just removed
		if (msg.role === 'tool' && droppedIds?.has(msg.toolCallId)) continue;

		out.push(msg);
	}

	return out;
}

function mapUsage(response: AIProviderResponse<void>): AiTokenUsage | undefined {
	if (!response.usage) return undefined;
	return {
		inputTokens: response.usage.promptTokens ?? 0,
		outputTokens: response.usage.completionTokens ?? 0,
	};
}
