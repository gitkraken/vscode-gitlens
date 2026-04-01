import type {
	DecorationOptions,
	Disposable,
	TextEditor,
	TextEditorDecorationType,
	ThemableDecorationAttachmentRenderOptions,
} from 'vscode';
import { ColorThemeKind, Range, window } from 'vscode';
import type { GitBlame } from '@gitlens/git/models/blame.js';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { filterMap } from '@gitlens/utils/array.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { fromDisposables } from '@gitlens/utils/disposable.js';
import { first } from '@gitlens/utils/iterable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import { defer, pauseOnCancelOrTimeout } from '@gitlens/utils/promise.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import type { TokenOptions } from '@gitlens/utils/string.js';
import { getTokensFromTemplate } from '@gitlens/utils/string.js';
import type { Container } from '../container.js';
import type { CommitFormatOptions } from '../git/formatters/commitFormatter.js';
import { CommitFormatter } from '../git/formatters/commitFormatter.js';
import {
	getCommitAuthorAvatarUri,
	getCommitAuthorCachedAvatarUri,
	getCommitDate,
} from '../git/utils/-webview/commit.utils.js';
import { configuration } from '../system/-webview/configuration.js';
import type { TrackedGitDocument } from '../trackers/trackedDocument.js';
import type { AnnotationContext, AnnotationState, DidChangeStatusCallback } from './annotationProvider.js';
import { applyHeatmap, getAvatarRenderOptions, getGutterDecoration, toCssInjection } from './annotations.js';
import { BlameAnnotationProviderBase } from './blameAnnotationProvider.js';
import { Decorations } from './fileAnnotationController.js';

const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)

/**
 * Returns whether viewport-limited decoration rendering should be used.
 * Files with few unique commits can decorate everything. Files with many
 * unique commits (each producing a unique CSS style) need viewport limiting
 * to avoid overwhelming VS Code's renderer.
 */
function useViewportRendering(lineCount: number, commitCount: number): boolean {
	return lineCount > 1000 && commitCount > 500;
}

function getSpinnerPlaceholderRenderOptions(): DecorationOptions['renderOptions'] {
	const spinnerColor =
		window.activeColorTheme.kind === ColorThemeKind.Light ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
	const spinnerSvg = encodeURIComponent(
		`<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24'><path fill='none' stroke='${spinnerColor}' stroke-linecap='round' stroke-width='3' d='M 4 12 A 8 8 0 1 1 12 20'><animateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='0.8s' repeatCount='indefinite'/></path></svg>`,
	);
	return {
		before: {
			contentText: '\u00a0',
			textDecoration: toCssInjection({
				'background-image': `url("data:image/svg+xml,${spinnerSvg}")`,
				'background-repeat': 'no-repeat',
				'background-position': '4px center',
				'background-size': '14px 14px',
			}),
		},
	};
}

export interface BlameFontOptions {
	family: string;
	size: number;
	style: string;
	weight: string;
}

export class GutterBlameAnnotationProvider extends BlameAnnotationProviderBase {
	private _cancelledComputing: Deferred<never> | undefined;
	private _flushViewport: (() => void) | undefined;
	private _progressDisposable: Disposable | undefined;
	private _scrollDisposable: Disposable | undefined;
	private _cleared = false;

	constructor(
		container: Container,
		onDidChangeStatus: DidChangeStatusCallback,
		editor: TextEditor,
		trackedDocument: TrackedGitDocument,
	) {
		super(container, onDidChangeStatus, 'blame', editor, trackedDocument);
	}

	override async clear(): Promise<void> {
		this._cleared = true;
		this._cancelledComputing?.cancel();
		this._flushViewport = undefined;
		this._progressDisposable?.dispose();
		this._progressDisposable = undefined;
		this._scrollDisposable?.dispose();
		this._scrollDisposable = undefined;

		if (Decorations.gutterBlameHighlight != null) {
			try {
				this.editor.setDecorations(Decorations.gutterBlameHighlight, []);
			} catch {}
		}

		await super.clear();
	}

