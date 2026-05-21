import type { Disposable, TextDocument } from 'vscode';
import { window, workspace } from 'vscode';
import { createConflictToolsIntegration } from '@env/coretools/conflict.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { Container } from '../../container.js';
import { abortPausedOperation } from '../../git/actions/pausedOperation.js';
import type { ConflictHunk } from '../../git/utils/-webview/conflictHunks.utils.js';
import { applyResolutions, parseConflictHunks } from '../../git/utils/-webview/conflictHunks.utils.js';
import { computeThreeWayDiff } from '../../git/utils/-webview/threeWayDiff.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import type { Resolution as ConflictToolsResolution, ResolvedChunk } from '../../plus/coretools/conflict/types.js';
import { configuration } from '../../system/-webview/configuration.js';
import { closeTab } from '../../system/-webview/vscode/tabs.js';
import type { IpcParams, IpcResponse } from '../ipc/handlerRegistry.js';
import { ipcCommand, ipcRequest } from '../ipc/handlerRegistry.js';
import type { WebviewHost } from '../webviewProvider.js';
import { MergeConflictDocument } from './mergeConflictDocument.js';
import type {
	MergeConflictHunk,
	MergeConflictResolution,
	OutputEntry,
	OutputLineMeta,
	OutputLineSource,
	PickBothParams,
	PickHunkParams,
	PickLineParams,
	State,
} from './protocol.js';
import {
	AbortMergeCommand,
	AIResolveProgressNotification,
	CancelAIResolveCommand,
	DidChangeStateNotification,
	DidResolveNotification,
	PickBothCommand,
	PickHunkCommand,
	PickLineCommand,
	RequestAIResolveRequest,
	ResetAllCommand,
	ResetHunkCommand,
	RunAIResolveCommand,
	SaveAndResolveCommand,
	TakeAllCommand,
	TakeBothAllCommand,
	UpdateOutputCommand,
} from './protocol.js';

interface StageContent {
	base?: string[];
	current: string[];
	incoming: string[];
}

/** Host-side mutable resolution state. Per-hunk ordered list of entries. */
interface InternalResolution {
	hunkIndex: number;
	entries: OutputEntry[];
}

interface OutputSubstitution {
	lines: string[];
	sources: OutputLineSource[];
	/** Parallel array; populated only for synced (side-sourced) lines so the Output pane can
	 *  retract a pick via gutter click. */
	metas: (OutputLineMeta | null)[];
}

const maxConflictFileSize = 5 * 1024 * 1024;

