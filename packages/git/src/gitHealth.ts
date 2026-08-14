import type {
	GitHealthSnapshot,
	GitMaintenanceTask,
	GitOptimizationCapability,
	GitOptimizationId,
} from './providers/maintenance.js';

/**
 * Pure recommendation engine for the Git Health feature — no vscode imports, trivially unit-testable.
 * Thresholds are initial, tunable, telemetry-informed values (see `.work/dev/git-health/spec.md`).
 */

/** Working-tree size (via the index-bytes proxy) at/above which untracked-cache/fsmonitor/manyFiles help. */
export const trackedFilesThreshold = 10_000;
/** Loose-object estimate at/above which the `loose-objects` maintenance task is worth running. */
export const looseObjectsThreshold = 5_000;
/** Pack-file count at/above which the `incremental-repack` maintenance task is worth running. */
export const packCountThreshold = 20;
/** Total pack bytes at/above which a repo counts as "clearly large" for the banner gate (~1 GiB). */
export const largePackBytesThreshold = 1024 ** 3;
/** Rough bytes-per-entry of a git v2 index — turns `.git/index` size into a tracked-file-count proxy. */
export const approxBytesPerIndexEntry = 80;
/** Duration (ms) above which a git command is "slow" — mirrors the exec-layer slow-call threshold. */
export const slowCommandThresholdMs = 2000;

/** Persisted passive-slowness summary per repo (rides the `onSlowCommand` exec hook). */
export interface GitHealthSlowness {
	/** Number of slow git commands observed for this repo. */
	readonly count: number;
	/** Epoch ms of the most recent slow command. */
	readonly lastAt: number;
	/** Longest single slow-command duration observed (ms). */
	readonly maxDurationMs: number;
}

export type GitOptimizationTier = 'auto' | 'ask';

/** Coarse duration buckets for maintenance telemetry. */
export type GitHealthDurationBucket = '<1s' | '1-5s' | '5-15s' | '15-60s' | '>60s';

/** Which measured signal tripped a finding (drives view copy + telemetry buckets). */
export type GitHealthFindingReason = 'looseObjects' | 'packCount' | 'trackedFiles' | 'largePacks' | 'slowness';

/** A single recommendation: a lever to apply, its tier, and the evidence that triggered it. */
export interface GitHealthFinding {
	readonly tier: GitOptimizationTier;
	readonly reason: GitHealthFindingReason;
	/** The measured value that crossed the threshold. */
	readonly value: number;
	/** The threshold it crossed. */
	readonly threshold: number;
	/** The concrete action this finding recommends. */
	readonly action:
		| { readonly kind: 'maintenance'; readonly task: GitMaintenanceTask }
		| { readonly kind: 'optimization'; readonly id: GitOptimizationId };
}

export interface GitHealthReport {
	readonly findings: readonly GitHealthFinding[];
	/** Whether the repo is "clearly large" (any working-tree threshold met, or pack bytes ≥ ~1 GiB). */
	readonly clearlyLarge: boolean;
	/** Extrapolated loose-object count (from the probe sample). */
	readonly estimatedLooseObjects: number;
	/** Extrapolated tracked-file count (from the index-bytes proxy, or exact — see {@link trackedFilesExact}). */
	readonly estimatedTrackedFiles: number;
	/** `true` when {@link estimatedTrackedFiles} is the exact index-header count rather than the byte-size proxy. */
	readonly trackedFilesExact: boolean;
	readonly packCount: number;
	readonly packBytes: number;
	readonly commitGraph: {
		readonly present: boolean;
		readonly mtime: number | undefined;
		readonly changedPaths: boolean;
		readonly changedPathsSupported: boolean;
		readonly disabled: boolean;
		/** `core.commitGraph` explicitly false in git config — git won't read the cache, GitLens won't write it. */
		readonly readDisabled: boolean;
	};
}

/**
 * Extrapolates total loose-object count from a uniform sample of the 256 object fanout dirs. Loose
 * objects distribute uniformly by sha prefix, so `(objectsInSampled / dirsSampled) * 256` is sound.
 */