	override restore(editor: TextEditor, recompute?: boolean): void {
		if (this._flushViewport != null) {
			// Viewport-rendered: update the editor ref and re-flush the viewport
			// instead of replaying the (empty) stored decoration sets
			if ((this.editor as any)._disposed !== false) {
				this.editor = editor;
			}
			this._flushViewport();
			return;
		}
		super.restore(editor, recompute);
	}

	@debug()
	override async onProvideAnnotation(_context?: AnnotationContext, state?: AnnotationState): Promise<boolean> {
		this._cleared = false;
		const scope = getScopedLogger();
		using sw = maybeStopWatch(scope, { log: { onlyExit: true } });

		// Try progressive blame first — enables incremental rendering
		if (state?.recompute) {
			this.progressive = this.container.git.getBlameProgressive(this.trackedDocument.uri, this.editor.document);
			this.blame = this.progressive.then(p =>
				p != null ? p.completed : this.container.git.getBlame(this.trackedDocument.uri, this.editor.document),
			);
		}
		const progressive = await this.progressive;

		if (progressive != null && !progressive.isComplete && Decorations.gutterBlameAnnotation != null) {
			// Progressive path — blame is still streaming
			const cfg = configuration.get('blame');
			const tokenOptions = getTokensFromTemplate(cfg.format).reduce<Record<string, TokenOptions | undefined>>(
				(map, token) => {
					map[token.key] = token.options;
					return map;
				},
				Object.create(null),
			);
			const formatOptions: CommitFormatOptions = {
				dateFormat: cfg.dateFormat === null ? configuration.get('defaultDateFormat') : cfg.dateFormat,
				tokenOptions: tokenOptions,
				source: { source: 'editor:hover' },
			};

			const compact = cfg.compact;
			const heatmapEnabled = cfg.heatmap.enabled;
			const avatars = cfg.avatars;
			const gravatarDefault = avatars ? configuration.get('defaultGravatarsStyle') : undefined;

			const placeholderRenderOptions = getSpinnerPlaceholderRenderOptions();
			const compactRenderOptions: DecorationOptions['renderOptions'] = {
				before: { contentText: '\u00a0' },
			};

			// Pre-build full decoration array with placeholders
			const lineCount = this.editor.document.lineCount;
			const decorations: DecorationOptions[] = new Array<DecorationOptions>(lineCount);
			for (let i = 0; i < lineCount; i++) {
				decorations[i] = { range: new Range(i, 0, i, 0), renderOptions: placeholderRenderOptions };
			}

			// Use the leader type during progressive so there's no type switch at completion
			// (which would cause a flash). The final render adds gutterBlameCompact for
			// compact followers additively — no replacement of the leader type needed.
			const decorationType = Decorations.gutterBlameAnnotation;
			// Show placeholders immediately — viewport only for speed
			const visibleRanges = this.editor.visibleRanges;
			if (visibleRanges.length > 0) {
				const vpStart = Math.max(0, visibleRanges[0].start.line - 200);
				const vpEnd = Math.min(lineCount, visibleRanges.at(-1)!.end.line + 201);
				this.editor.setDecorations(decorationType, decorations.slice(vpStart, vpEnd));
			}

			sw?.log({ suffix: ` [${sw?.elapsed() ?? 0}ms] to apply placeholders for ${lineCount} lines` });

			// Fast-path: if blame completes within 100ms of placeholders showing, skip progressive
			const blameResult = await pauseOnCancelOrTimeout(
				progressive.completed.then(b => b),
				undefined,
				100,
			);
			if (!blameResult.paused) {
				await this.renderBlameDecorations(blameResult.value);
				sw?.stop({
					suffix: ` to compute and apply gutter blame annotations (immediate); ${lineCount} lines, ${blameResult.value.commits.size} commits`,
				});
				this.registerHoverProviders(configuration.get('hovers.annotations'));
				return true;
			}

			const resolvedLines = new Uint8Array(lineCount);
			const commitDecorationCache = new Map<string, DecorationOptions['renderOptions']>();

			// Avatar tracking
			const knownEmails = avatars ? new Set<string>() : undefined;
			const avatarCache = avatars ? new Map<string, ThemableDecorationAttachmentRenderOptions>() : undefined;
			const pendingAvatars: Promise<void>[] = [];
			let lastAvatarCacheSize = 0;

			const startAvatarFetch = (commit: GitCommit): void => {
				const email = commit.author.email;
				if (email == null || knownEmails!.has(email)) return;
				knownEmails!.add(email);

				// Check sync cache first to avoid async fetch for already-known avatars
				const cachedUri = getCommitAuthorCachedAvatarUri(commit, { size: 16 });
				if (cachedUri != null) {
					const avatar = getAvatarRenderOptions(cachedUri.toString(true));
					avatarCache!.set(email, avatar);
					for (const [sha, opts] of commitDecorationCache) {
						const c = progressive.current.commits.get(sha);
						if (c?.author.email === email) {
							commitDecorationCache.set(sha, { ...opts, after: avatar });
						}
					}
					return;
				}

				pendingAvatars.push(
					(async () => {
						const uri = await getCommitAuthorAvatarUri(commit, {
							defaultStyle: gravatarDefault!,
							size: 16,
						});
						const avatar = getAvatarRenderOptions(uri.toString(true));
						avatarCache!.set(email, avatar);
						for (const [sha, opts] of commitDecorationCache) {
							const c = progressive.current.commits.get(sha);
							if (c?.author.email === email) {
								commitDecorationCache.set(sha, { ...opts, after: avatar });
							}
						}
					})(),
				);
			};

			// Viewport-aware rendering: only flush visible lines + buffer to VS Code
			const viewportBuffer = 200;
			const getViewportRange = (): [start: number, end: number] | undefined => {
				const ranges = this.editor.visibleRanges;
				if (!ranges.length) return undefined;
				return [
					Math.max(0, ranges[0].start.line - viewportBuffer),
					Math.min(lineCount, ranges.at(-1)!.end.line + viewportBuffer + 1),
				];
			};
			const flushDecorations = (): void => {
				const vp = getViewportRange();
				if (vp == null) return;

				sw?.log({ suffix: ` applying updated decorations to viewport (${vp[0]}-${vp[1] - 1})` });
				this.editor.setDecorations(decorationType, decorations.slice(vp[0], vp[1]));
			};

			// Re-render on scroll so newly visible lines get decorations
			const onScroll = window.onDidChangeTextEditorVisibleRanges(e => {
				if (e.textEditor === this.editor) {
					flushDecorations();
				}
			});

			// Accumulate indices across debounced events
			let pendingIndices: number[] = [];

			// Core update — processes ONLY new line indices from the producer
			const updateDecorations = (blame: GitBlame): void => {
				const newIndices = pendingIndices;
				pendingIndices = [];

				if (!newIndices.length && !(avatarCache != null && avatarCache.size > lastAvatarCacheSize)) {
					return;
				}

				let viewportChanged = false;
				const vp = getViewportRange();

				for (const i of newIndices) {
					if (i < 0 || i >= lineCount || resolvedLines[i]) continue;

					const l = blame.lines[i];
					if (l == null) continue;

					const commit = blame.commits.get(l.sha);
					if (commit == null) continue;

					resolvedLines[i] = 1;
					if (vp != null && i >= vp[0] && i < vp[1]) {
						viewportChanged = true;
					}

					let commitRenderOptions = commitDecorationCache.get(l.sha);
					if (commitRenderOptions == null) {
						const gutter = getGutterDecoration(commit, cfg.format, formatOptions, {
							separateLines: cfg.separateLines,
						});
						commitRenderOptions = gutter.renderOptions;

						if (avatarCache != null) {
							const avatar = avatarCache.get(commit.author.email ?? '');
							if (avatar != null) {
								commitRenderOptions = { ...commitRenderOptions, after: avatar };
							}
						}
						commitDecorationCache.set(l.sha, commitRenderOptions);

						if (avatars) {
							startAvatarFetch(commit);
						}
					}

					const prevSha = blame.lines[i - 1]?.sha;
					if (compact && prevSha === l.sha) {
						decorations[i].renderOptions = compactRenderOptions;
					} else {
						decorations[i].renderOptions = commitRenderOptions;
					}

					if (compact && i + 1 < lineCount && resolvedLines[i + 1]) {
						const nextSha = blame.lines[i + 1]?.sha;
						if (nextSha === l.sha) {
							decorations[i + 1].renderOptions = compactRenderOptions;
						}
					}
				}

				// Re-apply avatars only when new ones resolved
				if (avatarCache != null && avatarCache.size > lastAvatarCacheSize) {
					lastAvatarCacheSize = avatarCache.size;
					for (let i = 0; i < lineCount; i++) {
						if (!resolvedLines[i]) continue;
						const l = blame.lines[i];
						if (l == null) continue;

						const updated = commitDecorationCache.get(l.sha);
						if (updated != null && updated !== decorations[i].renderOptions) {
							const prevSha = blame.lines[i - 1]?.sha;
							if (!(compact && prevSha === l.sha)) {
								decorations[i].renderOptions = updated;
								if (vp != null && i >= vp[0] && i < vp[1]) {
									viewportChanged = true;
								}
							}
						}
					}
				}

				if (viewportChanged) {
					flushDecorations();
				}
			};

			// Event-driven: debounced listener — 150ms trailing for quick response after streaming ends, 1000ms maxWait limits setDecorations calls during streaming (~1/sec)
			const debouncedUpdate = debounce((blame: GitBlame) => updateDecorations(blame), 150, { maxWait: 1000 });

			this._progressDisposable?.dispose();
			const progressSubscription = progressive.onDidProgress(e => {
				if (e.complete) return;

				// Accumulate indices — debounce may batch multiple events
				for (const idx of e.newLineIndices) {
					pendingIndices.push(idx);
				}
				debouncedUpdate(e.blame);
			});
			this._progressDisposable = fromDisposables(
				progressSubscription,
				{ dispose: () => debouncedUpdate.cancel?.() },
				onScroll,
			);

			// Wait for completion — race against clear() cancellation so toggling
			// blame off doesn't hang waiting for the git process to finish
			this._cancelledComputing = defer<never>();
			this._cancelledComputing.promise.catch(() => {});

			let blame: GitBlame;
			try {
				blame = await Promise.race([progressive.completed, this._cancelledComputing.promise]);
			} catch {
				// Cancelled by clear() or streaming failed — cleanup either way
				this._progressDisposable?.dispose();
				this._progressDisposable = undefined;
				return false;
			}
			sw?.log({
				suffix: ` [${sw?.elapsed() ?? 0}ms] to stream git blame; ${blame.commits.size} commits`,
			});
			this._progressDisposable?.dispose();
			this._progressDisposable = undefined;
			// Process any remaining new lines
			updateDecorations(blame);

			// Post-completion: apply heatmap + tips to existing decorations in-place.
			const needsTips = CommitFormatter.has(cfg.format, 'tips');

			if (heatmapEnabled || needsTips) {
				let finalFormatOptions = formatOptions;
				if (needsTips) {
					const tips = await this.container.git
						.getRepositoryService(blame.repoPath)
						.getBranchesAndTagsTipsLookup();
					if (tips != null) {
						finalFormatOptions = { ...formatOptions, getBranchAndTagTips: tips };
					}
				}

				const computedHeatmap = heatmapEnabled ? this.getComputedHeatmap(blame) : undefined;
				const compactHeatmapCache = new Map<string, DecorationOptions['renderOptions']>();

				for (const [sha, opts] of commitDecorationCache) {
					const commit = blame.commits.get(sha);
					if (commit == null) continue;

					let enhanced: DecorationOptions['renderOptions'];
					if (needsTips && finalFormatOptions !== formatOptions) {
						enhanced = getGutterDecoration(commit, cfg.format, finalFormatOptions, {
							separateLines: cfg.separateLines,
						}).renderOptions;
					} else {
						enhanced = opts;
					}

					if (computedHeatmap != null && enhanced?.before != null) {
						enhanced = { ...enhanced, before: { ...enhanced.before } };
						applyHeatmap(
							{ renderOptions: enhanced } as Partial<DecorationOptions>,
							getCommitDate(commit),
							computedHeatmap,
						);
					}

					const avatar = avatarCache?.get(commit.author.email ?? '');
					if (avatar != null) {
						enhanced = { ...enhanced, after: avatar };
					}

					commitDecorationCache.set(sha, enhanced);
				}

				for (let i = 0; i < lineCount; i++) {
					const l = blame.lines[i];
					if (l == null) continue;

					const prevSha = blame.lines[i - 1]?.sha;
					if (compact && prevSha === l.sha) {
						if (computedHeatmap != null) {
							let compactOpts = compactHeatmapCache.get(l.sha);
							if (compactOpts == null) {
								const commit = blame.commits.get(l.sha);
								if (commit != null) {
									compactOpts = { before: { ...compactRenderOptions.before } };
									applyHeatmap(
										{ renderOptions: compactOpts } as Partial<DecorationOptions>,
										getCommitDate(commit),
										computedHeatmap,
									);
									compactHeatmapCache.set(l.sha, compactOpts);
								}
							}
							if (compactOpts != null) {
								decorations[i].renderOptions = compactOpts;
							}
						}
					} else {
						const updated = commitDecorationCache.get(l.sha);
						if (updated != null) {
							decorations[i].renderOptions = updated;
						}
					}
				}
			}

			// Final render — split decorations into leader + compact
			const splitDecorations = (): {
				leaderDecorations: DecorationOptions[];
				compactDecorations: DecorationOptions[];
			} => {
				const vpLeader: DecorationOptions[] = [];
				const vpCompact: DecorationOptions[] = [];
				for (let i = 0; i < lineCount; i++) {
					const d = decorations[i];
					if (d?.renderOptions == null) continue;

					const l = blame.lines[i];
					if (l == null) continue;

					const prevSha = blame.lines[i - 1]?.sha;
					if (compact && prevSha === l.sha) {
						vpCompact.push(d);
					} else {
						vpLeader.push(d);
					}
				}
				return { leaderDecorations: vpLeader, compactDecorations: vpCompact };
			};

			// Split into leader + compact and set up rendering
			const allSplit = splitDecorations();
			const useVpRendering = useViewportRendering(lineCount, blame.commits.size);

			let flushFinal: (() => void) | undefined;

			if (!useVpRendering) {
				// Small/simple file — send all decorations at once via base class
				const decorationSets: {
					decorationType: TextEditorDecorationType;
					rangesOrOptions: DecorationOptions[];
				}[] = [];
				if (allSplit.leaderDecorations.length && Decorations.gutterBlameAnnotation != null) {
					decorationSets.push({
						decorationType: Decorations.gutterBlameAnnotation,
						rangesOrOptions: allSplit.leaderDecorations,
					});
				}
				if (allSplit.compactDecorations.length && Decorations.gutterBlameCompact != null) {
					decorationSets.push({
						decorationType: Decorations.gutterBlameCompact,
						rangesOrOptions: allSplit.compactDecorations,
					});
				}
				if (decorationSets.length) {
					this.setDecorations(decorationSets);
				}

				// For avatar updates, re-send all via base class
				flushFinal = () => this.setDecorations(decorationSets);
			} else {
				// Complex file — viewport-only rendering
				const allLeader = new Array<DecorationOptions | undefined>(lineCount);
				for (const d of allSplit.leaderDecorations) {
					allLeader[d.range.start.line] = d;
				}
				const allCompact = new Array<DecorationOptions | undefined>(lineCount);
				for (const d of allSplit.compactDecorations) {
					allCompact[d.range.start.line] = d;
				}

				if (this._cleared) return false;

				flushFinal = this.setupViewportRendering(allLeader, allCompact, lineCount);
			}

			sw?.stop({
				suffix: ` to compute and apply gutter blame annotations (progressive); ${lineCount} lines, ${blame.commits.size} commits`,
			});

			// Avatars: keep applying as they resolve (non-blocking)
			if (pendingAvatars.length > 0) {
				const applyAvatars = (): boolean => {
					let applied = false;
					for (let i = 0; i < lineCount; i++) {
						const d = decorations[i];
						if (d?.renderOptions == null) continue;

						const l = blame.lines[i];
						if (l == null) continue;

						const prevSha = blame.lines[i - 1]?.sha;
						if (compact && prevSha === l.sha) continue;

						const updated = commitDecorationCache.get(l.sha);
						if (updated != null && updated !== d.renderOptions) {
							d.renderOptions = updated;
							applied = true;
						}
					}
					return applied;
				};

				void Promise.allSettled(pendingAvatars).then(() => {
					if (this._cleared) return;

					if (applyAvatars()) {
						flushFinal?.();
					}
				});
			}

			this.registerHoverProviders(configuration.get('hovers.annotations'));
			return true;
		}

		// Non-progressive path (dirty docs, or already complete)
		const blame = await this.getBlame(state?.recompute);
		if (blame == null) return false;

		await this.renderBlameDecorations(blame);
		sw?.stop({
			suffix: ` to compute and apply gutter blame annotations (non-progressive); ${blame.lines.length} lines, ${blame.commits.size} commits`,
		});

		this.registerHoverProviders(configuration.get('hovers.annotations'));
		return true;
	}

