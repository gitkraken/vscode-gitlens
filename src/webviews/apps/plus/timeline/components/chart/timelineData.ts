import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import type { TimelineDatum, TimelineSliceBy } from '../../../../../plus/timeline/protocol.js';

const hourMs = 60 * 60 * 1000;

/** True when a `TimelineDatum` is a synthetic working-tree row (the empty-sha "Working Tree"
 *  placeholder or a real WIP pseudo-commit). Used by surfaces that need to skip-over or
 *  replace the leading WIP run when patching the dataset. */
export function isPseudoCommitDatum(d: TimelineDatum): boolean {
	return !d.sha || isUncommitted(d.sha);
}

/**
 * Floor for the `bubbleMagnitude` denominator. On sparse datasets (n < ~10), `p99` lands on a
 * small commit and every bubble normalizes to ~1.0 — even modest changes render at `radiusMax`.
 * Anchoring against `max(p99, magnitudeAnchorLines)` lets a "medium-sized" commit (~500 lines)
 * be the smallest possible scale denominator, so a 60-line change in a 3-commit file no longer
 * looks like a 5,000-line refactor would in a busy file. Dense datasets are unaffected because
 * their p99 is far above this floor.
 */
export const magnitudeAnchorLines = 500;

/**
 * The packed view model the renderer iterates every frame. Each commit (or bin, when LOD is active)
 * occupies one slot across the parallel typed arrays so a draw pass can iterate `n` indices without
 * hopping object references — and timestamps stay primitive numbers, eliminating the per-hover
 * `new Date(d.date).getTime()` re-parse the billboard chart had scattered through its hot paths.
 */
export interface TimelineViewModel {
	timestamps: Float64Array;
	additions: Float32Array;
	deletions: Float32Array;
	bubbleR: Float32Array;
	sliceIndex: Uint16Array;
	commits: TimelineDatum[];
	binCount?: Uint16Array;

	slices: TimelineSlice[];

	oldest: number;
	newest: number;
	yMaxAdd: number;
	yMaxDel: number;

	shaToIndex: Map<string, number>;

	/**
	 * Bin indices grouped by slice, sorted ascending. Lets the overlay subtract a hidden slice's
	 * contribution from the volume bars and lets the cross-surface hover (item 4) iterate just the
	 * hovered slice's bars without scanning the whole timestamps array. Length always matches
	 * `slices.length`. Each entry's length sums to `commits.length`.
	 */
	indicesBySlice: Uint32Array[];
}

export interface TimelineSlice {
	/** Raw author / branch name (no "(you)" suffix). The chart formats display strings via
	 * `formatIdentityDisplayName` at render time, but uses this raw value as the dedup key,
	 * for initials, and for avatar lookup. */
	name: string;
	/** True when this slice represents the current Git user (author slice only). The chart's
	 * tooltip and rail use this with the user's `currentUserNameStyle` config to render the
	 * "(you)" suffix exactly once at display time. */
	current?: boolean;
	colorIndex: number;
	/** Author email (when slicing by author and the host included it in the dataset) — used by the
	 * rail to render a real gravatar instead of just initials. Undefined for branch slices and for
	 * commits with no recorded email. */
	email?: string;
	/** Pre-resolved avatar URL forwarded by the host. Undefined when the commit didn't carry an
	 * email (or when slicing by branch). The rail falls back to initials when missing. */
	avatarUrl?: string;
	/** Number of source commits in this slice — surfaced in the rail tooltip. Counted across the
	 * raw dataset, not the post-binning view model, so it's stable across zoom. */
	commitCount?: number;
}

/** Bin granularity used when commits-per-pixel is small enough that individual bubbles overlap. */
export type TimelineBinUnit = 'none' | 'hour' | 'day' | 'week' | 'month';

export interface BuildViewModelOptions {
	dataset: readonly TimelineDatum[];
	sliceBy: TimelineSliceBy;
	/** Fallback slice name when slicing by branch and the commit has no `branches` (typically `'HEAD'`). */
	defaultBranch?: string;
	/** When provided, commits are aggregated into bins of this width before rendering. Use 'none' for per-commit rendering. */
	binUnit?: TimelineBinUnit;
}