export function estimateLooseObjects(objectsInSampled: number, dirsSampled: number): number {
	if (dirsSampled <= 0) return 0;

	return Math.round((objectsInSampled / dirsSampled) * 256);
}

/** Turns `.git/index` byte size into an approximate tracked-file count. */
export function estimateTrackedFiles(indexBytes: number): number {
	if (indexBytes <= 0) return 0;

	return Math.round(indexBytes / approxBytesPerIndexEntry);
}

/**
 * Computes the {@link GitHealthReport} from a cheap probe, passive slowness, and capabilities. Findings
 * are only emitted for levers that are supported, not already applied, and past their threshold.
 */
export function computeHealthReport(
	snapshot: GitHealthSnapshot,
	slowness: GitHealthSlowness | undefined,
	capabilities: readonly GitOptimizationCapability[],
): GitHealthReport {
	const estimatedLooseObjects = estimateLooseObjects(
		snapshot.looseObjects.objectsInSampledDirs,
		snapshot.looseObjects.dirsSampled,
	);
	// Prefer the exact index-header count over the byte-size proxy whenever it's available.
	const estimatedTrackedFiles = snapshot.indexEntryCount ?? estimateTrackedFiles(snapshot.indexBytes);
	const trackedFilesExact = snapshot.indexEntryCount != null;
	const largeWorkingTree = estimatedTrackedFiles >= trackedFilesThreshold;
	const clearlyLarge = largeWorkingTree || snapshot.packBytes >= largePackBytesThreshold;

	const supported = (id: GitOptimizationId): boolean => capabilities.find(c => c.id === id)?.supported === true;

	const findings: GitHealthFinding[] = [];

	// Auto tier — safe `git maintenance run` one-shots (gated on `git maintenance` support).
	if (snapshot.supportsMaintenanceRun) {
		if (estimatedLooseObjects >= looseObjectsThreshold) {
			findings.push({
				tier: 'auto',
				reason: 'looseObjects',
				value: estimatedLooseObjects,
				threshold: looseObjectsThreshold,
				action: { kind: 'maintenance', task: 'loose-objects' },
			});
		}
		if (snapshot.packCount >= packCountThreshold) {
			findings.push({
				tier: 'auto',
				reason: 'packCount',
				value: snapshot.packCount,
				threshold: packCountThreshold,
				action: { kind: 'maintenance', task: 'incremental-repack' },
			});
		}
	}

	// Large-working-tree levers share the same evidence; they differ only in tier and eligibility.
	const trackedFilesEvidence = {
		reason: 'trackedFiles',
		value: estimatedTrackedFiles,
		threshold: trackedFilesThreshold,
	} as const;
	const workingTreeLevers: { id: GitOptimizationId; tier: GitOptimizationTier; eligible: boolean }[] = [
		{
			id: 'untrackedCache',
			tier: 'ask',
			// Skip if already on, if it previously failed git's filesystem probe for this repo, or if the
			// user set the key themselves — an explicit `false`/`keep` is a decision (often made after bad
			// `git status` results), and this lever respects it rather than overriding it.
			eligible:
				!snapshot.config.untrackedCache &&
				!snapshot.config.untrackedCacheConfigured &&
				!snapshot.untrackedCacheNotApplicable,
		},
		{
			id: 'fsmonitor',
			tier: 'ask',
			// Skip if already on or it previously failed to start for this repo.
			eligible: !snapshot.config.fsmonitor && !snapshot.fsmonitorNotApplicable,
		},
		{ id: 'manyFiles', tier: 'ask', eligible: !snapshot.config.manyFiles },
	];
	if (largeWorkingTree) {
		for (const lever of workingTreeLevers) {
			if (!lever.eligible || !supported(lever.id)) continue;

			findings.push({
				tier: lever.tier,
				...trackedFilesEvidence,
				action: { kind: 'optimization', id: lever.id },
			});
		}
	}

	// Ask tier — system-scheduled background maintenance. Suggested for a not-yet-registered repo that's
	// either clearly large OR where passive slowness has been observed (its value is that it also runs
	// when VS Code is closed, so a chronically slow repo benefits even if it isn't huge on disk).
	const slownessObserved = (slowness?.count ?? 0) > 0;
	// `=== false`, not falsy: `undefined` means the registration list couldn't be read, and an unknown state
	// must never be suggested away — that's how a user's own registration gets silently reclaimed by Undo.
	if (
		(clearlyLarge || slownessObserved) &&
		snapshot.maintenanceRegistered === false &&
		supported('backgroundMaintenance')
	) {
		// Resolve the evidence once so reason/value/threshold can never drift apart. Ordered so each
		// suggestion argues from its most DISTINCTIVE signal rather than whichever crossed first: a repo
		// large by both file count and pack bytes would otherwise attach the same tracked-files evidence to
		// this finding as to the fsmonitor/manyFiles findings, and the view would show two identical meters.
		let evidence: Pick<GitHealthFinding, 'reason' | 'value' | 'threshold'>;
		if (!clearlyLarge && slownessObserved) {
			evidence = { reason: 'slowness', value: slowness?.maxDurationMs ?? 0, threshold: slowCommandThresholdMs };
		} else if (snapshot.packBytes >= largePackBytesThreshold) {
			evidence = { reason: 'largePacks', value: snapshot.packBytes, threshold: largePackBytesThreshold };
		} else {
			evidence = trackedFilesEvidence;
		}
		findings.push({
			tier: 'ask',
			...evidence,
			action: { kind: 'optimization', id: 'backgroundMaintenance' },
		});
	}

	return {
		findings: findings,
		clearlyLarge: clearlyLarge,
		estimatedLooseObjects: estimatedLooseObjects,
		estimatedTrackedFiles: estimatedTrackedFiles,
		trackedFilesExact: trackedFilesExact,
		packCount: snapshot.packCount,
		packBytes: snapshot.packBytes,
		commitGraph: snapshot.commitGraph,
	};
}