	/**
	 * Full blame render using two decoration types (leader + compact).
	 * Per-instance renderOptions only carry line-varying properties (contentText, borderColor, after).
	 * Base CSS (background, font, width, margin) lives on the decoration types.
	 */
	private async renderBlameDecorations(blame: GitBlame): Promise<void> {
		if (Decorations.gutterBlameAnnotation == null || Decorations.gutterBlameCompact == null) return;

		const cfg = configuration.get('blame');

		// Precalculate the formatting options so we don't need to do it on each iteration
		const tokenOptions = getTokensFromTemplate(cfg.format).reduce<Record<string, TokenOptions | undefined>>(
			(map, token) => {
				map[token.key] = token.options;
				return map;
			},
			Object.create(null),
		);

		let getBranchAndTagTips;
		if (CommitFormatter.has(cfg.format, 'tips')) {
			getBranchAndTagTips = await this.container.git
				.getRepositoryService(blame.repoPath)
				.getBranchesAndTagsTipsLookup();
		}

		const formatOptions: CommitFormatOptions = {
			dateFormat: cfg.dateFormat === null ? configuration.get('defaultDateFormat') : cfg.dateFormat,
			getBranchAndTagTips: getBranchAndTagTips,
			tokenOptions: tokenOptions,
			source: { source: 'editor:hover' },
		};

		const avatars = cfg.avatars;
		const gravatarDefault = configuration.get('defaultGravatarsStyle');

		let computedHeatmap;
		if (cfg.heatmap.enabled) {
			computedHeatmap = this.getComputedHeatmap(blame);
		}

		// Two decoration arrays: leader lines (with separator) and compact/follower lines (without)
		const leaderDecorations: DecorationOptions[] = [];
		const compactDecorations: DecorationOptions[] = [];

		// Shared render options per commit SHA — only contentText + maybe borderColor + uncommitted color
		const commitRenderCache = new Map<string, DecorationOptions['renderOptions']>();
		// Compact lines: all share a single renderOptions (just space content + maybe borderColor)
		const compactRenderCache = new Map<string, DecorationOptions['renderOptions']>();

		// Collect unique commits for parallel avatar fetching
		const avatarCommits = avatars ? new Map<string, GitCommit>() : undefined;

		let commit: GitCommit | undefined;
		let previousSha: string | undefined;

		const lineCount = this.editor.document.lineCount;
		for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
			const l = blame.lines[lineIndex];
			if (l == null) continue;

			// editor lines are 0-based
			const editorLine = l.line - 1;

			commit = blame.commits.get(l.sha);
			if (commit == null) continue;

			// Compact follower: same SHA as previous line
			if (cfg.compact && previousSha === l.sha) {
				let compactOpts = compactRenderCache.get(l.sha);
				if (compactOpts == null) {
					compactOpts = { before: { contentText: '\u00a0' } };
					if (computedHeatmap != null) {
						applyHeatmap(
							{ renderOptions: compactOpts } as Partial<DecorationOptions>,
							getCommitDate(commit),
							computedHeatmap,
						);
					}
					compactRenderCache.set(l.sha, compactOpts);
				}
				compactDecorations.push({ range: new Range(editorLine, 0, editorLine, 0), renderOptions: compactOpts });
				continue;
			}

			previousSha = l.sha;

			// Leader line: get or build render options
			let leaderOpts = commitRenderCache.get(l.sha);
			if (leaderOpts == null) {
				const gutter = getGutterDecoration(commit, cfg.format, formatOptions, {
					separateLines: cfg.separateLines,
				});
				leaderOpts = gutter.renderOptions;
				if (computedHeatmap != null) {
					applyHeatmap(
						{ renderOptions: leaderOpts } as Partial<DecorationOptions>,
						getCommitDate(commit),
						computedHeatmap,
					);
				}
				commitRenderCache.set(l.sha, leaderOpts);

				// Track for avatar fetching
				if (avatarCommits != null && commit.author.email != null) {
					avatarCommits.set(commit.author.email, commit);
				}
			}

			leaderDecorations.push({ range: new Range(editorLine, 0, editorLine, 0), renderOptions: leaderOpts });
		}