/** Pre-computed metrics over the full dataset — kept stable across zoom so radii don't pop when zooming. */
export interface BubbleMetrics {
	/** 99th percentile of (additions+deletions). Used as the cap for log-normalization. */
	p99: number;
	max: number;
}

export function buildViewModel(options: BuildViewModelOptions): TimelineViewModel {
	const { dataset, sliceBy, defaultBranch } = options;
	const binUnit = options.binUnit ?? 'none';

	const slices = collectSlices(dataset, sliceBy, defaultBranch ?? 'HEAD');
	const sliceIndexByName = new Map<string, number>();
	for (let i = 0; i < slices.length; i++) {
		sliceIndexByName.set(slices[i].name, i);
	}

	// Materialize one row per (commit × slice) so a commit on multiple branches still appears in
	// each of its swimlanes — matches the existing billboard chart's behavior at `prepareChartData`.
	const rows = expandRows(dataset, sliceBy, defaultBranch ?? 'HEAD', sliceIndexByName);

	if (binUnit !== 'none' && rows.length > 0) {
		// Bin metrics are computed inside `packBinned` over the bin SUMS — using individual-commit
		// metrics here would cap nearly every bin at the maximum (a 50-commit day-bin's total
		// trivially exceeds any single 99th-percentile commit), erasing the size signal we want.
		return packBinned(rows, slices, binUnit);
	}

	return packIndividual(rows, slices, computeBubbleMetrics(dataset));
}

function collectSlices(
	dataset: readonly TimelineDatum[],
	sliceBy: TimelineSliceBy,
	defaultBranch: string,
): TimelineSlice[] {
	const seen = new Map<string, TimelineSlice>();
	const order: string[] = [];

	const add = (name: string, email?: string, avatarUrl?: string, current?: boolean) => {
		let slice = seen.get(name);
		if (slice == null) {
			slice = { name: name, colorIndex: order.length, commitCount: 0 };
			seen.set(name, slice);
			order.push(name);
		}
		slice.commitCount = (slice.commitCount ?? 0) + 1;
		// First non-empty email/url wins so the gravatar stays stable across renders even when the
		// same author has multiple email addresses in history (renamed git config, GitHub noreply, …).
		if (slice.email == null && email != null && email.length > 0) {
			slice.email = email;
		}
		if (slice.avatarUrl == null && avatarUrl != null && avatarUrl.length > 0) {
			slice.avatarUrl = avatarUrl;
		}
		if (current) {
			slice.current = true;
		}
	};

	for (const commit of dataset) {
		if (sliceBy === 'branch') {
			if (commit.branches?.length) {
				for (const b of commit.branches) {
					add(b);
				}
			} else {
				add(defaultBranch);
			}
		} else {
			add(commit.author, commit.email, commit.avatarUrl, commit.current);
		}
	}

	return order.map(name => seen.get(name)!);
}

interface ExpandedRow {
	commit: TimelineDatum;
	timestamp: number;
	sliceIndex: number;
	bubbleR: number;
}

function expandRows(
	dataset: readonly TimelineDatum[],
	sliceBy: TimelineSliceBy,
	defaultBranch: string,
	sliceIndexByName: Map<string, number>,
): ExpandedRow[] {
	const rows: ExpandedRow[] = [];

	for (const commit of dataset) {
		// `commit.sort` is already the parsed millisecond timestamp — set by the dataset producers
		// (`timelineDataset.ts` for RPC mode; `gl-graph-timeline.ts:getWindowedDataPromise` for the
		// graph-rows-derived mode). Avoids N redundant `new Date(commit.date)` allocations per build.
		const ts = commit.sort;
		if (!Number.isFinite(ts)) continue;

		const sliceNames =
			sliceBy === 'branch' ? (commit.branches?.length ? commit.branches : [defaultBranch]) : [commit.author];

		for (const name of sliceNames) {
			const idx = sliceIndexByName.get(name);
			if (idx == null) continue;

			rows.push({ commit: commit, timestamp: ts, sliceIndex: idx, bubbleR: 0 });
		}
	}

	rows.sort((a, b) => a.timestamp - b.timestamp);
	return rows;
}

