import * as assert from 'node:assert';
import type { GitHealthFinding, GitHealthSlowness } from '../gitHealth.js';
import {
	approxBytesPerIndexEntry,
	computeHealthReport,
	computeLevers,
	estimateLooseObjects,
	estimateTrackedFiles,
	getAutoMaintenanceTasks,
	getAutoOptimizations,
	isBannerEligible,
	looseObjectsThreshold,
	packCountThreshold,
	trackedFilesThreshold,
} from '../gitHealth.js';
import type { GitHealthSnapshot, GitOptimizationCapability, GitOptimizationId } from '../providers/maintenance.js';

// Index bytes that extrapolate to exactly `trackedFilesThreshold` tracked files.
const largeIndexBytes = trackedFilesThreshold * approxBytesPerIndexEntry;
// Sampled loose-object count (over 16 dirs) that extrapolates past `looseObjectsThreshold`.
const manyLooseSampled = Math.ceil((looseObjectsThreshold * 16) / 256) + 1;

function makeSnapshot(
	o: {
		packCount?: number;
		packBytes?: number;
		looseSampled?: number;
		indexBytes?: number;
		indexEntryCount?: number;
		fsmonitor?: boolean;
		untrackedCache?: boolean;
		untrackedCacheConfigured?: boolean;
		manyFiles?: boolean;
		maintenanceRegistered?: boolean;
		/** Simulates an unreadable global `maintenance.repo` list — overrides {@link maintenanceRegistered}. */
		maintenanceRegisteredUnreadable?: boolean;
		fsmonitorNotApplicable?: boolean;
		untrackedCacheNotApplicable?: boolean;
		applied?: Partial<GitHealthSnapshot['applied']>;
		supportsMaintenanceRun?: boolean;
		commitGraphPresent?: boolean;
		multiPackIndex?: boolean;
	} = {},
): GitHealthSnapshot {
	return {
		commitGraph: {
			present: o.commitGraphPresent ?? true,
			mtime: o.commitGraphPresent === false ? undefined : 1000,
			changedPaths: false,
			changedPathsSupported: false,
			disabled: false,
			readDisabled: false,
		},
		multiPackIndex: o.multiPackIndex ?? false,
		packCount: o.packCount ?? 1,
		packBytes: o.packBytes ?? 1000,
		looseObjects: { objectsInSampledDirs: o.looseSampled ?? 0, dirsSampled: 16 },
		indexBytes: o.indexBytes ?? 1000,
		// `undefined` unless a test opts in — keeps every existing proxy-based expectation exercising the
		// fallback path exactly as before.
		indexEntryCount: o.indexEntryCount,
		config: {
			fsmonitor: o.fsmonitor ?? false,
			untrackedCache: o.untrackedCache ?? false,
			// An enabled cache is by definition explicitly configured.
			untrackedCacheConfigured: o.untrackedCacheConfigured ?? o.untrackedCache ?? false,
			manyFiles: o.manyFiles ?? false,
		},
		maintenanceRegistered: o.maintenanceRegisteredUnreadable ? undefined : (o.maintenanceRegistered ?? false),
		fsmonitorNotApplicable: o.fsmonitorNotApplicable ?? false,
		untrackedCacheNotApplicable: o.untrackedCacheNotApplicable ?? false,
		applied: {
			untrackedCache: false,
			fsmonitor: false,
			manyFiles: false,
			backgroundMaintenance: false,
			...o.applied,
		},
		supportsMaintenanceRun: o.supportsMaintenanceRun ?? true,
	};
}

function makeCapabilities(overrides?: Partial<Record<GitOptimizationId, boolean>>): GitOptimizationCapability[] {
	const supported: Record<GitOptimizationId, boolean> = {
		untrackedCache: true,
		fsmonitor: true,
		backgroundMaintenance: true,
		manyFiles: true,
		...overrides,
	};
	return (Object.keys(supported) as GitOptimizationId[]).map(id => ({ id: id, supported: supported[id] }));
}

function optimizationIds(findings: readonly GitHealthFinding[]): GitOptimizationId[] {
	return findings
		.map(f => (f.action.kind === 'optimization' ? f.action.id : undefined))
		.filter((id): id is GitOptimizationId => id != null);
}

suite('gitHealth.estimateLooseObjects', () => {
	test('extrapolates a full sample to 256 fanout dirs', () => {
		assert.strictEqual(estimateLooseObjects(256, 16), 4096);
	});

	test('returns 0 for an empty sample', () => {
		assert.strictEqual(estimateLooseObjects(0, 16), 0);
	});

	test('guards divide-by-zero', () => {
		assert.strictEqual(estimateLooseObjects(100, 0), 0);
	});
});