		// Parallel avatar fetching — all at once instead of sequential await in loop
		if (avatarCommits != null && avatarCommits.size > 0) {
			const avatarMap = new Map<string, ThemableDecorationAttachmentRenderOptions>();
			await Promise.allSettled(
				Array.from(avatarCommits.entries(), async ([email, c]) => {
					const url = (
						await getCommitAuthorAvatarUri(c, { defaultStyle: gravatarDefault, size: 16 })
					).toString(true);
					avatarMap.set(email, getAvatarRenderOptions(url));
				}),
			);

			// Apply avatars — cached per author email, so only leader lines with a
			// known email get the avatar. Compact lines intentionally skip avatars.
			for (const [sha, opts] of commitRenderCache) {
				const c = blame.commits.get(sha);
				if (c?.author.email == null) continue;

				const avatar = avatarMap.get(c.author.email);
				if (avatar != null) {
					commitRenderCache.set(sha, { ...opts, after: avatar });
				}
			}

			// Re-apply updated render options to leader decorations
			for (const decoration of leaderDecorations) {
				const line = decoration.range.start.line;
				const l = blame.lines[line];
				if (l == null) continue;

				const updated = commitRenderCache.get(l.sha);
				if (updated != null) {
					decoration.renderOptions = updated;
				}
			}
		}

