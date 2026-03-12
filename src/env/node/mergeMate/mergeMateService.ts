import * as process from 'process';
import type { Disposable } from 'vscode';
import { configuration } from '../../../system/-webview/configuration.js';
import type { Storage } from '../../../system/-webview/storage.js';
import { Logger } from '../../../system/logger.js';
import { CancelledRunError, RunError } from '../git/shell.errors.js';
import { run } from '../git/shell.js';
import type { MergeMateLocation } from './mergeMateLocator.js';
import { findMergeMatePath, UnableToFindMergeMateError } from './mergeMateLocator.js';

/** Strategy used to resolve a conflict */
export type ResolutionStrategy = 'merged' | 'ours' | 'theirs' | 'deleted' | 'skipped';

const knownStrategies = new Set<ResolutionStrategy>(['merged', 'ours', 'theirs', 'deleted', 'skipped']);

export interface MergeMateResolution {
	/** Relative file path from the repository root */
	path: string;
	/** Resolution strategy */
	strategy: ResolutionStrategy;
	/** Confidence score (0-100) */
	confidence: number;
	/** AI reasoning for the resolution */
	reasoning?: string;
}

export interface MergeMateResolveResult {
	/** Overall status */
	status: 'resolved' | 'partial' | 'failed';
	/** Per-file resolutions */
	resolutions: MergeMateResolution[];
	/** Error message if the overall operation failed */
	error?: string;
}

export class MergeMateService implements Disposable {
	private _location: MergeMateLocation | undefined;
	private _locating: Promise<MergeMateLocation | undefined> | undefined;

	constructor(private readonly storage: Storage) {}

	dispose(): void {}

	get enabled(): boolean {
		return configuration.get('mergeMate.enabled');
	}

	async getApiKey(): Promise<string | undefined> {
		return this.storage.getSecret('gitlens.mergeMate.key');
	}

	async storeApiKey(apiKey: string): Promise<void> {
		await this.storage.storeSecret('gitlens.mergeMate.key', apiKey);
	}

	async deleteApiKey(): Promise<void> {
		await this.storage.deleteSecret('gitlens.mergeMate.key');
	}

	async isAvailable(): Promise<boolean> {
		if (!this.enabled) return false;
		const location = await this.ensureLocation();
		return location != null;
	}

	private async ensureLocation(): Promise<MergeMateLocation | undefined> {
		if (this._location != null) return this._location;

		this._locating ??= this.locateBinary();
		const location = await this._locating;
		if (location == null) {
			this._locating = undefined;
		}
		return location;
	}

	private async locateBinary(): Promise<MergeMateLocation | undefined> {
		try {
			const configuredPath = configuration.get('mergeMate.path');
			this._location = await findMergeMatePath(configuredPath);
			return this._location;
		} catch (ex) {
			if (ex instanceof UnableToFindMergeMateError) {
				Logger.warn('MergeMate binary not found');
			} else {
				Logger.error(ex, 'MergeMate');
			}
			return undefined;
		}
	}