/**
 * What the view shows for one lever. Ownership is the load-bearing distinction: `applied` offers Undo
 * because GitLens recorded the exact prior; `userEnabled` offers nothing at all — there is nothing for
 * GitLens to undo, and a disabled control would imply otherwise.
 */
export type GitHealthLeverStatus =
	| 'suggested'
	| 'applied'
	| 'userEnabled'
	/** Supported and usable here, just not worth recommending for this repo — NOT a failure. */
	| 'available'
	| 'unavailable'
	| 'notApplicable';

export interface GitHealthLever {
	readonly id: GitOptimizationId;
	readonly status: GitHealthLeverStatus;
	readonly tier: GitOptimizationTier;
	/** Why it can't be used here — rendered verbatim, never flattened to "unsupported". */
	readonly reason?: string;
	/** A consequence the person must see BEFORE choosing, not after. */
	readonly note?: string;
	/**
	 * `true` when this lever's state could not be DETERMINED (e.g. the registration list was unreadable), as
	 * opposed to a lever this git/platform doesn't support.
	 */
	readonly checkFailed?: boolean;
}

/** Consequences that reach beyond GitLens, surfaced on the apply action itself. */
const leverNotes: Partial<Record<GitOptimizationId, string>> = {
	backgroundMaintenance:
		'Adds a task to your operating system’s scheduler. Undo unregisters this repository, but leaves the scheduler itself in place.',
};

/**
 * Collapses a snapshot + capabilities + report into the per-lever rows the Git Health view renders.
 * Pure, so the webview never re-derives ownership or eligibility rules that already live here.
 */