/**
 * Computes the dataset-wide p99 used by `bubbleRadius`. p99 (rather than max) so a single
 * outlier commit can't blow the scale and shrink every other bubble — once a 50K-line refactor
 * sets `max` you get all-tiny bubbles for the rest of the timeline.
 */
export function computeBubbleMetrics(dataset: readonly TimelineDatum[]): BubbleMetrics {
	if (dataset.length === 0) return { p99: 0, max: 0 };

	// Only non-zero totals contribute to the percentile — the empty Working-Tree placeholder
	// (sha = '', 0 additions/deletions) and any genuine zero-change commits would otherwise
	// drag p99 to 0 on tiny datasets (e.g. 1 real commit + the placeholder makes p99Index = 0,
	// which lands on the zero entry and collapses every real bubble to `radiusMin`).
	const sums = new Float32Array(dataset.length);
	let max = 0;
	let n = 0;
	for (const datum of dataset) {
		const total = (datum.additions ?? 0) + (datum.deletions ?? 0);
		if (total > 0) {
			sums[n++] = total;
		}
		if (total > max) {
			max = total;
		}
	}

	if (max === 0 || n === 0) return { p99: 0, max: 0 };

	const populated = sums.subarray(0, n);
	populated.sort();
	const p99Index = Math.min(n - 1, Math.floor((n - 1) * 0.99));
	return { p99: populated[p99Index], max: max };
}

function computeBinMetrics(bins: readonly { additions: number; deletions: number }[]): BubbleMetrics {
	if (bins.length === 0) return { p99: 0, max: 0 };

	// Mirrors `computeBubbleMetrics` — bins whose only contents are the zero-total Working-Tree
	// placeholder would otherwise pull p99 to 0 on sparse-bin datasets.
	const sums = new Float32Array(bins.length);
	let max = 0;
	let n = 0;
	for (const bin of bins) {
		const total = bin.additions + bin.deletions;
		if (total > 0) {
			sums[n++] = total;
		}
		if (total > max) {
			max = total;
		}
	}
	if (max === 0 || n === 0) return { p99: 0, max: 0 };

	const populated = sums.subarray(0, n);
	populated.sort();
	const p99Index = Math.min(n - 1, Math.floor((n - 1) * 0.99));
	return { p99: populated[p99Index], max: max };
}

/**
 * Normalized (0..1) magnitude for a commit's change volume — the renderer projects this onto the
 * actual row's pixel radius at draw time. Storing the normalized magnitude (not pixels) lets layout
 * changes (resize, scope change → fewer slices → taller rows) reflow bubble sizes without rebuilding
 * the view model.
 *
 * - `log1p`-normalized against `p99` so a heavy tail compresses without losing low-end resolution.
 * - `sqrt` because perceived size scales with area, not radius — without it, bubbles appear to grow
 *   too fast as values increase.
 */
export function bubbleMagnitude(
	additions: number | undefined,
	deletions: number | undefined,
	metrics: BubbleMetrics,
): number {
	const total = (additions ?? 0) + (deletions ?? 0);
	if (total <= 0) return 0;
	// Degenerate metrics (`{p99: 0, max: 0}` from an empty / all-zero dataset) — return 0 so the
	// caller renders `radiusMin`. `max <= 0` is the canonical "no real data" signal from both
	// `computeBubbleMetrics` and `computeBinMetrics`; checking it (instead of `p99 <= 0`) keeps
	// the anchor-floor logic below from kicking in on degenerate datasets.
	if (metrics.max <= 0) return 0;

	// Log-normalize against `max(p99, magnitudeAnchorLines)` so:
	// - busy files: p99 wins (e.g. 5,000) and behavior is unchanged from before
	// - sparse files (n < ~10): the anchor wins so every bubble doesn't normalize to ~1.0 and
	//   render at `radiusMax`. A 60-line commit in a 3-commit file should still look small,
	//   not max-sized.
	const denom = Math.max(metrics.p99, magnitudeAnchorLines);
	const norm = Math.log1p(total) / Math.log1p(denom);
	return Math.min(1, Math.max(0, norm));
}