	/**
	 * Resolve conflicts in an in-progress rebase or merge using AI.
	 *
	 * Invokes `merge-mate resolve --json` which detects the active rebase/merge,
	 * resolves conflicting files using AI, and stages the results in the working tree.
	 * The `--json` flag produces machine-readable JSONL on stdout.
	 *
	 * @param repoPath - Repository path (used as cwd)
	 * @param continueAll - If true, resolve all remaining steps (`--continue`).
	 *   If false, resolve only the current step's conflicts.
	 * @param files - Optional list of specific file paths to resolve (relative to repo root).
	 *   When omitted, all conflicted files are resolved.
	 */
	async resolveConflicts(
		repoPath: string,
		continueAll?: boolean,
		signal?: AbortSignal,
		files?: string[],
	): Promise<MergeMateResolveResult> {
		const location = await this.ensureLocation();
		if (location == null) {
			return { status: 'failed', resolutions: [], error: 'Merge Mate binary not found' };
		}

		const args = ['resolve', '--json'];
		if (continueAll) {
			args.push('--continue');
		}
		if (files?.length) {
			args.push('--', ...files);
		}

		const apiKey = await this.getApiKey();

		Logger.debug(
			`MergeMate.resolveConflicts: running ${location.path} ${args.join(' ')} in ${repoPath}${files?.length ? ` (${files.length} file(s))` : ''}`,
		);

		if (signal?.aborted) {
			throw new CancelledRunError('merge-mate resolve', true);
		}

		try {
			const stdout = await run(location.path, args, 'utf8', {
				cwd: repoPath,
				timeout: 300_000,
				env: { ...process.env, ...(apiKey ? { MERGE_MATE_API_KEY: apiKey } : undefined) },
				signal: signal,
			});

			Logger.debug(`MergeMate.resolveConflicts: exit 0, stdout=${JSON.stringify(stdout)}`);
			return this.parseJsonlOutput(stdout);
		} catch (ex) {
			if (ex instanceof CancelledRunError) {
				Logger.debug('MergeMate.resolveConflicts: cancelled');
				throw ex;
			}

			if (signal?.aborted || (ex instanceof Error && ex.name === 'AbortError')) {
				throw new CancelledRunError('merge-mate resolve', true);
			}

			if (ex instanceof RunError) {
				Logger.debug(
					`MergeMate.resolveConflicts: exit ${String(ex.code)}, stdout=${JSON.stringify(ex.stdout)}, stderr=${JSON.stringify(ex.stderr)}`,
				);

				// With --json, structured output goes to stdout even on non-zero exit
				if (ex.stdout) {
					return this.parseJsonlOutput(ex.stdout);
				}
			}

			Logger.error(ex, 'MergeMate.resolveConflicts');
			return {
				status: 'failed',
				resolutions: [],
				error: ex instanceof Error ? ex.message : String(ex),
			};
		}
	}

	/** Invalidate the cached binary location (e.g., after config change) */
	resetLocation(): void {
		this._location = undefined;
		this._locating = undefined;
	}

	/**
	 * Parse JSONL output from `merge-mate resolve --json`.
	 *
	 * Each line is a JSON object. We look for the `{"type":"summary", ...}` record
	 * which contains the final outcome and per-file resolutions. Error/log lines
	 * have `{"level":"error","message":"..."}`.
	 */
	private parseJsonlOutput(output: string): MergeMateResolveResult {
		let summary: MergeMateJsonlSummary | undefined;
		let lastError: string | undefined;

		for (const line of output.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			try {
				const record = JSON.parse(trimmed) as MergeMateJsonlRecord;
				if (record.type === 'summary') {
					summary = record;
				} else if (record.level === 'error' && record.message) {
					lastError = record.message;
				}
			} catch {
				// Skip non-JSON lines (shouldn't happen with --json, but be defensive)
				Logger.debug(`MergeMate.parseJsonlOutput: skipping non-JSON line: ${trimmed}`);
			}
		}

		if (summary == null) {
			return {
				status: 'failed',
				resolutions: [],
				error: lastError ?? 'No summary in merge-mate output',
			};
		}

		const resolutions: MergeMateResolution[] = summary.resolutions.map(r => ({
			path: r.filePath,
			strategy: knownStrategies.has(r.strategy as ResolutionStrategy)
				? (r.strategy as ResolutionStrategy)
				: 'skipped',
			confidence: Math.round(r.confidence * 100),
			reasoning: r.description ?? undefined,
		}));

		let status: MergeMateResolveResult['status'];
		if (summary.outcome === 'error' || summary.outcome === 'aborted') {
			status = resolutions.length > 0 ? 'partial' : 'failed';
		} else if (resolutions.some(r => r.strategy === 'skipped' || r.confidence === 0)) {
			status = 'partial';
		} else {
			status = 'resolved';
		}

		return {
			status: status,
			resolutions: resolutions,
			error: summary.error ?? undefined,
		};
	}
}

interface MergeMateJsonlSummary {
	type: 'summary';
	outcome: 'completed' | 'error' | 'aborted';
	mode: 'rebase' | 'merge';
	error: string | null;
	resolutions: {
		filePath: string;
		strategy: string;
		confidence: number;
		description: string | null;
		reviewHint: string | null;
		usedFallback: boolean;
	}[];
	autoResolvedFiles: string[];
	totalUsage: unknown;
}

interface MergeMateJsonlLogLine {
	type?: undefined;
	level: string;
	message: string;
}

type MergeMateJsonlRecord = MergeMateJsonlSummary | MergeMateJsonlLogLine;