suite('gitHealth.estimateTrackedFiles', () => {
	test('divides index bytes by the per-entry proxy', () => {
		assert.strictEqual(estimateTrackedFiles(approxBytesPerIndexEntry * 1234), 1234);
	});

	test('returns 0 for an empty index', () => {
		assert.strictEqual(estimateTrackedFiles(0), 0);
	});
});

suite('gitHealth.computeHealthReport — auto tier', () => {
	test('a small, healthy repo produces no findings and is not clearly large', () => {
		const report = computeHealthReport(makeSnapshot(), undefined, makeCapabilities());
		assert.strictEqual(report.findings.length, 0);
		assert.strictEqual(report.clearlyLarge, false);
	});

	test('recommends loose-objects when the loose estimate exceeds the threshold', () => {
		const report = computeHealthReport(
			makeSnapshot({ looseSampled: manyLooseSampled }),
			undefined,
			makeCapabilities(),
		);
		assert.deepStrictEqual(getAutoMaintenanceTasks(report), ['loose-objects']);
	});

	test('does NOT recommend maintenance tasks when git lacks `git maintenance run`', () => {
		const report = computeHealthReport(
			makeSnapshot({
				looseSampled: manyLooseSampled,
				packCount: packCountThreshold,
				supportsMaintenanceRun: false,
			}),
			undefined,
			makeCapabilities(),
		);
		assert.deepStrictEqual(getAutoMaintenanceTasks(report), []);
	});

	test('recommends incremental-repack when the pack count exceeds the threshold', () => {
		const report = computeHealthReport(
			makeSnapshot({ packCount: packCountThreshold }),
			undefined,
			makeCapabilities(),
		);
		assert.deepStrictEqual(getAutoMaintenanceTasks(report), ['incremental-repack']);
	});

	test('the auto tier never applies config levers, even on a large repo with every threshold crossed', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes, packCount: packCountThreshold, packBytes: 2 * 1024 ** 3 }),
			undefined,
			makeCapabilities(),
		);
		assert.deepStrictEqual(getAutoOptimizations(report), []);
	});
});