export class MergeConflictWebviewProvider implements Disposable {
	private readonly _doc: MergeConflictDocument;
	private readonly _disposables: Disposable[] = [];
	private _stages?: StageContent;
	private _stagesPromise?: Promise<StageContent | undefined>;
	private _resolutions = new Map<number, InternalResolution>();
	/** Per-context-segment user edits. Segment indices match the gaps between hunks:
	 *   0 = before hunks[0]; i = between hunks[i-1] and hunks[i]; N = after hunks[N-1].
	 *  `lines` is the current text for the segment (potentially with added/removed lines);
	 *  `edited[i]` is true when line `i` differs from the corresponding original WT line OR was
	 *  newly inserted by the user — used to drive the manual-highlight in the Output pane. */
	private _contextOverrides = new Map<number, { lines: string[]; edited: boolean[] }>();
	private _closing = false;
	private _aiAbort?: AbortController;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.mergeConflict'>,
		private readonly document: TextDocument,
		private readonly repoPath: string,
	) {
		this._doc = new MergeConflictDocument(document);

		this._disposables.push(
			workspace.onDidChangeTextDocument(e => {
				if (this._closing || e.document !== document || e.contentChanges.length === 0) return;

				void this.notifyDidChangeState();
			}),
			workspace.onDidCloseTextDocument(e => {
				if (e !== document) return;

				this._closing = true;
				void closeTab(document.uri);
			}),
		);
	}

	dispose(): void {
		this._disposables.forEach(d => void d.dispose());
	}

	getTelemetryContext(): Record<`context.${string}`, string | number | boolean | undefined> &
		ReturnType<WebviewHost<'gitlens.mergeConflict'>['getTelemetryContext']> {
		return {
			...this.host.getTelemetryContext(),
			'context.hunkCount': this._doc.parsed.hunks.length,
			'context.resolvedCount': this._resolutions.size,
			'context.hasDiff3': this._doc.parsed.hasDiff3,
		};
	}

	async includeBootstrap(): Promise<State> {
		return this.parseState();
	}

	onRefresh(_force?: boolean): void {
		this._stages = undefined;
		this._stagesPromise = undefined;
		void this.notifyDidChangeState();
	}

	onVisibilityChanged(visible: boolean): void {
		if (visible) {
			this.host.sendPendingIpcNotifications();
		}
	}

	@ipcCommand(PickLineCommand)
	@debug()
	private onPickLine(params: IpcParams<typeof PickLineCommand>): void {
		this.applyPickLine(params);
	}

	@ipcCommand(PickHunkCommand)
	@debug()
	private onPickHunk(params: IpcParams<typeof PickHunkCommand>): void {
		this.applyPickHunk(params);
	}

	@ipcCommand(PickBothCommand)
	@debug()
	private onPickBoth(params: IpcParams<typeof PickBothCommand>): void {
		this.applyPickBoth(params);
	}

	@ipcCommand(ResetHunkCommand)
	@debug()
	private onResetHunk(params: IpcParams<typeof ResetHunkCommand>): void {
		this.resetHunk(params.hunkIndex);
	}

	@ipcCommand(ResetAllCommand)
	@debug()
	private onResetAll(): void {
		if (this._resolutions.size === 0 && this._contextOverrides.size === 0) return;

		const indices = [...this._resolutions.keys()];
		this._resolutions.clear();
		this._contextOverrides.clear();
		for (const hunkIndex of indices) {
			void this.host.notify(DidResolveNotification, { resolution: this.unresolvedResolution(hunkIndex) });
		}
		void this.notifyDidChangeState();
	}

	@ipcCommand(TakeAllCommand)
	@debug()
	private onTakeAll(params: IpcParams<typeof TakeAllCommand>): void {
		// Apply pickHunk to every hunk that doesn't already have all of `side` taken. If every hunk
		// is already fully taken on `side`, untake them all (toggle semantics at the bulk level).
		for (const hunk of this._doc.parsed.hunks) {
			this.applyPickHunk({ hunkIndex: hunk.index, side: params.side });
		}
	}

	@ipcCommand(TakeBothAllCommand)
	@debug()
	private onTakeBothAll(params: IpcParams<typeof TakeBothAllCommand>): void {
		for (const hunk of this._doc.parsed.hunks) {
			this.applyPickBoth({ hunkIndex: hunk.index, order: params.order });
		}
	}

	@ipcCommand(UpdateOutputCommand)
	@debug()
	private onUpdateOutput(params: IpcParams<typeof UpdateOutputCommand>): void {
		this.reconcileManualEdit(params.text);
	}

	@ipcCommand(AbortMergeCommand)
	@debug()
	private async onAbortMerge(): Promise<void> {
		const svc = this.container.git.getRepositoryService(this.repoPath);
		try {
			await abortPausedOperation(svc);
			this._closing = true;
			await closeTab(this.document.uri);
		} catch (ex) {
			void showGitErrorMessage(ex);
		}
	}

	@ipcCommand(SaveAndResolveCommand)
	@debug()
	private async onSaveAndResolve(): Promise<void> {
		const parsed = this._doc.parsed;
		const resolutions = new Map<number, readonly string[]>();
		for (const hunk of parsed.hunks) {
			const composed = this.composeHunkLines(hunk.index);
			if (composed != null) {
				resolutions.set(hunk.index, composed);
			}
		}
		if (resolutions.size === 0 && this._contextOverrides.size === 0) {
			void window.showInformationMessage('No conflicts have been resolved yet.');
			return;
		}

		const totalHunks = parsed.hunks.length;
		if (resolutions.size < totalHunks) {
			const result = await window.showWarningMessage(
				`${totalHunks - resolutions.size} conflict(s) remain unresolved. Save anyway and leave markers in the file?`,
				{ modal: true },
				{ title: 'Save Anyway' },
			);
			if (result == null) return;
		}

		// Write the full composed output (per-hunk resolutions + per-segment context edits) rather
		// than `writeResolutions` alone, otherwise the user's edits to context lines would be lost.
		const subs = this.buildOutputSubstitutions(parsed.hunks);
		const composed = composeOutputWithMeta(parsed, subs, this._contextOverrides);
		const ok = await this._doc.writeText(composed.text);
		if (!ok) {
			void window.showErrorMessage('GitLens was unable to write the resolved file.');
			return;
		}

		await this._doc.save();

		// Only stage when the file is fully resolved — git refuses to stage with markers present.
		// Either way, the user clicked Finish so close the editor; if they wanted to keep iterating
		// they would have stayed on the picks/edits flow.
		const markersRemain = this._doc.parsed.hunks.length > 0;
		if (!markersRemain) {
			const svc = this.container.git.getRepositoryService(this.repoPath);
			const path = normalizePath(workspace.asRelativePath(this.document.uri, false));
			try {
				await svc.staging?.stageFile?.(path);
			} catch (ex) {
				void showGitErrorMessage(ex);
				// Even on stage failure, close — the file is saved with the user's content.
			}
		}

		this._closing = true;
		await closeTab(this.document.uri);
	}

	@ipcRequest(RequestAIResolveRequest)
	@debug()
	private onRequestAIResolve(
		_params: IpcParams<typeof RequestAIResolveRequest>,
	): IpcResponse<typeof RequestAIResolveRequest> {
		// Legacy stub kept for backwards compat with any in-flight protocol; the live path is the
		// fire-and-forget RunAIResolveCommand + AIResolveProgressNotification pair below.
		return {
			resolutions: [],
			error: 'Use RunAIResolveCommand for AI-assisted resolution.',
		};
	}

	@ipcCommand(RunAIResolveCommand)
	@debug()
	private async onRunAIResolve(): Promise<void> {
		if (this._aiAbort != null) return;

		await this.runAIResolve();
	}

	@ipcCommand(CancelAIResolveCommand)
	@debug()
	private onCancelAIResolve(): void {
		this._aiAbort?.abort();
	}

	/** Kick off an AI-assisted resolution against this file. Used both by the in-webview button
	 *  (via the `RunAIResolveCommand` IPC) and by the `gitlens.conflicts.resolveWithAI` extension
	 *  command, which opens this editor and then asks us to start running automatically. */
	async runAIResolve(): Promise<void> {
		const integration = createConflictToolsIntegration(this.container);
		if (integration == null) {
			await this.host.notify(AIResolveProgressNotification, {
				phase: 'failed',
				message: 'AI-assisted resolution is unavailable in this environment.',
			});
			return;
		}

		const parsed = this._doc.parsed;
		if (parsed.hunks.length === 0) {
			await this.host.notify(AIResolveProgressNotification, {
				phase: 'failed',
				message: 'No conflict markers detected in this file.',
			});
			return;
		}

		this._aiAbort = new AbortController();
		await this.host.notify(AIResolveProgressNotification, { phase: 'starting' });

		const svc = this.container.git.getRepositoryService(this.repoPath);
		const refs = await this.collectRefs(svc);
		const filePath = normalizePath(workspace.asRelativePath(this.document.uri, false));
		const markerCount = parsed.hunks.length;

		try {
			const conflict = await integration.extract({
				svc: svc,
				filePath: filePath,
				signal: this._aiAbort.signal,
			});
			if (conflict == null) {
				await this.host.notify(AIResolveProgressNotification, {
					phase: 'failed',
					message: 'No conflict markers detected in this file.',
				});
				this._aiAbort = undefined;
				return;
			}

			const resolution = await integration.resolveSingle(
				{
					svc: svc,
					conflict: conflict,
					context: refs != null ? { refs: refs } : undefined,
					signal: this._aiAbort.signal,
					onProgress: e => {
						if (e.type === 'resolver:tool-call') {
							void this.host.notify(AIResolveProgressNotification, {
								phase: 'running',
								message: `Inspecting ${e.tool}…`,
							});
						} else if (e.type === 'resolver:step-usage') {
							void this.host.notify(AIResolveProgressNotification, {
								phase: 'running',
								message: `Step ${e.stepNumber}…`,
							});
						}
					},
				},
				{ source: 'mergeConflictEditor', detail: 'resolveWithAI' },
			);

			if (this._aiAbort?.signal.aborted) {
				await this.host.notify(AIResolveProgressNotification, { phase: 'cancelled' });
				return;
			}

			this.applyAIResolution(resolution, markerCount);
			await this.host.notify(AIResolveProgressNotification, {
				phase: 'completed',
				confidence: resolution.confidence,
				description: resolution.description,
				stepCount: resolution.metrics?.stepCount,
			});
			void this.notifyDidChangeState();
		} catch (ex) {
			const aborted = (ex as { name?: string })?.name === 'AbortError' || this._aiAbort?.signal.aborted;
			await this.host.notify(AIResolveProgressNotification, {
				phase: aborted ? 'cancelled' : 'failed',
				message: aborted ? undefined : ((ex as Error)?.message ?? 'AI resolution failed.'),
			});
			if (!aborted) {
				Logger.error(ex, 'MergeConflictWebviewProvider', 'AI resolve failed');
			}
		} finally {
			this._aiAbort = undefined;
		}
	}

	private async collectRefs(
		svc: ReturnType<Container['git']['getRepositoryService']>,
	): Promise<{ ours: string; theirs: string; base?: string } | undefined> {
		try {
			const status = await svc.pausedOps?.getPausedOperationStatus?.();
			if (status == null) return undefined;

			const ours = status.HEAD?.ref ?? 'HEAD';
			const theirs = status.incoming?.ref;
			if (!theirs) return undefined;
			return status.mergeBase != null
				? { ours: ours, theirs: theirs, base: status.mergeBase }
				: { ours: ours, theirs: theirs };
		} catch {
			return undefined;
		}
	}

	/** Map a `Resolution` from `@gitkraken/conflict-tools` into our per-hunk entry model so the
	 *  Output pane lights up checkmarks for synced lines and the manual-yellow for synthesized
	 *  lines. Lines that match a side verbatim get attributed; lines that don't are manual. */
	private applyAIResolution(resolution: ConflictToolsResolution, markerCount: number): void {
		const parsed = this._doc.parsed;
		this._contextOverrides.clear();

		if (resolution.chunks?.length !== markerCount) {
			// Fallback: no per-chunk attribution — parse the resolved content back, map each
			// resulting hunk segment to manual entries. Keeps the user able to Save & Resolve;
			// they just don't get checkmarks.
			const reparsed = parseConflictHunks(resolution.content);
			const newOverrideLines = reparsed.lines;
			// Best-effort: clear existing per-hunk entries and stuff everything into one big context
			// override on segment 0. That preserves the AI text but loses hunk-anchored editing.
			this._resolutions.clear();
			const editedFlags = newOverrideLines.map((line, i) => line !== parsed.lines[i]);
			this._contextOverrides.set(0, { lines: [...newOverrideLines], edited: editedFlags });
			return;
		}

		for (const chunk of resolution.chunks) {
			const hunk = parsed.hunks[chunk.markerIndex];
			if (hunk == null) continue;

			const entries: OutputEntry[] = this.buildEntriesFromChunk(chunk, hunk);
			if (entries.length === 0) {
				this._resolutions.delete(hunk.index);
			} else {
				this._resolutions.set(hunk.index, { hunkIndex: hunk.index, entries: entries });
			}
		}
	}

	private buildEntriesFromChunk(chunk: ResolvedChunk, hunk: ConflictHunk): OutputEntry[] {
		if (chunk.strategy === 'ours') {
			return hunk.current.lines.map((text, i) => ({
				text: text,
				source: { side: 'current', lineIndex: i },
			}));
		}
		if (chunk.strategy === 'theirs') {
			return hunk.incoming.lines.map((text, i) => ({
				text: text,
				source: { side: 'incoming', lineIndex: i },
			}));
		}

		// 'merged' — attribute each line to a side when it matches a source line, snapping back to
		// the source's exact text. The AI often normalizes whitespace (tabs→spaces, trim trailing),
		// so we index by trimmed key for fall-through matching, then re-emit the source's verbatim
		// line — that preserves the user's indent style AND keeps the source pane's checkmark.
		const currentByExact = new Map<string, number>();
		const currentByTrim = new Map<string, number>();
		hunk.current.lines.forEach((line, i) => {
			if (!currentByExact.has(line)) currentByExact.set(line, i);
			const key = line.trim();
			if (key !== '' && !currentByTrim.has(key)) currentByTrim.set(key, i);
		});
		const incomingByExact = new Map<string, number>();
		const incomingByTrim = new Map<string, number>();
		hunk.incoming.lines.forEach((line, i) => {
			if (!incomingByExact.has(line)) incomingByExact.set(line, i);
			const key = line.trim();
			if (key !== '' && !incomingByTrim.has(key)) incomingByTrim.set(key, i);
		});

		const content = (chunk as Extract<ResolvedChunk, { strategy: 'merged' }>).content;
		const lines = content.split(/\r?\n/);
		// `split` keeps a trailing empty element when the content ended on a newline — drop it so
		// we don't emit a phantom blank entry below the last code line.
		if (lines.length > 0 && lines.at(-1) === '') {
			lines.pop();
		}

		return lines.map<OutputEntry>((text: string) => {
			const exactCur = currentByExact.get(text);
			if (exactCur != null) return { text: text, source: { side: 'current', lineIndex: exactCur } };
			const exactInc = incomingByExact.get(text);
			if (exactInc != null) return { text: text, source: { side: 'incoming', lineIndex: exactInc } };

			const trimmed = text.trim();
			if (trimmed !== '') {
				const trimCur = currentByTrim.get(trimmed);
				if (trimCur != null) {
					return {
						text: hunk.current.lines[trimCur],
						source: { side: 'current', lineIndex: trimCur },
					};
				}
				const trimInc = incomingByTrim.get(trimmed);
				if (trimInc != null) {
					return {
						text: hunk.incoming.lines[trimInc],
						source: { side: 'incoming', lineIndex: trimInc },
					};
				}
			}
			return { text: text };
		});
	}

	// Kept async even though no awaits remain: `includeBootstrap` and `notifyDidChangeState`
	// dispatch state as a Promise, and keeping it Promise-returning lets us reintroduce the AI /
	// stage-1 fetches later without a calling-site cascade.
	// eslint-disable-next-line @typescript-eslint/require-await
	private async parseState(): Promise<State> {
		const filePath = this.document.uri.fsPath;
		const displayPath = workspace.asRelativePath(this.document.uri, false);

		const text = this.document.getText();
		if (text.length > maxConflictFileSize) {
			return this.makeUnsupportedState(
				'too-large',
				'This file is too large to resolve in the GitLens Merge Editor.',
			);
		}

		// A NUL byte in the first 8 KiB is a strong heuristic for binary content. VS Code
		// rarely opens truly binary files as TextDocuments, but better to bail than render garbage.
		const nul = String.fromCharCode(0);
		if (text.slice(0, 8192).includes(nul)) {
			return this.makeUnsupportedState('binary', 'Binary file content detected — resolve manually.');
		}

		const parsed = this._doc.parsed;
		if (parsed.unbalanced) {
			return this.makeUnsupportedState(
				'malformed',
				'Conflict markers in this file are unbalanced. Resolve manually in the default editor.',
				parsed.eol,
				parsed.hasDiff3,
			);
		}
		if (parsed.hunks.length === 0) {
			return this.makeUnsupportedState(
				'no-conflicts',
				'No merge conflicts detected in this file.',
				parsed.eol,
				parsed.hasDiff3,
			);
		}

		// Compute per-hunk stage ranges by walking the parsed structure. Stage 2 (ours) substitutes
		// each `<<<<<<<…=======` block with the current side's content (no markers); stage 3 does
		// the same with the incoming side.
		const hunks: MergeConflictHunk[] = [];
		let stage2Line = 1;
		let stage3Line = 1;
		let wtPrevEnd = 0;
		for (const h of parsed.hunks) {
			const contextLines = h.startLine - wtPrevEnd;
			stage2Line += contextLines;
			stage3Line += contextLines;

			const currentStart = stage2Line;
			stage2Line += h.current.lines.length;
			const incomingStart = stage3Line;
			stage3Line += h.incoming.lines.length;

			const base = h.base?.lines ?? [];
			const diff = computeThreeWayDiff(base, h.current.lines, h.incoming.lines);

			hunks.push({
				index: h.index,
				startLine: h.startLine,
				endLine: h.endLine,
				currentLabel: h.currentLabel,
				incomingLabel: h.incomingLabel,
				baseLabel: h.baseLabel,
				current: { lines: h.current.lines },
				incoming: { lines: h.incoming.lines },
				base: h.base != null ? { lines: h.base.lines } : undefined,
				currentChangedLines: [...diff.ours.added].sort((a, b) => a - b),
				incomingChangedLines: [...diff.theirs.added].sort((a, b) => a - b),
				overlapping: diff.hasOverlappingChanges,
				currentStageRange: { start: currentStart, end: stage2Line },
				incomingStageRange: { start: incomingStart, end: stage3Line },
			});
			wtPrevEnd = h.endLine + 1;
		}

		const resolutions: MergeConflictResolution[] = parsed.hunks.map(h => {
			const r = this._resolutions.get(h.index);
			return r != null ? this.toProtocolResolution(r) : this.unresolvedResolution(h.index);
		});

		// Compose the live output from per-hunk entries + per-context-segment overrides. Each
		// entry/override line carries its own source attribution (current/incoming/manual/context)
		// so the Output pane can render gutter checkmarks + manual highlights AND route gutter
		// unchecks back to the right source line.
		const subs = this.buildOutputSubstitutions(parsed.hunks);
		const composed = composeOutputWithMeta(parsed, subs, this._contextOverrides);
		const outputText = composed.text;
		const outputLineSources = composed.sources;
		const outputLineMeta = composed.metas;

		// Synthesize stage 2/3 from `parsed.lines` + per-hunk side content rather than relying on
		// `git show :2:` / `:3:`. Git's stages don't carry the auto-merged lines that the working
		// tree integrated from the other side, so their line numbers drift from our WT-anchored
		// stage-range calculation every time we cross such a region — leading to off-by-N line
		// pick misroutes after the first auto-merge. Synthesis keeps the displayed text and the
		// computed ranges perfectly in sync (both walk the same parsed structure).
		const currentResolutions = new Map<number, readonly string[]>();
		const incomingResolutions = new Map<number, readonly string[]>();
		for (const h of parsed.hunks) {
			currentResolutions.set(h.index, h.current.lines);
			incomingResolutions.set(h.index, h.incoming.lines);
		}
		const currentText = applyResolutions(parsed, currentResolutions);
		const incomingText = applyResolutions(parsed, incomingResolutions);

		return {
			...this.host.baseWebviewState,
			filePath: filePath,
			repoPath: this.repoPath,
			displayPath: displayPath,
			lines: [],
			hunks: hunks,
			resolutions: resolutions,
			outputText: outputText,
			outputLineSources: outputLineSources,
			outputLineMeta: outputLineMeta,
			currentText: currentText,
			incomingText: incomingText,
			eol: parsed.eol,
			hasDiff3: parsed.hasDiff3,
			dirty: this._resolutions.size > 0 || this._contextOverrides.size > 0,
			aiAvailable: createConflictToolsIntegration(this.container) != null,
			aiEnabled: configuration.get('mergeConflictEditor.ai.enabled') ?? true,
		};
	}

	/** Build per-hunk display data: lines + sources + back-references. Walks the per-hunk entries
	 *  (which already carry source attribution after the user's interactions). */
	private buildOutputSubstitutions(hunks: readonly ConflictHunk[]): Map<number, OutputSubstitution> {
		const map = new Map<number, OutputSubstitution>();
		for (const h of hunks) {
			const res = this._resolutions.get(h.index);
			if (res != null && res.entries.length > 0) {
				const lines: string[] = [];
				const sources: OutputLineSource[] = [];
				const metas: (OutputLineMeta | null)[] = [];
				for (const e of res.entries) {
					lines.push(e.text);
					if (e.source != null) {
						sources.push(e.source.side);
						metas.push({
							hunkIndex: h.index,
							side: e.source.side,
							lineIndexInSide: e.source.lineIndex,
						});
					} else {
						sources.push('manual');
						metas.push(null);
					}
				}
				map.set(h.index, { lines: lines, sources: sources, metas: metas });
				continue;
			}

			// Unresolved → fall back to base. Empty when no diff3 base is available.
			const baseLines = h.base?.lines ?? [];
			map.set(h.index, {
				lines: [...baseLines],
				sources: baseLines.map(() => 'base'),
				metas: baseLines.map(() => null),
			});
		}
		return map;
	}

	private makeUnsupportedState(
		reason: NonNullable<State['unsupported']>['reason'],
		message: string,
		eol: State['eol'] = '\n',
		hasDiff3: boolean = false,
	): State {
		const filePath = this.document.uri.fsPath;
		const displayPath = workspace.asRelativePath(this.document.uri, false);
		return {
			...this.host.baseWebviewState,
			filePath: filePath,
			repoPath: this.repoPath,
			displayPath: displayPath,
			lines: [],
			hunks: [],
			resolutions: [],
			outputText: '',
			outputLineSources: [],
			outputLineMeta: [],
			currentText: '',
			incomingText: '',
			eol: eol,
			hasDiff3: hasDiff3,
			dirty: false,
			aiAvailable: false,
			aiEnabled: false,
			unsupported: { reason: reason, message: message },
		};
	}

	private async getStages(): Promise<StageContent | undefined> {
		if (this._stages != null) return this._stages;
		if (this._stagesPromise != null) return this._stagesPromise;

		this._stagesPromise = (async () => {
			const svc = this.container.git.getRepositoryService(this.repoPath);
			const path = normalizePath(workspace.asRelativePath(this.document.uri, false));
			const [baseResult, currentResult, incomingResult] = await Promise.allSettled([
				readStage(svc, path, 1),
				readStage(svc, path, 2),
				readStage(svc, path, 3),
			]);

			const baseContent = baseResult.status === 'fulfilled' ? baseResult.value : undefined;
			const currentContent = currentResult.status === 'fulfilled' ? currentResult.value : undefined;
			const incomingContent = incomingResult.status === 'fulfilled' ? incomingResult.value : undefined;

			const stages: StageContent = {
				base: baseContent != null ? splitLines(baseContent) : undefined,
				current: currentContent != null ? splitLines(currentContent) : [],
				incoming: incomingContent != null ? splitLines(incomingContent) : [],
			};
			this._stages = stages;
			return stages;
		})();
		return this._stagesPromise;
	}

	private applyPickLine(params: PickLineParams): void {
		const hunk = this._doc.parsed.hunks[params.hunkIndex];
		if (hunk == null) return;

		const sideLines = params.side === 'current' ? hunk.current.lines : hunk.incoming.lines;
		if (params.lineIndex < 0 || params.lineIndex >= sideLines.length) return;

		const res = this.getOrCreateRes(params.hunkIndex);
		// Toggle: a SYNCED entry (source still attached) for this exact source line means the line
		// is "currently taken pristine" — remove it. Otherwise append a new synced entry at the end.
		// Manual entries (source dropped due to editing) never count as taken — re-picking after
		// editing adds a fresh instance below the edit, matching GitKraken Desktop.
		const existingIdx = res.entries.findIndex(
			e => e.source?.side === params.side && e.source.lineIndex === params.lineIndex,
		);
		if (existingIdx >= 0) {
			res.entries.splice(existingIdx, 1);
		} else {
			res.entries.push({
				text: sideLines[params.lineIndex],
				source: { side: params.side, lineIndex: params.lineIndex },
			});
		}
		this.afterMutate(params.hunkIndex);
	}

	private applyPickHunk(params: PickHunkParams): void {
		const hunk = this._doc.parsed.hunks[params.hunkIndex];
		if (hunk == null) return;

		const sideLines = params.side === 'current' ? hunk.current.lines : hunk.incoming.lines;

		if (this.isWholeSideTaken(params.hunkIndex, params.side)) {
			// Untake the whole side: drop every SYNCED entry on this side. Manual entries (edited
			// lines that have detached from their source) remain untouched.
			const res = this._resolutions.get(params.hunkIndex);
			if (res != null) {
				res.entries = res.entries.filter(e => e.source?.side !== params.side);
				if (res.entries.length === 0) {
					this._resolutions.delete(params.hunkIndex);
				}
			}
		} else {
			// Take the whole side: ensure every line on this side has a synced entry. Missing ones
			// are appended in source order at the end of the entry list — preserving any existing
			// picks/edits above.
			const res = this.getOrCreateRes(params.hunkIndex);
			for (let i = 0; i < sideLines.length; i++) {
				const exists = res.entries.some(e => e.source?.side === params.side && e.source.lineIndex === i);
				if (!exists) {
					res.entries.push({ text: sideLines[i], source: { side: params.side, lineIndex: i } });
				}
			}
		}
		this.afterMutate(params.hunkIndex);
	}

	private applyPickBoth(params: PickBothParams): void {
		// "Take both" is a REPLACE — used by the Take Both (C→I / I→C) toolbar buttons and by the
		// per-hunk pick-both flow. Clears existing entries (picks AND manual edits) and rebuilds
		// from both sides in the requested layout.
		const hunk = this._doc.parsed.hunks[params.hunkIndex];
		if (hunk == null) return;

		const current: OutputEntry[] = hunk.current.lines.map((text, i) => ({
			text: text,
			source: { side: 'current', lineIndex: i },
		}));
		const incoming: OutputEntry[] = hunk.incoming.lines.map((text, i) => ({
			text: text,
			source: { side: 'incoming', lineIndex: i },
		}));
		const res = this.getOrCreateRes(params.hunkIndex);
		res.entries = params.order === 'current-first' ? [...current, ...incoming] : [...incoming, ...current];
		this.afterMutate(params.hunkIndex);
	}

	private resetHunk(hunkIndex: number): void {
		if (!this._resolutions.has(hunkIndex)) return;

		this._resolutions.delete(hunkIndex);
		void this.host.notify(DidResolveNotification, { resolution: this.unresolvedResolution(hunkIndex) });
		void this.notifyDidChangeState();
	}

	private isWholeSideTaken(hunkIndex: number, side: 'current' | 'incoming'): boolean {
		const hunk = this._doc.parsed.hunks[hunkIndex];
		const res = this._resolutions.get(hunkIndex);
		if (hunk == null || res == null) return false;

		const sideLines = side === 'current' ? hunk.current.lines : hunk.incoming.lines;
		if (sideLines.length === 0) return false;
		// Every line on this side must have AT LEAST ONE synced entry. (Re-picking after editing
		// can produce duplicates; that still counts as taken.)
		return sideLines.every((_, i) => res.entries.some(e => e.source?.side === side && e.source.lineIndex === i));
	}

	private getOrCreateRes(hunkIndex: number): InternalResolution {
		let res = this._resolutions.get(hunkIndex);
		if (res == null) {
			res = { hunkIndex: hunkIndex, entries: [] };
			this._resolutions.set(hunkIndex, res);
		}
		return res;
	}

	/** Common post-mutation tasks: emit the resolve notification + dirty-flag the state. */
	private afterMutate(hunkIndex: number): void {
		const res = this._resolutions.get(hunkIndex);
		const protocolRes: MergeConflictResolution =
			res != null ? this.toProtocolResolution(res) : this.unresolvedResolution(hunkIndex);
		void this.host.notify(DidResolveNotification, { resolution: protocolRes });
		void this.notifyDidChangeState();
	}

	private toProtocolResolution(res: InternalResolution): MergeConflictResolution {
		return {
			hunkIndex: res.hunkIndex,
			entries: res.entries.map(e => ({
				text: e.text,
				source: e.source != null ? { side: e.source.side, lineIndex: e.source.lineIndex } : undefined,
			})),
			resolved: res.entries.length > 0,
		};
	}

	private unresolvedResolution(hunkIndex: number): MergeConflictResolution {
		return { hunkIndex: hunkIndex, entries: [], resolved: false };
	}

	/** Compute the actual output lines for a hunk given its current resolution. */
	private composeHunkLines(hunkIndex: number): readonly string[] | undefined {
		const res = this._resolutions.get(hunkIndex);
		if (res == null || res.entries.length === 0) return undefined;
		return res.entries.map(e => e.text);
	}

	/** Reconcile manual edits from the Output pane against per-hunk entries and per-context-segment
	 *  overrides. Diffs against the OLD composed output to locate which region the user actually
	 *  touched, then absorbs the line-count delta into that region. Within a context segment,
	 *  common-prefix + common-suffix alignment marks only the truly-changed lines as edited. */
	private reconcileManualEdit(newText: string): void {
		const parsed = this._doc.parsed;
		const newLines = newText.split(/\r?\n/);

		const oldSubs = this.buildOutputSubstitutions(parsed.hunks);
		const oldComposed = composeOutputWithMeta(parsed, oldSubs, this._contextOverrides);
		const oldLines = oldComposed.text.split(/\r?\n/);
		if (newText === oldComposed.text) return;

		let topLen = 0;
		while (topLen < oldLines.length && topLen < newLines.length && oldLines[topLen] === newLines[topLen]) {
			topLen++;
		}
		const delta = newLines.length - oldLines.length;

		interface ContextSegmentPlan {
			kind: 'context';
			segmentIndex: number;
			oldStart: number;
			oldLength: number;
			wtStart: number;
			wtEnd: number;
		}
		interface HunkPlan {
			kind: 'hunk';
			hunkIndex: number;
			oldStart: number;
			oldLength: number;
		}
		type Region = ContextSegmentPlan | HunkPlan;
		const oldPlan: Region[] = [];
		let outLine = 0;
		let wtCursor = 0;
		let segmentIndex = 0;
		for (const hunk of parsed.hunks) {
			const override = this._contextOverrides.get(segmentIndex);
			const segLength = override?.lines.length ?? hunk.startLine - wtCursor;
			oldPlan.push({
				kind: 'context',
				segmentIndex: segmentIndex,
				oldStart: outLine,
				oldLength: segLength,
				wtStart: wtCursor,
				wtEnd: hunk.startLine,
			});
			outLine += segLength;
			segmentIndex++;
			const res = this._resolutions.get(hunk.index);
			const hunkLength =
				res != null && res.entries.length > 0 ? res.entries.length : (hunk.base?.lines.length ?? 0);
			oldPlan.push({ kind: 'hunk', hunkIndex: hunk.index, oldStart: outLine, oldLength: hunkLength });
			outLine += hunkLength;
			wtCursor = hunk.endLine + 1;
		}
		{
			const override = this._contextOverrides.get(segmentIndex);
			const segLength = override?.lines.length ?? parsed.lines.length - wtCursor;
			oldPlan.push({
				kind: 'context',
				segmentIndex: segmentIndex,
				oldStart: outLine,
				oldLength: segLength,
				wtStart: wtCursor,
				wtEnd: parsed.lines.length,
			});
		}

		let anchorIndex = oldPlan.findIndex(r => topLen >= r.oldStart && topLen < r.oldStart + r.oldLength);
		if (anchorIndex < 0) {
			anchorIndex = oldPlan.length - 1;
		}

		interface SlicedRegion {
			region: Region;
			newStart: number;
			newLength: number;
		}
		const sliced: SlicedRegion[] = [];
		let newStart = 0;
		for (let i = 0; i < oldPlan.length; i++) {
			const r = oldPlan[i];
			let newLength = r.oldLength;
			if (i === anchorIndex) {
				newLength = Math.max(0, newLength + delta);
			}
			sliced.push({ region: r, newStart: newStart, newLength: newLength });
			newStart += newLength;
		}

		let mutated = false;
		for (const { region, newStart: nStart, newLength: nLength } of sliced) {
			const slice = newLines.slice(nStart, nStart + nLength);

			if (region.kind === 'hunk') {
				const res = this.getOrCreateRes(region.hunkIndex);
				const oldEntries = res.entries;
				const reconciled: OutputEntry[] = [];
				for (let i = 0; i < slice.length; i++) {
					const newLineText = slice[i];
					const oldEntry = oldEntries[i];
					if (oldEntry?.text === newLineText) {
						reconciled.push(oldEntry);
					} else {
						reconciled.push({ text: newLineText });
						mutated = true;
					}
				}
				if (oldEntries.length > slice.length) {
					mutated = true;
				}
				if (reconciled.length === 0) {
					if (this._resolutions.has(region.hunkIndex)) {
						this._resolutions.delete(region.hunkIndex);
						mutated = true;
					}
				} else if (mutated || reconciled.length !== oldEntries.length) {
					res.entries = reconciled;
				}
				continue;
			}

			const original = parsed.lines.slice(region.wtStart, region.wtEnd);
			const editedFlags: boolean[] = new Array(slice.length).fill(false);
			let prefixLen = 0;
			while (
				prefixLen < slice.length &&
				prefixLen < original.length &&
				slice[prefixLen] === original[prefixLen]
			) {
				prefixLen++;
			}
			let suffixLen = 0;
			while (
				suffixLen < slice.length - prefixLen &&
				suffixLen < original.length - prefixLen &&
				slice[slice.length - 1 - suffixLen] === original[original.length - 1 - suffixLen]
			) {
				suffixLen++;
			}
			let anyEdited = false;
			for (let i = prefixLen; i < slice.length - suffixLen; i++) {
				editedFlags[i] = true;
				anyEdited = true;
			}
			if (slice.length !== original.length) {
				anyEdited = true;
			}

			if (!anyEdited) {
				if (this._contextOverrides.has(region.segmentIndex)) {
					this._contextOverrides.delete(region.segmentIndex);
					mutated = true;
				}
			} else {
				this._contextOverrides.set(region.segmentIndex, { lines: slice, edited: editedFlags });
				mutated = true;
			}
		}

		if (mutated) {
			void this.notifyDidChangeState();
		}
	}

	private _pendingStateNotify: Promise<void> | undefined;
	private _stateNotifyDirty = false;

	private async notifyDidChangeState(): Promise<void> {
		if (!this.host.visible) return;
		if (this._pendingStateNotify != null) {
			this._stateNotifyDirty = true;
			await this._pendingStateNotify;
			return;
		}

		this._stateNotifyDirty = false;
		const promise = (async () => {
			try {
				const state = await this.parseState();
				if (this._stateNotifyDirty) return;

				await this.host.notify(DidChangeStateNotification, { state: state });
			} catch (ex) {
				Logger.error(ex, 'MergeConflictWebviewProvider', 'Failed to compute / notify state');
			} finally {
				this._pendingStateNotify = undefined;
				if (this._stateNotifyDirty) {
					this._stateNotifyDirty = false;
					void this.notifyDidChangeState();
				}
			}
		})();
		this._pendingStateNotify = promise;
		await promise;
	}
}