export function computeLevers(
	snapshot: GitHealthSnapshot,
	capabilities: readonly GitOptimizationCapability[],
	report: GitHealthReport,
): GitHealthLever[] {
	const suggested = new Set<GitOptimizationId>(
		report.findings.flatMap(f => (f.action.kind === 'optimization' ? [f.action.id] : [])),
	);

	const enabled: Record<GitOptimizationId, boolean> = {
		untrackedCache: snapshot.config.untrackedCache,
		fsmonitor: snapshot.config.fsmonitor,
		manyFiles: snapshot.config.manyFiles,
		// `=== true`, not the raw (possibly `undefined`) value — an unreadable registration is handled as its
		// own status below, and must never fall through to "enabled".
		backgroundMaintenance: snapshot.maintenanceRegistered === true,
	};
	const blocked: Partial<Record<GitOptimizationId, boolean>> = {
		untrackedCache: snapshot.untrackedCacheNotApplicable,
		fsmonitor: snapshot.fsmonitorNotApplicable,
	};

	return capabilities.map<GitHealthLever>(capability => {
		const id = capability.id;
		const note = leverNotes[id];
		// Every optimization lever is ask-tier now — the auto tier only ever runs maintenance tasks.
		const tier: GitOptimizationTier = 'ask';

		// Unavailable outranks everything: a lever the installed git or platform cannot do is never
		// "suggested", whatever the thresholds say.
		if (!capability.supported) {
			return { id: id, status: 'unavailable', tier: tier, reason: capability.reason, note: note };
		}
		// An unreadable maintenance registration can't answer the ownership/suggestion questions below, so
		// it gets its own status rather than falling through and being guessed as "not registered".
		if (id === 'backgroundMaintenance' && snapshot.maintenanceRegistered === undefined) {
			return {
				id: id,
				status: 'unavailable',
				tier: tier,
				reason: "Couldn't read Git's maintenance registration — try reopening the repository",
				note: note,
				checkFailed: true,
			};
		}
		// Then ownership, which is what decides whether Undo is offered at all.
		if (enabled[id]) {
			return { id: id, status: snapshot.applied[id] ? 'applied' : 'userEnabled', tier: tier, note: note };
		}
		// `notApplicable` means GitLens TRIED here and this repo can't use it — the gk marker records that.
		// `capability.note` is the supported-with-caveat field, not an unavailability reason, so the
		// explanation has to come from the marker's meaning instead.
		if (blocked[id]) {
			return {
				id: id,
				status: 'notApplicable',
				tier: tier,
				reason:
					id === 'fsmonitor'
						? 'The file system monitor could not start for this repository.'
						: 'This file system does not report directory changes reliably, so Git would return incorrect status results.',
				note: note,
			};
		}

		// Supported and usable, just below the thresholds — `available`, never `notApplicable`. Reporting
		// a healthy repo's levers as unavailable tells the user something false.
		return { id: id, status: suggested.has(id) ? 'suggested' : 'available', tier: tier, note: note };
	});
}

/** Auto-tier maintenance tasks the daily pass should run right now (deduped, order-stable). */
export function getAutoMaintenanceTasks(report: GitHealthReport): GitMaintenanceTask[] {
	const tasks: GitMaintenanceTask[] = [];
	for (const finding of report.findings) {
		if (finding.tier === 'auto' && finding.action.kind === 'maintenance' && !tasks.includes(finding.action.task)) {
			tasks.push(finding.action.task);
		}
	}
	return tasks;
}

/** Auto-tier optimization levers the daily pass should silently apply — none today; the auto tier currently
 * applies only maintenance tasks, but this stays in place for future levers. */
export function getAutoOptimizations(report: GitHealthReport): GitOptimizationId[] {
	const ids: GitOptimizationId[] = [];
	for (const finding of report.findings) {
		if (finding.tier === 'auto' && finding.action.kind === 'optimization' && !ids.includes(finding.action.id)) {
			ids.push(finding.action.id);
		}
	}
	return ids;
}

/**
 * Banner rule: fire only when the report contains an ask-tier fix AND the repo is clearly large OR
 * passive slowness has been observed. Small, fast repos never see it.
 */
export function isBannerEligible(report: GitHealthReport, slowness: GitHealthSlowness | undefined): boolean {
	const hasAskTierFix = report.findings.some(f => f.tier === 'ask');
	const slownessObserved = (slowness?.count ?? 0) > 0;
	return hasAskTierFix && (report.clearlyLarge || slownessObserved);
}