suite('gitHealth.computeHealthReport — ask tier', () => {
	test('a large working tree suggests untrackedCache + fsmonitor + manyFiles + backgroundMaintenance', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes }),
			undefined,
			makeCapabilities(),
		);
		const ask = optimizationIds(report.findings.filter(f => f.tier === 'ask'));
		assert.ok(ask.includes('untrackedCache'));
		assert.ok(ask.includes('fsmonitor'));
		assert.ok(ask.includes('manyFiles'));
		assert.ok(ask.includes('backgroundMaintenance'));
	});

	test('does NOT suggest untracked cache when already enabled', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes, untrackedCache: true }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(optimizationIds(report.findings).includes('untrackedCache'), false);
	});

	test('does NOT suggest untracked cache when unsupported by the installed git', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes }),
			undefined,
			makeCapabilities({ untrackedCache: false }),
		);
		assert.strictEqual(optimizationIds(report.findings).includes('untrackedCache'), false);
	});

	test("does NOT suggest untracked cache when it previously failed git's filesystem probe", () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes, untrackedCacheNotApplicable: true }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(optimizationIds(report.findings).includes('untrackedCache'), false);
	});

	test('does NOT suggest untracked cache when the user explicitly disabled it', () => {
		// `false` and `keep` both parse as "off", but they are a deliberate choice — this lever respects an
		// explicit value rather than overriding it.
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes, untrackedCache: false, untrackedCacheConfigured: true }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(optimizationIds(report.findings).includes('untrackedCache'), false);
	});

	test('does NOT suggest fsmonitor when previously marked not-applicable', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes, fsmonitorNotApplicable: true }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(optimizationIds(report.findings).includes('fsmonitor'), false);
	});

	test('does NOT suggest fsmonitor when unsupported (platform/version gated)', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes }),
			undefined,
			makeCapabilities({ fsmonitor: false }),
		);
		assert.strictEqual(optimizationIds(report.findings).includes('fsmonitor'), false);
	});

	test('a small repo with a >1 GiB pack store is clearly large and suggests backgroundMaintenance', () => {
		const report = computeHealthReport(makeSnapshot({ packBytes: 2 * 1024 ** 3 }), undefined, makeCapabilities());
		assert.strictEqual(report.clearlyLarge, true);
		const bg = report.findings.find(
			f => f.action.kind === 'optimization' && f.action.id === 'backgroundMaintenance',
		);
		assert.ok(bg != null);
		assert.strictEqual(bg.reason, 'largePacks');
	});

	test('does NOT suggest backgroundMaintenance when already registered', () => {
		const report = computeHealthReport(
			makeSnapshot({ packBytes: 2 * 1024 ** 3, maintenanceRegistered: true }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(optimizationIds(report.findings).includes('backgroundMaintenance'), false);
	});

	test('does NOT suggest backgroundMaintenance when the registration list is unreadable', () => {
		// `undefined` (unreadable) must never be treated as a definitive "not registered" — only `false` may
		// suggest, else a repo the user registered themselves gets re-suggested on a transient read failure.
		const report = computeHealthReport(
			makeSnapshot({ packBytes: 2 * 1024 ** 3, maintenanceRegisteredUnreadable: true }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(optimizationIds(report.findings).includes('backgroundMaintenance'), false);
	});

	test('slowness alone (on a small repo) suggests backgroundMaintenance with a slowness reason', () => {
		const slowness: GitHealthSlowness = { count: 3, lastAt: Date.now(), maxDurationMs: 4200 };
		const report = computeHealthReport(makeSnapshot(), slowness, makeCapabilities());
		const bg = report.findings.find(
			f => f.action.kind === 'optimization' && f.action.id === 'backgroundMaintenance',
		);
		assert.ok(bg != null);
		assert.strictEqual(bg.reason, 'slowness');
		assert.strictEqual(bg.value, 4200);
	});
});

suite('gitHealth.isBannerEligible', () => {
	test('fires when an ask-tier fix exists and the repo is clearly large', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(isBannerEligible(report, undefined), true);
	});

	test('fires when an ask-tier fix exists and slowness was observed', () => {
		const slowness: GitHealthSlowness = { count: 1, lastAt: Date.now(), maxDurationMs: 3000 };
		const report = computeHealthReport(makeSnapshot(), slowness, makeCapabilities());
		assert.strictEqual(isBannerEligible(report, slowness), true);
	});

	test('does not fire when there are no ask-tier fixes', () => {
		const report = computeHealthReport(makeSnapshot(), undefined, makeCapabilities());
		assert.strictEqual(isBannerEligible(report, undefined), false);
	});

	test('does not fire for an ask-tier fix on a small, non-slow repo', () => {
		// Hand-built: an ask finding present but neither clearly large nor slow → not eligible.
		const report = {
			findings: [
				{
					tier: 'ask' as const,
					reason: 'trackedFiles' as const,
					value: 1,
					threshold: 1,
					action: { kind: 'optimization' as const, id: 'fsmonitor' as const },
				},
			],
			clearlyLarge: false,
			estimatedLooseObjects: 0,
			estimatedTrackedFiles: 0,
			trackedFilesExact: false,
			packCount: 0,
			packBytes: 0,
			commitGraph: {
				present: false,
				mtime: undefined,
				changedPaths: false,
				changedPathsSupported: false,
				disabled: false,
				readDisabled: false,
			},
		};
		assert.strictEqual(isBannerEligible(report, undefined), false);
	});
});

suite('gitHealth.computeLevers', () => {
	const leversFor = (snapshotOptions: Parameters<typeof makeSnapshot>[0], capabilities = makeCapabilities()) => {
		const snapshot = makeSnapshot(snapshotOptions);
		const report = computeHealthReport(snapshot, undefined, capabilities);
		return new Map(computeLevers(snapshot, capabilities, report).map(l => [l.id, l]));
	};

	test('an unsupported lever is unavailable, never suggested, and keeps its reason verbatim', () => {
		// Unavailable has to outrank the thresholds — a large repo still can't use a lever this git
		// or platform doesn't have.
		const snapshot = makeSnapshot({ indexBytes: largeIndexBytes });
		const capabilities: GitOptimizationCapability[] = [
			{ id: 'fsmonitor', supported: false, reason: 'Requires Git 2.55 or later on Linux' },
		];
		const report = computeHealthReport(snapshot, undefined, capabilities);
		const [lever] = computeLevers(snapshot, capabilities, report);

		assert.strictEqual(lever.status, 'unavailable');
		assert.strictEqual(lever.reason, 'Requires Git 2.55 or later on Linux');
		assert.strictEqual(lever.checkFailed, undefined, 'a plain unsupported lever has no checkFailed');
	});

	test('ownership decides between applied and userEnabled — the Undo distinction', () => {
		const mine = leversFor({ untrackedCache: true, applied: { untrackedCache: true } });
		assert.strictEqual(mine.get('untrackedCache')?.status, 'applied');

		// Same enabled config, no ownership marker: the user set it, so there is nothing to undo.
		const theirs = leversFor({ untrackedCache: true });
		assert.strictEqual(theirs.get('untrackedCache')?.status, 'userEnabled');
	});

	test('an eligible lever on a large repo is suggested', () => {
		const levers = leversFor({ indexBytes: largeIndexBytes });
		assert.strictEqual(levers.get('fsmonitor')?.status, 'suggested');
	});

	test('a repo that previously failed the probe is notApplicable, not suggested', () => {
		const levers = leversFor({ indexBytes: largeIndexBytes, fsmonitorNotApplicable: true });
		assert.strictEqual(levers.get('fsmonitor')?.status, 'notApplicable');
	});

	test('scheduled maintenance carries its undo caveat before the choice, not after', () => {
		// The OS scheduler is deliberately left installed by revert, so the view must say so on Enable.
		const levers = leversFor({ indexBytes: largeIndexBytes });
		const lever = levers.get('backgroundMaintenance');

		assert.strictEqual(lever?.status, 'suggested');
		// `?.` is safe here specifically because an absent note SHOULD fail this assertion.
		assert.ok(lever.note?.includes('scheduler'), 'note names the scheduler');
	});

	test('a healthy repo reports levers as available, never unavailable', () => {
		// A small repo produces no findings. Reporting its levers as "unavailable" would tell the user
		// something false — they are perfectly usable, just not worth recommending.
		const levers = leversFor({});
		for (const lever of levers.values()) {
			assert.strictEqual(lever.status, 'available', `${lever.id} is available`);
			assert.strictEqual(lever.reason, undefined, `${lever.id} needs no reason`);
		}
	});

	test('an already-registered repo is not suggested background maintenance again', () => {
		const levers = leversFor({ indexBytes: largeIndexBytes, maintenanceRegistered: true });
		assert.strictEqual(levers.get('backgroundMaintenance')?.status, 'userEnabled');
	});

	test('a repo GitLens itself registered still reports applied, not userEnabled', () => {
		const levers = leversFor({
			indexBytes: largeIndexBytes,
			maintenanceRegistered: true,
			applied: { backgroundMaintenance: true },
		});
		assert.strictEqual(levers.get('backgroundMaintenance')?.status, 'applied');
	});

	test('an unreadable maintenance registration is unavailable, never suggested or userEnabled', () => {
		const levers = leversFor({ indexBytes: largeIndexBytes, maintenanceRegisteredUnreadable: true });
		const lever = levers.get('backgroundMaintenance');
		assert.strictEqual(lever?.status, 'unavailable');
		assert.ok(lever.reason?.includes("Couldn't read"), 'reason names the read failure');
		assert.strictEqual(lever.checkFailed, true, 'checkFailed distinguishes an unreadable check from unsupported');
	});
});

suite('gitHealth.computeHealthReport — tracked-file count source', () => {
	test('prefers the exact index-header count over the byte-size proxy', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: 1000, indexEntryCount: 12345 }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(report.estimatedTrackedFiles, 12345);
		assert.strictEqual(report.trackedFilesExact, true);
	});

	test('falls back to the index-bytes proxy when the header count is unavailable', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(report.estimatedTrackedFiles, estimateTrackedFiles(largeIndexBytes));
		assert.strictEqual(report.trackedFilesExact, false);
	});
});