async function readStage(
	svc: ReturnType<Container['git']['getRepositoryService']>,
	path: string,
	stage: 1 | 2 | 3,
): Promise<string | undefined> {
	try {
		const bytes = await svc.revision.getRevisionContent(path, `:${stage}`);
		if (bytes == null) return undefined;
		return new TextDecoder('utf-8').decode(bytes);
	} catch {
		return undefined;
	}
}

function splitLines(text: string): string[] {
	const lines = text.split(/\r?\n/);
	if (lines.length > 0 && lines.at(-1) === '') {
		lines.pop();
	}
	return lines;
}

/** Compose the merged output AND the parallel sources / per-line meta arrays. Walks
 *  `parsed.lines` substituting each hunk's marker block with the caller's per-hunk content. */
function composeOutputWithMeta(
	parsed: { lines: string[]; eol: '\n' | '\r\n'; hunks: readonly ConflictHunk[] },
	substitutions: ReadonlyMap<number, OutputSubstitution>,
	contextOverrides: ReadonlyMap<number, { lines: string[]; edited: boolean[] }>,
): { text: string; sources: OutputLineSource[]; metas: (OutputLineMeta | null)[] } {
	const outLines: string[] = [];
	const outSources: OutputLineSource[] = [];
	const outMetas: (OutputLineMeta | null)[] = [];

	const emitContextSegment = (segmentIndex: number, start: number, end: number) => {
		const override = contextOverrides.get(segmentIndex);
		if (override != null) {
			for (let i = 0; i < override.lines.length; i++) {
				outLines.push(override.lines[i]);
				outSources.push(override.edited[i] ? 'manual' : 'context');
				outMetas.push(null);
			}
			return;
		}

		for (let i = start; i < end; i++) {
			outLines.push(parsed.lines[i]);
			outSources.push('context');
			outMetas.push(null);
		}
	};

	let cursor = 0;
	let segmentIndex = 0;
	for (const hunk of parsed.hunks) {
		emitContextSegment(segmentIndex, cursor, hunk.startLine);
		cursor = hunk.startLine;
		segmentIndex++;

		const sub = substitutions.get(hunk.index);
		if (sub != null) {
			for (let i = 0; i < sub.lines.length; i++) {
				outLines.push(sub.lines[i]);
				outSources.push(sub.sources[i]);
				outMetas.push(sub.metas[i]);
			}
			cursor = hunk.endLine + 1;
		} else {
			while (cursor <= hunk.endLine) {
				outLines.push(parsed.lines[cursor++]);
				outSources.push('context');
				outMetas.push(null);
			}
		}
	}
	emitContextSegment(segmentIndex, cursor, parsed.lines.length);

	return { text: outLines.join(parsed.eol), sources: outSources, metas: outMetas };
}