/**
 * Backwards-compatible wrapper that maps the normalized magnitude to a pixel radius. Tests still
 * use this (it's the easier shape to assert against) and the legacy callers expect pixels.
 */
export function bubbleRadius(
	additions: number | undefined,
	deletions: number | undefined,
	metrics: BubbleMetrics,
	radiusMin: number,
	radiusMax: number,
): number {
	const t = bubbleMagnitude(additions, deletions, metrics);
	return radiusMin + (radiusMax - radiusMin) * t;
}

function packIndividual(rows: ExpandedRow[], slices: TimelineSlice[], metrics: BubbleMetrics): TimelineViewModel {
	const n = rows.length;
	const timestamps = new Float64Array(n);
	const additions = new Float32Array(n);
	const deletions = new Float32Array(n);
	const bubbleR = new Float32Array(n);
	const sliceIndex = new Uint16Array(n);
	const commits: TimelineDatum[] = new Array(n);
	const shaToIndex = new Map<string, number>();

	let yMaxAdd = 0;
	let yMaxDel = 0;
	let oldest = n > 0 ? rows[0].timestamp : 0;
	let newest = n > 0 ? rows[0].timestamp : 0;

	for (let i = 0; i < n; i++) {
		const row = rows[i];
		const c = row.commit;
		const a = c.additions ?? 0;
		const d = c.deletions ?? 0;

		timestamps[i] = row.timestamp;
		additions[i] = a;
		deletions[i] = d;
		sliceIndex[i] = row.sliceIndex;
		bubbleR[i] = bubbleMagnitude(a, d, metrics);
		commits[i] = c;

		// First-write-wins: a commit on multiple slices appears multiple times in `rows`, but
		// `shaToIndex` resolves to the earliest slot so a `select(sha)` round-trips deterministically.
		if (!shaToIndex.has(c.sha)) {
			shaToIndex.set(c.sha, i);
		}

		if (a > yMaxAdd) {
			yMaxAdd = a;
		}
		if (d > yMaxDel) {
			yMaxDel = d;
		}
		if (row.timestamp < oldest) {
			oldest = row.timestamp;
		}
		if (row.timestamp > newest) {
			newest = row.timestamp;
		}
	}

	return {
		timestamps: timestamps,
		additions: additions,
		deletions: deletions,
		bubbleR: bubbleR,
		sliceIndex: sliceIndex,
		commits: commits,
		slices: slices,
		oldest: oldest,
		newest: newest,
		yMaxAdd: yMaxAdd,
		yMaxDel: yMaxDel,
		shaToIndex: shaToIndex,
		indicesBySlice: groupIndicesBySlice(sliceIndex, slices.length),
	};
}

function groupIndicesBySlice(sliceIndex: Uint16Array, sliceCount: number): Uint32Array[] {
	const counts = new Uint32Array(sliceCount);
	for (const s of sliceIndex) {
		counts[s]++;
	}
	const result: Uint32Array[] = new Array(sliceCount);
	for (let s = 0; s < sliceCount; s++) {
		result[s] = new Uint32Array(counts[s]);
	}
	const cursors = new Uint32Array(sliceCount);
	for (let i = 0; i < sliceIndex.length; i++) {
		const s = sliceIndex[i];
		result[s][cursors[s]++] = i;
	}
	return result;
}