		if (!useViewportRendering(lineCount, blame.commits.size)) {
			// Small/simple file — send all decorations at once
			const decorationSets: { decorationType: TextEditorDecorationType; rangesOrOptions: DecorationOptions[] }[] =
				[];
			if (leaderDecorations.length) {
				decorationSets.push({
					decorationType: Decorations.gutterBlameAnnotation,
					rangesOrOptions: leaderDecorations,
				});
			}
			if (compactDecorations.length && Decorations.gutterBlameCompact != null) {
				decorationSets.push({
					decorationType: Decorations.gutterBlameCompact,
					rangesOrOptions: compactDecorations,
				});
			}
			if (decorationSets.length) {
				this.setDecorations(decorationSets);
			}
		} else {
			// Complex file — viewport-only rendering to avoid overwhelming VS Code's
			// renderer with thousands of unique per-instance decoration styles
			const allLeader = new Array<DecorationOptions | undefined>(lineCount);
			for (const d of leaderDecorations) {
				allLeader[d.range.start.line] = d;
			}
			const allCompact = new Array<DecorationOptions | undefined>(lineCount);
			for (const d of compactDecorations) {
				allCompact[d.range.start.line] = d;
			}

			this.setupViewportRendering(allLeader, allCompact, lineCount);
		}
	}

	/**
	 * Sets up viewport-limited decoration rendering. Sends only the visible
	 * lines + padding to VS Code and re-applies on scroll. Stores a
	 * `_flushViewport` reference so `restore()` can re-apply after tab switch.
	 */
	private setupViewportRendering(
		allLeader: (DecorationOptions | undefined)[],
		allCompact: (DecorationOptions | undefined)[],
		lineCount: number,
	): () => void {
		const flushViewport = (): void => {
			const ranges = this.editor.visibleRanges;
			if (!ranges.length) return;

			const visibleLines = ranges.at(-1)!.end.line - ranges[0].start.line;
			const padding = Math.max(visibleLines, 500);
			const vpStart = Math.max(0, ranges[0].start.line - padding);
			const vpEnd = Math.min(lineCount, ranges.at(-1)!.end.line + padding + 1);

			const vpLeader: DecorationOptions[] = [];
			const vpCompact: DecorationOptions[] = [];
			for (let i = vpStart; i < vpEnd; i++) {
				const ld = allLeader[i];
				if (ld != null) {
					vpLeader.push(ld);
					continue;
				}
				const cd = allCompact[i];
				if (cd != null) {
					vpCompact.push(cd);
				}
			}

			if (Decorations.gutterBlameAnnotation != null) {
				this.editor.setDecorations(Decorations.gutterBlameAnnotation, vpLeader);
			}
			if (Decorations.gutterBlameCompact != null) {
				this.editor.setDecorations(Decorations.gutterBlameCompact, vpCompact);
			}
		};

		// Track types for base class clear()
		const decorationSets: { decorationType: TextEditorDecorationType; rangesOrOptions: DecorationOptions[] }[] = [];
		if (Decorations.gutterBlameAnnotation != null) {
			decorationSets.push({ decorationType: Decorations.gutterBlameAnnotation, rangesOrOptions: [] });
		}
		if (Decorations.gutterBlameCompact != null) {
			decorationSets.push({ decorationType: Decorations.gutterBlameCompact, rangesOrOptions: [] });
		}
		this.decorations = decorationSets;

		this._scrollDisposable?.dispose();
		this._scrollDisposable = window.onDidChangeTextEditorVisibleRanges(e => {
			if (e.textEditor === this.editor) {
				flushViewport();
			}
		});

		this._flushViewport = flushViewport;
		flushViewport();

		return flushViewport;
	}

	@debug({ args: false })
	override async selection(selection?: AnnotationContext['selection']): Promise<void> {
		if (selection === false || Decorations.gutterBlameHighlight == null) return;

		const blame = await this.blame;
		if (!blame?.lines.length) return;

		let sha: string | undefined = undefined;
		if (selection?.sha != null) {
			sha = selection.sha;
		} else if (selection?.line != null) {
			if (selection.line >= 0) {
				const commitLine = blame.lines[selection.line];
				sha = commitLine?.sha;
			}
		} else {
			sha = first(blame.commits.values())?.sha;
		}

		if (!sha) {
			this.editor.setDecorations(Decorations.gutterBlameHighlight, []);
			return;
		}

		const highlightDecorationRanges = filterMap(blame.lines, l =>
			l.sha === sha
				? // editor lines are 0-based
					this.editor.document.validateRange(new Range(l.line - 1, 0, l.line - 1, maxSmallIntegerV8))
				: undefined,
		);

		this.editor.setDecorations(Decorations.gutterBlameHighlight, highlightDecorationRanges);
	}
}