suite('gitHealth.computeHealthReport — backgroundMaintenance evidence priority', () => {
	test('prefers largePacks over trackedFiles when both thresholds are crossed', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes, packBytes: 2 * 1024 ** 3 }),
			undefined,
			makeCapabilities(),
		);
		const bg = report.findings.find(
			f => f.action.kind === 'optimization' && f.action.id === 'backgroundMaintenance',
		);
		assert.ok(bg != null);
		assert.strictEqual(bg.reason, 'largePacks');
	});

	test('falls back to trackedFiles when only the file count is large', () => {
		const report = computeHealthReport(
			makeSnapshot({ indexBytes: largeIndexBytes }),
			undefined,
			makeCapabilities(),
		);
		const bg = report.findings.find(
			f => f.action.kind === 'optimization' && f.action.id === 'backgroundMaintenance',
		);
		assert.ok(bg != null);
		assert.strictEqual(bg.reason, 'trackedFiles');
	});

	test('slowness still wins over both when the repo is not clearly large', () => {
		const slowness: GitHealthSlowness = { count: 1, lastAt: Date.now(), maxDurationMs: 3000 };
		const report = computeHealthReport(makeSnapshot(), slowness, makeCapabilities());
		const bg = report.findings.find(
			f => f.action.kind === 'optimization' && f.action.id === 'backgroundMaintenance',
		);
		assert.ok(bg != null);
		assert.strictEqual(bg.reason, 'slowness');
	});
});

suite('gitHealth.computeHealthReport — snapshot pass-through', () => {
	test('report passes through packCount, packBytes, and commitGraph from the snapshot', () => {
		const report = computeHealthReport(
			makeSnapshot({ packCount: 7, packBytes: 12345, commitGraphPresent: false }),
			undefined,
			makeCapabilities(),
		);
		assert.strictEqual(report.packCount, 7);
		assert.strictEqual(report.packBytes, 12345);
		assert.deepStrictEqual(report.commitGraph, {
			present: false,
			mtime: undefined,
			changedPaths: false,
			changedPathsSupported: false,
			disabled: false,
			readDisabled: false,
		});
	});
});