function packBinned(rows: ExpandedRow[], slices: TimelineSlice[], binUnit: TimelineBinUnit): TimelineViewModel {
	const binFn = binStartFor(binUnit);

	// Bins keyed by `binStart × sliceIndex` so each (time-bucket, swimlane) gets one aggregated bubble.
	// Counts/sums are accumulated in flight; the representative commit and shaToIndex are filled at the end.
	const binsByKey = new Map<
		string,
		{
			binStart: number;
			sliceIndex: number;
			additions: number;
			deletions: number;
			count: number;
			representative: ExpandedRow;
			shas: string[];
		}
	>();

	for (const row of rows) {
		const start = binFn(row.timestamp);
		const key = `${start}|${row.sliceIndex}`;
		const c = row.commit;
		const a = c.additions ?? 0;
		const d = c.deletions ?? 0;

		const existing = binsByKey.get(key);
		if (existing == null) {
			binsByKey.set(key, {
				binStart: start,
				sliceIndex: row.sliceIndex,
				additions: a,
				deletions: d,
				count: 1,
				representative: row,
				shas: [c.sha],
			});
		} else {
			existing.additions += a;
			existing.deletions += d;
			existing.count++;
			existing.shas.push(c.sha);
			// Pick the largest-change commit as the bin's representative — clicking the bubble opens the
			// most consequential commit in the bucket, which matches what users typically want.
			const existingMag =
				(existing.representative.commit.additions ?? 0) + (existing.representative.commit.deletions ?? 0);
			if (a + d > existingMag) {
				existing.representative = row;
			}
		}
	}

	// Sort by representative timestamp, NOT `binStart` — `viewModel.timestamps[i]` carries the
	// rep's actual ts (`timestamps[i] = b.representative.timestamp`), and downstream consumers
	// rely on that array being monotonically non-decreasing: the canvas-drawing path uses
	// `visibleIndexRange()` (binary search on `timestamps`) to cull off-screen commits, so a
	// non-monotonic array produces garbage culling and the visible bubble for a commit silently
	// disappears even though `shaToIndex` still resolves correctly (so the selection ring still
	// draws — leaving an empty ring with no underlying bubble). Sorting by `binStart` alone
	// breaks this whenever a bin's rep gets reassigned to a later commit in that bin AND a
	// different-slice bin sharing the same `binStart` keeps its earlier rep — then map
	// insertion order puts the later-rep bin before the earlier-rep bin in `vm.timestamps`.
	const sortedBins = [...binsByKey.values()].sort((a, b) => a.representative.timestamp - b.representative.timestamp);

	// Compute bubble metrics over BIN totals (not individual commits). Sums of multiple commits
	// trivially exceed any single-commit p99, so reusing the dataset-wide metrics here would clip
	// most bins to radiusMax and erase all relative size information — which was the visual
	// regression that made dense rows read as a flat color band rather than a real plot.
	const binMetrics = computeBinMetrics(sortedBins);

	const n = sortedBins.length;
	const timestamps = new Float64Array(n);
	const additions = new Float32Array(n);
	const deletions = new Float32Array(n);
	const bubbleR = new Float32Array(n);
	const sliceIndex = new Uint16Array(n);
	const binCount = new Uint16Array(n);
	const commits: TimelineDatum[] = new Array(n);
	const shaToIndex = new Map<string, number>();

	let yMaxAdd = 0;
	let yMaxDel = 0;
	// oldest/newest must track the bubble *positions* (representative timestamps), not bin starts.
	// Bubbles are drawn at `representative.timestamp` which can sit later than the bin's start
	// (e.g. day-bin starts at 00:00 but its representative commit is at 14:30) — using binStart
	// as the domain max would project the rightmost bubble past `chartRight` and clip it off.
	let oldest = n > 0 ? sortedBins[0].representative.timestamp : 0;
	let newest = n > 0 ? sortedBins[0].representative.timestamp : 0;

	for (let i = 0; i < n; i++) {
		const b = sortedBins[i];
		// Centroid the bubble at the representative's actual timestamp rather than the bin start so a
		// bin containing one commit lands precisely on that commit's date — only multi-commit bins need
		// the centroid behavior, and `representative.timestamp` is already a sensible "where the action is".
		timestamps[i] = b.representative.timestamp;
		additions[i] = b.additions;
		deletions[i] = b.deletions;
		sliceIndex[i] = b.sliceIndex;
		bubbleR[i] = bubbleMagnitude(b.additions, b.deletions, binMetrics);
		binCount[i] = Math.min(b.count, 0xffff);
		commits[i] = b.representative.commit;

		// Every sha in the bin maps to this bin's index, so `select(sha)` resolves whether the user
		// clicked the representative or one of the merged commits.
		for (const sha of b.shas) {
			if (!shaToIndex.has(sha)) {
				shaToIndex.set(sha, i);
			}
		}

		if (b.additions > yMaxAdd) {
			yMaxAdd = b.additions;
		}
		if (b.deletions > yMaxDel) {
			yMaxDel = b.deletions;
		}
		if (b.representative.timestamp < oldest) {
			oldest = b.representative.timestamp;
		}
		if (b.representative.timestamp > newest) {
			newest = b.representative.timestamp;
		}
	}

	return {
		timestamps: timestamps,
		additions: additions,
		deletions: deletions,
		bubbleR: bubbleR,
		sliceIndex: sliceIndex,
		binCount: binCount,
		commits: commits,
		slices: slices,
		oldest: oldest,
		newest: newest,
		yMaxAdd: yMaxAdd,
		yMaxDel: yMaxDel,
		shaToIndex: shaToIndex,
		indicesBySlice: groupIndicesBySlice(sliceIndex, slices.length),
	};
}

function binStartFor(unit: TimelineBinUnit): (ts: number) => number {
	switch (unit) {
		case 'hour':
			return ts => Math.floor(ts / hourMs) * hourMs;
		case 'day':
			return ts => new Date(ts).setHours(0, 0, 0, 0);
		case 'week':
			return ts => {
				const d = new Date(ts);
				d.setHours(0, 0, 0, 0);
				// ISO week: Monday-start. JS getDay returns 0..6 with Sunday=0; shift so Monday=0.
				const dow = (d.getDay() + 6) % 7;
				d.setDate(d.getDate() - dow);
				return d.getTime();
			};
		case 'month':
			return ts => {
				const d = new Date(ts);
				return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
			};
		case 'none':
		default:
			return ts => ts;
	}
}

/**
 * Picks a bin granularity given the current pixels-per-commit. The thresholds are tuned so binning
 * kicks in well before bubbles overlap into solid color bands (V3): even ~4 px/commit lets bubbles
 * with diameters of ~12px overlap heavily on dense rows, so we start aggregating to the next coarser
 * unit early. Coarse thresholds on purpose — a smoother gradient would thrash bin sizes during zoom.
 */
/** Cheap dataset-domain probe — returns just the values `_ensureViewModel` needs to pick a bin
 *  unit (oldest/newest timestamp, expanded row count). Avoids running the full `expandRows +
 *  packIndividual` pipeline twice when binning will replace the result. The expanded count
 *  matches what `expandRows` produces (sliceBy='branch' multiplies commits with branches; default
 *  is 1 row per commit). */
export function probeViewModelDomain(
	dataset: readonly TimelineDatum[],
	sliceBy: TimelineSliceBy,
): { oldest: number; newest: number; expandedCount: number } {
	let oldest = Number.POSITIVE_INFINITY;
	let newest = Number.NEGATIVE_INFINITY;
	let expandedCount = 0;
	for (const c of dataset) {
		const ts = c.sort;
		if (!Number.isFinite(ts)) continue;

		if (ts < oldest) {
			oldest = ts;
		}
		if (ts > newest) {
			newest = ts;
		}
		expandedCount += sliceBy === 'branch' ? c.branches?.length || 1 : 1;
	}
	if (!Number.isFinite(oldest)) {
		oldest = 0;
		newest = 0;
	}
	return { oldest: oldest, newest: newest, expandedCount: expandedCount };
}

export function chooseBinUnit(pxPerCommit: number): TimelineBinUnit {
	if (pxPerCommit >= 6) return 'none';
	if (pxPerCommit >= 1.5) return 'hour';
	if (pxPerCommit >= 0.3) return 'day';
	if (pxPerCommit >= 0.05) return 'week';
	return 'month';
}
