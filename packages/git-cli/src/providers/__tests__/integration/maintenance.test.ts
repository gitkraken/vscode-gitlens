import * as assert from 'assert';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitOptimizationId } from '@gitlens/git/providers/maintenance.js';
import { Git } from '../../../exec/git.js';
import { findGitPath } from '../../../exec/locator.js';
import type { TestRepo } from './helpers.js';
import { addCommit, commitGraphChainDir, createTestRepo, gkConfig, maintenanceOf, setConfig } from './helpers.js';

const optimizationIds: readonly GitOptimizationId[] = [
	'untrackedCache',
	'fsmonitor',
	'backgroundMaintenance',
	'manyFiles',
];

/** Reads a repo's LOCAL-scope config value (independent of the developer's global/system config). */
function localConfig(cwd: string, key: string): string | undefined {
	try {
		return (
			execFileSync('git', ['config', '--local', '--get', key], { cwd: cwd, encoding: 'utf8' }).trim() || undefined
		);
	} catch {
		// `--get` of an unset key exits non-zero.
		return undefined;
	}
}

/** Adds an ADDITIONAL local value, producing a multi-valued key. */
function addLocalConfig(cwd: string, key: string, value: string): void {
	execFileSync('git', ['config', '--local', '--add', key, value], { cwd: cwd });
}

/**
 * Whether a LOCAL-scope key is present at all — unlike {@link localConfig}, this can tell an EMPTY value
 * (`key =`, exit 0 with empty stdout) apart from an unset key (exit 1).
 */
function localConfigPresent(cwd: string, key: string): boolean {
	try {
		execFileSync('git', ['config', '--local', '--get', key], { cwd: cwd, stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

/** Reads every LOCAL value of a key (a key can hold more than one). */
function localConfigAll(cwd: string, key: string): string[] {
	try {
		return execFileSync('git', ['config', '--local', '--get-all', key], { cwd: cwd, encoding: 'utf8' })
			.split('\n')
			.map(line => line.trim())
			.filter(line => line !== '');
	} catch {
		// `--get-all` of an unset key exits non-zero.
		return [];
	}
}

/** Reach into the private ownership-marker lock — the diagnosis, ownership, and release tests need to run
 *  code INSIDE the critical section (or with shortened timings), which no public entry point exposes. */
function withMarkerLock<T>(
	repo: TestRepo,
	repoPath: string,
	fn: () => Promise<T>,
	timings?: {
		retryMs?: number;
		maxAttempts?: number;
		probeOwner?: (owner: { host: string; pid: number }) => 'alive' | 'dead' | 'unverifiable';
		writeRecord?: (handle: unknown) => Promise<void>;
		openLock?: (lockPath: string) => Promise<unknown>;
	},
): Promise<T> {
	// oxlint-disable-next-line no-explicit-any -- deliberate reach into the private test seam
	return (maintenanceOf(repo) as any).withMarkerLock(repoPath, fn, timings) as Promise<T>;
}

suite('MaintenanceSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getHealthSnapshot reports a coherent shape for a fresh repo', async () => {
		const snapshot = await maintenanceOf(repo).getHealthSnapshot(repo.path);

		// A freshly-initialized repo has loose objects only — no packs, no multi-pack-index.
		assert.strictEqual(snapshot.packCount, 0, 'no packs yet');
		assert.strictEqual(snapshot.packBytes, 0, 'no pack bytes yet');
		assert.strictEqual(snapshot.multiPackIndex, false, 'no multi-pack-index yet');
		assert.strictEqual(snapshot.looseObjects.dirsSampled, 16, 'samples 16 fanout dirs');
		assert.ok(snapshot.indexBytes > 0, 'index exists after the initial commit');

		// The config levers read MERGED config (they can be inherited from the developer's global/system
		// config), so only assert they resolve to booleans — not a specific value.
		assert.strictEqual(typeof snapshot.config.fsmonitor, 'boolean');
		assert.strictEqual(typeof snapshot.config.untrackedCache, 'boolean');
		assert.strictEqual(typeof snapshot.config.manyFiles, 'boolean');
		// A brand-new temp repo is never registered for system maintenance and has no gk markers.
		assert.strictEqual(snapshot.maintenanceRegistered, false);
		assert.strictEqual(snapshot.fsmonitorNotApplicable, false);
		assert.strictEqual(snapshot.untrackedCacheNotApplicable, false);
		assert.deepStrictEqual(snapshot.applied, {
			untrackedCache: false,
			fsmonitor: false,
			manyFiles: false,
			backgroundMaintenance: false,
		});
		assert.strictEqual(typeof snapshot.supportsMaintenanceRun, 'boolean');
	});

	test('getHealthSnapshot reads a BAREWORD (valueless) boolean entry as configured and enabled', async () => {
		// `git config --get-regexp` renders a bareword entry (`key`, no `=value` — git's own boolean-true
		// shorthand, git-config(1)) with NO trailing space, byte-DISTINCT from an explicit empty value
		// (`key =`), which keeps one — confirmed against git's own `format_config` (builtin/config.c): the
		// key-delimiter is backed out only when the stored value is NULL (bareword), never for a real
		// (possibly empty) string. `git config` itself has no way to WRITE the bareword form, so append it
		// to the file directly.
		const bareRepo = createTestRepo();
		try {
			appendFileSync(join(bareRepo.path, '.git', 'config'), '[core]\n\tuntrackedCache\n');

			const snapshot = await maintenanceOf(bareRepo).getHealthSnapshot(bareRepo.path);
			assert.strictEqual(snapshot.config.untrackedCacheConfigured, true, 'a bareword entry counts as configured');
			assert.strictEqual(snapshot.config.untrackedCache, true, 'and reads as ENABLED — bareword means true');
		} finally {
			bareRepo.cleanup();
		}
	});

	test('an explicit EMPTY value in the LAST matched --get-regex line still parses as empty, not bareword', async () => {
		// A regression guard on the CALL SITE, not just `parseConfigRegexOutput` itself: the raw `git config
		// --get-regex` stdout must reach the parser un-`.trim()`-ed. `.trim()`-ing the whole (possibly
		// multi-line) buffer strips the trailing space that marks an explicit-empty value ONLY when that
		// value's line happens to be the LAST one in the output — earlier lines are unaffected, which is why
		// this needs two matching keys with the empty one written second (`--get-regex` prints in file order).
		const lastEmptyRepo = createTestRepo();
		try {
			setConfig(lastEmptyRepo.path, 'core.fsmonitor', 'true');
			setConfig(lastEmptyRepo.path, 'core.untrackedCache', '');

			const snapshot = await maintenanceOf(lastEmptyRepo).getHealthSnapshot(lastEmptyRepo.path);
			assert.strictEqual(snapshot.config.fsmonitor, true, 'the earlier line is unaffected either way');
			assert.strictEqual(
				snapshot.config.untrackedCacheConfigured,
				true,
				'the trailing empty-value line is still present in the map, not dropped',
			);
			assert.strictEqual(
				snapshot.config.untrackedCache,
				false,
				'…and reads as its actual empty/false value, never misread as a trailing bareword-true',
			);
		} finally {
			lastEmptyRepo.cleanup();
		}
	});

	test('a BAREWORD-true core.untrackedCache survives an apply/undo round-trip as true', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:untrackedCache'));
		if (!supported) {
			this.skip();
		}

		// A bareword entry counts as "configured" (this session's fix reads it as ENABLED, not unset) — the
		// pre-apply check short-circuits, so neither apply nor undo ever writes it. The regression this guards
		// against: misreading the bareword as an empty prior would have undo restore that empty value instead,
		// flipping the user's true to false.
		const bareApplyRepo = createTestRepo();
		try {
			appendFileSync(join(bareApplyRepo.path, '.git', 'config'), '[core]\n\tuntrackedCache\n');

			const applied = await maintenanceOf(bareApplyRepo).applyOptimization(bareApplyRepo.path, 'untrackedCache');
			assert.strictEqual(applied, false, 'apply is a no-op — the bareword already counts as configured');

			await maintenanceOf(bareApplyRepo).revertOptimization(bareApplyRepo.path, 'untrackedCache');

			assert.strictEqual(
				execFileSync('git', ['config', '--local', '--type=bool', '--get', 'core.untrackedCache'], {
					cwd: bareApplyRepo.path,
					encoding: 'utf8',
				}).trim(),
				'true',
				'the bareword-true prior survives the round trip as true, never flipped to false',
			);
		} finally {
			bareApplyRepo.cleanup();
		}
	});

	test('getHealthSnapshot reports the exact tracked-file count from the index header', async () => {
		const countRepo = createTestRepo();
		try {
			addCommit(countRepo.path, 'a.txt', 'a', 'add a');
			addCommit(countRepo.path, 'b.txt', 'b', 'add b');
			addCommit(countRepo.path, 'c.txt', 'c', 'add c');

			const trackedFiles = execFileSync('git', ['ls-files'], { cwd: countRepo.path, encoding: 'utf8' })
				.split('\n')
				.filter(line => line.trim() !== '').length;

			const snapshot = await maintenanceOf(countRepo).getHealthSnapshot(countRepo.path);
			assert.strictEqual(snapshot.indexEntryCount, trackedFiles, 'exact count matches `git ls-files`');
		} finally {
			countRepo.cleanup();
		}
	});

	test('getHealthSnapshot surfaces an explicit core.commitGraph=false read opt-out', async () => {
		// `ensureCommitGraph` honors this setting as a write opt-out, so the snapshot must surface it —
		// otherwise the Health view claims the cache is (or will be) maintained when it never will be.
		const cgOffRepo = createTestRepo();
		try {
			let snapshot = await maintenanceOf(cgOffRepo).getHealthSnapshot(cgOffRepo.path);
			assert.strictEqual(snapshot.commitGraph.readDisabled, false, 'unset means git reads the cache');

			setConfig(cgOffRepo.path, 'core.commitGraph', 'false');
			snapshot = await maintenanceOf(cgOffRepo).getHealthSnapshot(cgOffRepo.path);
			assert.strictEqual(snapshot.commitGraph.readDisabled, true, 'explicit false surfaces as readDisabled');
		} finally {
			cgOffRepo.cleanup();
		}
	});

	test('getHealthDetails normalizes count-objects size fields from KiB to bytes', async () => {
		// `git count-objects -v` reports size-pack in KiB — a raw pass-through would be ~1000x too small.
		const sizeRepo = createTestRepo();
		try {
			const blob = 'x'.repeat(4096);
			addCommit(sizeRepo.path, 'a.bin', blob, 'add a');
			addCommit(sizeRepo.path, 'b.bin', blob, 'add b');
			addCommit(sizeRepo.path, 'c.bin', blob, 'add c');

			// Force a real pack so size-pack reflects packed (not loose) bytes.
			execFileSync('git', ['repack', '-qd'], { cwd: sizeRepo.path, stdio: 'pipe' });

			const packDir = join(sizeRepo.path, '.git', 'objects', 'pack');
			const packEntries = readdirSync(packDir);

			let packOnlyBytes = 0;
			let allPackDirBytes = 0;
			for (const entry of packEntries) {
				const size = statSync(join(packDir, entry)).size;
				allPackDirBytes += size;
				if (entry.endsWith('.pack')) {
					packOnlyBytes += size;
				}
			}

			const details = await maintenanceOf(sizeRepo).getHealthDetails(sizeRepo.path);
			assert.ok(details.countObjects != null, 'countObjects present');

			assert.ok(
				details.countObjects.sizePack >= packOnlyBytes,
				`sizePack (${details.countObjects.sizePack}) must be at least the on-disk .pack bytes (${packOnlyBytes}) — proves KiB was converted, not passed through raw`,
			);
			assert.ok(
				details.countObjects.sizePack <= allPackDirBytes + 64 * 1024,
				`sizePack (${details.countObjects.sizePack}) must be at most the on-disk pack dir bytes (${allPackDirBytes}) plus 64 KiB slack for the pack index`,
			);
		} finally {
			sizeRepo.cleanup();
		}
	});

	test('getCapabilities returns every lever with a boolean support flag', async () => {
		const capabilities = await maintenanceOf(repo).getCapabilities(repo.path);

		assert.strictEqual(capabilities.length, optimizationIds.length);
		for (const id of optimizationIds) {
			const capability = capabilities.find(c => c.id === id);
			assert.ok(capability != null, `capability for '${id}' present`);
			assert.strictEqual(typeof capability.supported, 'boolean');
			// An unsupported lever must explain why; a supported one carries no reason.
			if (!capability.supported) {
				assert.ok(capability.reason != null && capability.reason.length > 0, `reason for unsupported '${id}'`);
			} else {
				assert.strictEqual(capability.reason, undefined);
			}
		}
	});

	test('applyOptimization / revertOptimization round-trips core.untrackedCache and its ownership marker', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:untrackedCache'));
		if (!supported) {
			this.skip();
		}

		const applied = await maintenanceOf(repo).applyOptimization(repo.path, 'untrackedCache');
		if (!applied) {
			// The runner's filesystem failed git's `--test-untracked-cache` probe — apply must then record
			// not-applicable and NOT enable the cache. Assert that and skip the enable/revert half.
			assert.strictEqual(
				gkConfig(repo.path, 'gk.untrackedCacheNotApplicable'),
				'true',
				'not-applicable recorded',
			);
			assert.strictEqual(localConfig(repo.path, 'core.untrackedCache'), undefined, 'cache left disabled');
			this.skip();
		}

		// Verify at the LOCAL scope so the assertion is independent of any global core.untrackedCache.
		assert.strictEqual(localConfig(repo.path, 'core.untrackedCache'), 'true', 'local config set to true');
		// The ownership marker (prior value 'unset', since the fresh repo had none locally) must be recorded.
		assert.strictEqual(
			gkConfig(repo.path, 'gk.applied.untrackedCache'),
			'unset',
			'ownership marker records the prior',
		);

		await maintenanceOf(repo).revertOptimization(repo.path, 'untrackedCache');
		assert.strictEqual(localConfig(repo.path, 'core.untrackedCache'), undefined, 'local config unset after revert');
		assert.strictEqual(gkConfig(repo.path, 'gk.applied.untrackedCache'), undefined, 'marker cleared after revert');
	});

	test('revert restores a PRE-EXISTING local value instead of unsetting it (never inverts)', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:manyFiles'));
		if (!supported) {
			this.skip();
		}

		// Own repo: this mutates feature.manyFiles/index and must not depend on sibling test order.
		const priorRepo = createTestRepo();
		try {
			// Pre-existing user value — undo must restore exactly this, not a hardcoded unset/off.
			setConfig(priorRepo.path, 'feature.manyFiles', 'false');

			const applied = await maintenanceOf(priorRepo).applyOptimization(priorRepo.path, 'manyFiles');
			assert.strictEqual(applied, true, 'manyFiles applied');
			assert.strictEqual(localConfig(priorRepo.path, 'feature.manyFiles'), 'true', 'feature.manyFiles enabled');
			assert.strictEqual(gkConfig(priorRepo.path, 'gk.applied.manyFiles'), 'false', 'prior value recorded');

			await maintenanceOf(priorRepo).revertOptimization(priorRepo.path, 'manyFiles');
			assert.strictEqual(
				localConfig(priorRepo.path, 'feature.manyFiles'),
				'false',
				'revert restores the pre-existing value, not unset',
			);
			assert.strictEqual(
				gkConfig(priorRepo.path, 'gk.applied.manyFiles'),
				undefined,
				'marker cleared after revert',
			);
		} finally {
			priorRepo.cleanup();
		}
	});

	test('revert restores a PRE-EXISTING EMPTY local value instead of unsetting it', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:manyFiles'));
		if (!supported) {
			this.skip();
		}

		const emptyRepo = createTestRepo();
		try {
			// An explicit EMPTY value (`feature.manyFiles =`) — git reads it as boolean false, and a local
			// empty value shadows any global value, so undo must restore the empty value, never delete the
			// key (deleting would let a shadowed global resurface).
			setConfig(emptyRepo.path, 'feature.manyFiles', '');

			const applied = await maintenanceOf(emptyRepo).applyOptimization(emptyRepo.path, 'manyFiles');
			assert.strictEqual(applied, true, 'manyFiles applied');
			assert.strictEqual(
				gkConfig(emptyRepo.path, 'gk.applied.manyFiles'),
				'empty',
				'the empty prior is recorded via its sentinel, never collapsed to unset',
			);

			await maintenanceOf(emptyRepo).revertOptimization(emptyRepo.path, 'manyFiles');
			assert.strictEqual(
				localConfigPresent(emptyRepo.path, 'feature.manyFiles'),
				true,
				'the key survives the revert',
			);
			assert.strictEqual(
				localConfig(emptyRepo.path, 'feature.manyFiles'),
				undefined,
				'…with its empty value restored, not some other value',
			);
		} finally {
			emptyRepo.cleanup();
		}
	});

	test('an explicit EMPTY core.untrackedCache is a configured opt-out — never re-suggested or overwritten', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:untrackedCache'));
		if (!supported) {
			this.skip();
		}

		const optOutRepo = createTestRepo();
		try {
			// `core.untrackedCache=` (empty) is an explicit false to git. `--get-regex` renders it WITH a
			// trailing space (`core.untrackedcache `) — byte-distinct from a bareword line, which has none
			// — so the parse must not `.trim()` the whole blob (that eats this line's trailing space when
			// it lands last and misreads it as bareword-true).
			setConfig(optOutRepo.path, 'core.untrackedCache', '');

			const snapshot = await maintenanceOf(optOutRepo).getHealthSnapshot(optOutRepo.path);
			assert.strictEqual(
				snapshot.config.untrackedCacheConfigured,
				true,
				'an empty value still counts as configured',
			);
			assert.strictEqual(snapshot.config.untrackedCache, false, 'and reads as disabled');

			const applied = await maintenanceOf(optOutRepo).applyOptimization(optOutRepo.path, 'untrackedCache');
			assert.strictEqual(applied, false, 'apply respects the explicit opt-out');
			assert.strictEqual(
				gkConfig(optOutRepo.path, 'gk.applied.untrackedCache'),
				undefined,
				'no ownership marker recorded',
			);
			assert.strictEqual(
				localConfigPresent(optOutRepo.path, 'core.untrackedCache'),
				true,
				'the user’s empty value is untouched',
			);
			assert.strictEqual(localConfig(optOutRepo.path, 'core.untrackedCache'), undefined, '…and still empty');
		} finally {
			optOutRepo.cleanup();
		}
	});

	test('applying TWICE keeps the original prior, so undo still restores it', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:manyFiles'));
		if (!supported) {
			this.skip();
		}

		// A second apply — a stale view action, or a sibling VS Code window racing this one — must not
		// re-record the ownership marker. Re-recording captures the value GitLens ITSELF just set, and undo
		// would then "restore" the lever to on, permanently.
		const twiceRepo = createTestRepo();
		try {
			assert.strictEqual(localConfig(twiceRepo.path, 'feature.manyFiles'), undefined, 'starts unset');

			const first = await maintenanceOf(twiceRepo).applyOptimization(twiceRepo.path, 'manyFiles');
			const second = await maintenanceOf(twiceRepo).applyOptimization(twiceRepo.path, 'manyFiles');
			assert.strictEqual(first, true, 'first apply');
			assert.strictEqual(second, true, 'second apply');
			assert.strictEqual(
				gkConfig(twiceRepo.path, 'gk.applied.manyFiles'),
				'unset',
				'marker still records the TRUE prior, not the value GitLens set',
			);

			await maintenanceOf(twiceRepo).revertOptimization(twiceRepo.path, 'manyFiles');
			assert.strictEqual(
				localConfig(twiceRepo.path, 'feature.manyFiles'),
				undefined,
				'undo restores the original unset state',
			);
		} finally {
			twiceRepo.cleanup();
		}
	});

	test('revert is a no-op for a lever GitLens did not apply (no ownership marker)', async () => {
		const ownershipRepo = createTestRepo();
		try {
			// Simulate a user who enabled the cache themselves — there is NO gk.applied marker.
			setConfig(ownershipRepo.path, 'core.untrackedCache', 'true');

			await maintenanceOf(ownershipRepo).revertOptimization(ownershipRepo.path, 'untrackedCache');
			assert.strictEqual(
				localConfig(ownershipRepo.path, 'core.untrackedCache'),
				'true',
				'a user-enabled lever must be left untouched',
			);
		} finally {
			ownershipRepo.cleanup();
		}
	});

	test('a CANCELLED untracked-cache probe never records not-applicable (a timeout is not a failed probe)', async () => {
		// `update-index --test-untracked-cache` runs with `errors: 'ignore'`, under which a cancelled or
		// timed-out run RESOLVES an empty `{ exitCode: 0 }` — indistinguishable from a passing probe unless
		// the cancelled/aborted signals are checked. Failing open would enable the untracked cache on exactly
		// the slow/network filesystems the probe exists to exclude (and where it is likeliest to time out).
		const cancelRepo = createTestRepo();
		try {
			const controller = new AbortController();
			controller.abort();

			await assert.rejects(
				() => maintenanceOf(cancelRepo).applyOptimization(cancelRepo.path, 'untrackedCache', controller.signal),
				/Operation cancelled/,
				'a cancelled apply rejects rather than reporting a result',
			);

			assert.strictEqual(
				gkConfig(cancelRepo.path, 'gk.untrackedCacheNotApplicable'),
				undefined,
				'cancellation must NOT permanently mark the repo not-applicable',
			);
			// The probe must reject BEFORE the apply starts: reading it as "supported" gets as far as
			// recording ownership, stranding a marker for a lever that was never enabled.
			assert.strictEqual(
				gkConfig(cancelRepo.path, 'gk.applied.untrackedCache'),
				undefined,
				'no ownership marker for an apply that never ran',
			);
			assert.strictEqual(
				localConfig(cancelRepo.path, 'core.untrackedCache'),
				undefined,
				'the cache must not be enabled off the back of a probe that never ran',
			);
		} finally {
			cancelRepo.cleanup();
		}
	});

	test('a CANCELLED undo keeps its ownership marker (never clears it for a config that is still set)', async () => {
		// `config --local --unset` runs with `errors: 'ignore'` to tolerate the non-zero exit of unsetting an
		// absent key — but a cancelled run resolves identically. Clearing the marker here would leave the
		// lever ON while GitLens reclassifies it as user-enabled, so Undo would never be offered again.
		const cancelRepo = createTestRepo();
		try {
			// Seed the exact post-apply state: cache on, prior recorded as the `unset` sentinel (the
			// fresh-repo case, and the only restore path that swallows errors).
			setConfig(cancelRepo.path, 'core.untrackedCache', 'true');
			await cancelRepo.provider.config.setGkConfig(cancelRepo.path, 'gk.applied.untrackedCache', 'unset');

			const controller = new AbortController();
			controller.abort();

			await assert.rejects(
				() =>
					maintenanceOf(cancelRepo).revertOptimization(cancelRepo.path, 'untrackedCache', controller.signal),
				/Operation cancelled/,
				'a cancelled revert rejects rather than reporting success',
			);

			assert.strictEqual(
				localConfig(cancelRepo.path, 'core.untrackedCache'),
				'true',
				'the lever is still set — the unset never ran',
			);
			assert.strictEqual(
				gkConfig(cancelRepo.path, 'gk.applied.untrackedCache'),
				'unset',
				'ownership marker retained, so Undo is still offered',
			);
		} finally {
			cancelRepo.cleanup();
		}
	});

	test('a FAILED undo keeps its ownership marker (a locked config is not a successful unset)', async () => {
		// `--unset` exits 5 when the key was already absent — benign, and the whole reason this runs with
		// `errors: 'ignore'`. A held `config.lock` instead exits 255 with the value STILL SET. Swallowing
		// that as success clears the marker, so GitLens reclassifies the lever as user-enabled and never
		// offers Undo again — leaving the optimization permanently on with no way back through the UI.
		const lockRepo = createTestRepo();
		try {
			// Seed the post-apply state (the gk marker lives in .git/gk/config, so the lock below can't
			// interfere with writing it).
			setConfig(lockRepo.path, 'core.untrackedCache', 'true');
			await lockRepo.provider.config.setGkConfig(lockRepo.path, 'gk.applied.untrackedCache', 'unset');

			// Hold the config lock exactly as a concurrent writer would.
			const lockPath = join(lockRepo.path, '.git', 'config.lock');
			writeFileSync(lockPath, '');
			try {
				await assert.rejects(
					() => maintenanceOf(lockRepo).revertOptimization(lockRepo.path, 'untrackedCache'),
					/Unable to unset/,
					'a failed unset rejects rather than reporting success',
				);
			} finally {
				rmSync(lockPath, { force: true });
			}

			assert.strictEqual(
				localConfig(lockRepo.path, 'core.untrackedCache'),
				'true',
				'the lever is still enabled — the unset never succeeded',
			);
			assert.strictEqual(
				gkConfig(lockRepo.path, 'gk.applied.untrackedCache'),
				'unset',
				'ownership marker retained, so Undo is still offered',
			);
		} finally {
			lockRepo.cleanup();
		}
	});

	test("a queue-REJECTED command reports an 'unstarted' failure, not a clean exit", async () => {
		// Every completion guard in the maintenance provider rests on this contract. Under `errors: 'ignore'`
		// a command the queue REJECTS outright (disposed, or past its depth cap) resolves WITHOUT ever running
		// and with no cancellation signal — so only `completion` can prove a command ran, and treating it as
		// success would clear ownership markers for config that was never written.
		const queueRepo = createTestRepo();
		try {
			// One slot, one queued command: everything beyond that is rejected rather than run.
			const git = new Git(() => findGitPath(null), {
				queue: { maxConcurrent: 1, maxQueueDepth: 1 },
				gitTimeout: 0,
			});

			const results = await Promise.all(
				Array.from({ length: 12 }, (_, i) =>
					git.run(
						{ cwd: queueRepo.path, errors: 'ignore', priority: 'background', correlationKey: `q${i}` },
						'rev-list',
						'--all',
						'--objects',
					),
				),
			);

			const rejected = results.filter(
				r => r.completion.status === 'failed' && r.completion.reason === 'unstarted',
			);
			assert.ok(rejected.length > 0, 'the depth cap rejected at least one command');
			for (const result of rejected) {
				assert.strictEqual(result.exitCode, undefined, 'a rejected command carries no exit code at all');
				assert.notStrictEqual(result.completion.status, 'cancelled', 'nothing was aborted');
			}
		} finally {
			queueRepo.cleanup();
		}
	});

	test('undo clears a MULTI-VALUED lever (a refused --unset is not a successful one)', async () => {
		// `git config --unset` REFUSES a multi-valued key and exits 5 — the SAME code as the benign "already
		// absent" case — leaving the values in place. Tolerating that as success clears the ownership marker
		// while the lever stays enabled, which is the exact hazard the exit-code whitelist exists to prevent.
		// `--unset-all` removes every local value and reserves 5 for genuinely absent.
		const multiRepo = createTestRepo();
		try {
			setConfig(multiRepo.path, 'core.untrackedCache', 'true');
			// A second local value, as any tool doing `git config --add` would leave behind.
			addLocalConfig(multiRepo.path, 'core.untrackedCache', 'false');
			assert.strictEqual(localConfigAll(multiRepo.path, 'core.untrackedCache').length, 2, 'seeded multivar');

			await multiRepo.provider.config.setGkConfig(multiRepo.path, 'gk.applied.untrackedCache', 'unset');
			await maintenanceOf(multiRepo).revertOptimization(multiRepo.path, 'untrackedCache');

			assert.deepStrictEqual(
				localConfigAll(multiRepo.path, 'core.untrackedCache'),
				[],
				'every local value removed — the lever is genuinely off',
			);
			assert.strictEqual(
				gkConfig(multiRepo.path, 'gk.applied.untrackedCache'),
				undefined,
				'marker cleared only because the unset actually succeeded',
			);
		} finally {
			multiRepo.cleanup();
		}
	});

	test('backgroundMaintenance revert restores the prior maintenance.auto and clears markers', async () => {
		// `git maintenance start`/`register` write the developer's GLOBAL config + a system scheduler, so we
		// never run them here. Instead seed the exact post-apply state (local maintenance.auto=false + the
		// ownership markers recording the prior) and exercise ONLY the revert path. Use an isolated
		// GIT_CONFIG_GLOBAL so the revert's tolerated `git maintenance unregister` can't touch the real global.
		const isoDir = mkdtempSync(join(tmpdir(), 'gitlens-maint-global-'));
		const isoGlobal = join(isoDir, 'gitconfig');
		writeFileSync(isoGlobal, '');
		const autoRepo = createTestRepo({ gitOptions: { env: { GIT_CONFIG_GLOBAL: isoGlobal } } });
		try {
			// The user's prior value; `git maintenance start` would have set it to false and NOT restored it.
			setConfig(autoRepo.path, 'maintenance.auto', 'true');
			setConfig(autoRepo.path, 'maintenance.auto', 'false');

			// Seed the ownership markers exactly as a real apply records them.
			await autoRepo.provider.config.setGkConfig(autoRepo.path, 'gk.applied.maintenanceAuto', 'true');
			await autoRepo.provider.config.setGkConfig(autoRepo.path, 'gk.applied.backgroundMaintenance', 'true');

			await maintenanceOf(autoRepo).revertOptimization(autoRepo.path, 'backgroundMaintenance');

			assert.strictEqual(
				localConfig(autoRepo.path, 'maintenance.auto'),
				'true',
				'maintenance.auto restored to the recorded prior (unregister does not restore it)',
			);
			assert.strictEqual(
				gkConfig(autoRepo.path, 'gk.applied.backgroundMaintenance'),
				undefined,
				'ownership marker cleared',
			);
			assert.strictEqual(gkConfig(autoRepo.path, 'gk.applied.maintenanceAuto'), undefined, 'auto marker cleared');
		} finally {
			autoRepo.cleanup();
			rmSync(isoDir, { recursive: true, force: true });
		}
	});

	test('startBackgroundMaintenance refuses to claim a registration made since the last probe (TOCTOU)', async function () {
		// Isolated GLOBAL config so the direct `maintenance register` below (simulating another tool, or the
		// user, registering the repo between the probe and the click) never touches the developer's real
		// global config, and so the provider's own registration read targets the same isolated file.
		const isoDir = mkdtempSync(join(tmpdir(), 'gitlens-maint-global-'));
		const isoGlobal = join(isoDir, 'gitconfig');
		writeFileSync(isoGlobal, '');
		const freshRepo = createTestRepo({ gitOptions: { env: { GIT_CONFIG_GLOBAL: isoGlobal } } });
		try {
			const capabilities = await maintenanceOf(freshRepo).getCapabilities(freshRepo.path);
			if (capabilities.find(c => c.id === 'backgroundMaintenance')?.supported !== true) {
				this.skip();
			}

			// Register directly, bypassing GitLens's own start/register path — the fresh check must see this
			// regardless of who or what made it.
			execFileSync('git', ['maintenance', 'register'], {
				cwd: freshRepo.path,
				env: { ...process.env, GIT_CONFIG_GLOBAL: isoGlobal },
				stdio: 'pipe',
			});

			const applied = await maintenanceOf(freshRepo).applyOptimization(freshRepo.path, 'backgroundMaintenance');

			assert.strictEqual(applied, false, 'refuses to claim a registration it did not make');
			assert.strictEqual(
				gkConfig(freshRepo.path, 'gk.applied.backgroundMaintenance'),
				undefined,
				'no ownership marker recorded for a registration GitLens did not make',
			);
			assert.strictEqual(
				gkConfig(freshRepo.path, 'gk.applied.maintenanceAuto'),
				undefined,
				'nothing was recorded at all — the fresh check must run BEFORE any recordPriorAndMark',
			);
		} finally {
			freshRepo.cleanup();
			rmSync(isoDir, { recursive: true, force: true });
		}
	});

	test('withMarkerLock release verifies file identity — a lock manually deleted and recreated EMPTY mid-critical-section is left for its new owner', async () => {
		const lockRepo = createTestRepo();
		try {
			const lockPath = join(lockRepo.path, '.git', 'gk', 'applied.lock');

			await withMarkerLock(lockRepo, lockRepo.path, async () => {
				// Simulate a user manually deleting the lock (per the give-up error's recovery instructions)
				// while this critical section is still running, and a new window winning the resulting race
				// and recreating it EMPTY — a different inode, and no `ownerId` to match, behind the same path.
				rmSync(lockPath, { force: true });
				writeFileSync(lockPath, '');
			});

			assert.strictEqual(
				existsSync(lockPath),
				true,
				"the new owner's lock file survives — the original holder's release must not delete it",
			);
		} finally {
			lockRepo.cleanup();
		}
	});

	test('withMarkerLock release verifies ownership by ownerId — a lock manually deleted and recreated by a NEW owner mid-critical-section is left alone', async () => {
		const lockRepo = createTestRepo();
		try {
			const lockPath = join(lockRepo.path, '.git', 'gk', 'applied.lock');

			await withMarkerLock(lockRepo, lockRepo.path, async () => {
				// Same simulation as above, but this time the "new owner" writes a full, validly-shaped record
				// with its OWN random ownerId — proving release keys off ownerId, not just an inode or
				// emptiness the new owner's record could otherwise coincidentally share.
				rmSync(lockPath, { force: true });
				writeFileSync(lockPath, JSON.stringify({ host: hostname(), pid: process.pid, ownerId: 'new-owner' }));
			});

			const survivor = JSON.parse(readFileSync(lockPath, 'utf8')) as { ownerId: string };
			assert.strictEqual(
				survivor.ownerId,
				'new-owner',
				"the new owner's lock file (and its ownerId) survives — the original holder's release must not delete it",
			);
		} finally {
			lockRepo.cleanup();
		}
	});

	test('a live holder is never stolen, however long its critical section runs', async () => {
		const lockRepo = createTestRepo();
		try {
			// The holder is this very process — a live host/pid it records in the lock itself — and holds far
			// longer than the contender's poll window, so only a working liveness probe explains the wait.
			const timings = { retryMs: 20, maxAttempts: 300 };
			const order: string[] = [];

			const holder = withMarkerLock(
				lockRepo,
				lockRepo.path,
				async () => {
					await new Promise(resolve => setTimeout(resolve, 1000));
					order.push('holder-end');
				},
				timings,
			);

			// Give the holder a moment to win the initial `open('wx')` before the contender starts polling.
			await new Promise(resolve => setTimeout(resolve, 20));

			const contender = withMarkerLock(
				lockRepo,
				lockRepo.path,
				async () => {
					order.push('contender-start');
				},
				timings,
			);

			await Promise.all([holder, contender]);

			assert.deepStrictEqual(
				order,
				['holder-end', 'contender-start'],
				'the contender never entered fn() until the live holder finished',
			);
		} finally {
			lockRepo.cleanup();
		}
	});

	test('a lock whose owner probes DEAD gives a crash-recovery error, not an automatic steal', async () => {
		const lockRepo = createTestRepo();
		try {
			const gkDir = join(lockRepo.path, '.git', 'gk');
			mkdirSync(gkDir, { recursive: true });
			const lockPath = join(gkDir, 'applied.lock');
			// Content is irrelevant here — `probeOwner` intercepts before any real liveness check — but it must
			// still parse as an owner record, since malformed content never earns the crash-specific wording.
			writeFileSync(lockPath, JSON.stringify({ host: 'some-machine', pid: 424242, ownerId: 'dead-owner' }));

			let ran = false;
			await assert.rejects(
				() =>
					withMarkerLock(
						lockRepo,
						lockRepo.path,
						async () => {
							ran = true;
						},
						{ retryMs: 20, maxAttempts: 3, probeOwner: () => 'dead' },
					),
				(ex: unknown) => {
					const message = (ex as Error).message;
					assert.match(message, /previous VS Code window appears to have crashed/);
					assert.ok(message.includes(lockPath), 'error names the lock path for manual recovery');
					return true;
				},
			);

			assert.strictEqual(ran, false, 'fn never runs — a dead-owner verdict is diagnosis only, never a steal');
			assert.strictEqual(existsSync(lockPath), true, "the dead owner's lock file survives for manual deletion");
		} finally {
			lockRepo.cleanup();
		}
	});

	test('a lock whose owner probes neither DEAD nor confirmed alive (e.g. a real EPERM) is never stolen — it fails loudly instead', async () => {
		const lockRepo = createTestRepo();
		try {
			const gkDir = join(lockRepo.path, '.git', 'gk');
			mkdirSync(gkDir, { recursive: true });
			const lockPath = join(gkDir, 'applied.lock');
			writeFileSync(lockPath, JSON.stringify({ host: hostname(), pid: 424242, ownerId: 'other-user-owner' }));

			await assert.rejects(
				() =>
					withMarkerLock(lockRepo, lockRepo.path, async () => undefined, {
						retryMs: 10,
						maxAttempts: 3,
						// A real EPERM (the pid belongs to a different user) is exactly as inconclusive as a
						// success verdict — both must never be stolen from, only 'dead' may.
						probeOwner: () => 'alive',
					}),
				(ex: unknown) => {
					const message = (ex as Error).message;
					assert.match(message, /Another window is currently updating Git maintenance settings/);
					assert.ok(message.includes(lockPath), 'error names the lock path for manual recovery');
					return true;
				},
			);

			assert.strictEqual(existsSync(lockPath), true, 'the unverifiable owner lock survives');
		} finally {
			lockRepo.cleanup();
		}
	});

	test('a lock held by a REAL exited process gives the crash-recovery error via the real liveness probe', async () => {
		const lockRepo = createTestRepo();
		try {
			const gkDir = join(lockRepo.path, '.git', 'gk');
			mkdirSync(gkDir, { recursive: true });
			const lockPath = join(gkDir, 'applied.lock');

			// `spawnSync` reaps the child before returning, so this pid is guaranteed gone (not a zombie) by
			// the time the probe runs — the real `process.kill(pid, 0)` must answer ESRCH for it.
			const exited = spawnSync(process.execPath, ['-e', '']);
			writeFileSync(lockPath, JSON.stringify({ host: hostname(), pid: exited.pid, ownerId: 'dead-owner' }));

			await assert.rejects(
				() => withMarkerLock(lockRepo, lockRepo.path, async () => undefined, { retryMs: 20, maxAttempts: 3 }),
				(ex: unknown) => {
					const message = (ex as Error).message;
					assert.match(message, /previous VS Code window appears to have crashed/);
					return true;
				},
				'the real ESRCH liveness probe proves the owner dead, still only for the error wording',
			);
		} finally {
			lockRepo.cleanup();
		}
	});

	test('a lock recorded on ANOTHER host is never stolen — it fails loudly instead', async () => {
		const lockRepo = createTestRepo();
		try {
			const gkDir = join(lockRepo.path, '.git', 'gk');
			mkdirSync(gkDir, { recursive: true });
			const lockPath = join(gkDir, 'applied.lock');
			// A pid probe here would ask about an unrelated local process, so the owner is unverifiable.
			const contents = JSON.stringify({ host: 'some-other-machine', pid: 1, ownerId: 'other-host-owner' });
			writeFileSync(lockPath, contents);

			await assert.rejects(
				() =>
					withMarkerLock(lockRepo, lockRepo.path, async () => undefined, {
						retryMs: 10,
						maxAttempts: 3,
					}),
				(ex: unknown) => {
					const message = (ex as Error).message;
					assert.match(message, /Another window is currently updating Git maintenance settings/);
					assert.ok(message.includes(lockPath), 'error names the lock path for manual recovery');
					return true;
				},
			);

			assert.strictEqual(existsSync(lockPath), true, "the other host's lock file survives");
			assert.strictEqual(readFileSync(lockPath, 'utf8'), contents, 'and its ownership record is untouched');
		} finally {
			lockRepo.cleanup();
		}
	});

	test('a lock with unparseable contents is never stolen — it fails loudly instead', async () => {
		const lockRepo = createTestRepo();
		try {
			const gkDir = join(lockRepo.path, '.git', 'gk');
			mkdirSync(gkDir, { recursive: true });
			const lockPath = join(gkDir, 'applied.lock');
			// Indistinguishable from a holder caught mid-write, so it must be treated as live.
			writeFileSync(lockPath, 'not json');

			await assert.rejects(
				() =>
					withMarkerLock(lockRepo, lockRepo.path, async () => undefined, {
						retryMs: 10,
						maxAttempts: 3,
					}),
				(ex: unknown) => {
					const message = (ex as Error).message;
					assert.match(message, /Another window is currently updating Git maintenance settings/);
					assert.ok(message.includes(lockPath), 'error names the lock path for manual recovery');
					return true;
				},
			);

			assert.strictEqual(existsSync(lockPath), true, 'the unreadable lock file survives');
			assert.strictEqual(readFileSync(lockPath, 'utf8'), 'not json', 'and its contents are untouched');
		} finally {
			lockRepo.cleanup();
		}
	});

	test('a non-EEXIST open failure fails loudly and never runs fn (no unlocked fallback)', async () => {
		const lockRepo = createTestRepo();
		try {
			const lockPath = join(lockRepo.path, '.git', 'gk', 'applied.lock');

			// `openLock` replaces the real `open(lockPath, 'wx')` — deterministic on every platform, unlike
			// forcing EACCES via directory mode bits (POSIX-only; Windows doesn't reliably block child creation).
			let ran = false;
			await assert.rejects(
				() =>
					withMarkerLock(
						lockRepo,
						lockRepo.path,
						async () => {
							ran = true;
						},
						{
							openLock: () => {
								const ex = new Error('EACCES: permission denied, open') as NodeJS.ErrnoException;
								ex.code = 'EACCES';
								return Promise.reject(ex);
							},
						},
					),
				(ex: unknown) => {
					const message = (ex as Error).message;
					assert.match(message, /Could not acquire the Git maintenance settings lock/);
					assert.ok(message.includes(lockPath), 'error names the lock path for manual recovery');
					return true;
				},
			);

			assert.strictEqual(ran, false, 'fn never ran — no unlocked fallback for a genuine acquisition failure');
		} finally {
			lockRepo.cleanup();
		}
	});

	test('an init failure after open (e.g. a failing ownership write) cleans up the lock it just created, and a subsequent acquisition succeeds immediately', async () => {
		const lockRepo = createTestRepo();
		try {
			const lockPath = join(lockRepo.path, '.git', 'gk', 'applied.lock');

			await assert.rejects(
				() =>
					withMarkerLock(lockRepo, lockRepo.path, async () => undefined, {
						writeRecord: () => Promise.reject(new Error('simulated ENOSPC')),
					}),
				/Could not acquire the Git maintenance settings lock/,
			);

			assert.strictEqual(
				existsSync(lockPath),
				false,
				'the just-created lock is removed, not left as an unverifiable orphan',
			);

			let ran = false;
			await withMarkerLock(lockRepo, lockRepo.path, async () => {
				ran = true;
			});
			assert.strictEqual(ran, true, 'a subsequent acquisition succeeds immediately — nothing was stranded');
		} finally {
			lockRepo.cleanup();
		}
	});

	test('an init failure verifies identity before cleanup — a lock replaced by a new owner mid-window survives', async () => {
		const lockRepo = createTestRepo();
		try {
			const lockPath = join(lockRepo.path, '.git', 'gk', 'applied.lock');
			const replacement = JSON.stringify({ host: hostname(), pid: process.pid, ownerId: 'new-owner' });

			await assert.rejects(
				() =>
					withMarkerLock(lockRepo, lockRepo.path, async () => undefined, {
						// Stage the window deterministically from inside the failing callback itself: by the
						// time init-failure cleanup runs, a different owner has already recreated the lock.
						writeRecord: () => {
							rmSync(lockPath, { force: true });
							writeFileSync(lockPath, replacement);
							return Promise.reject(new Error('simulated ENOSPC'));
						},
					}),
				(ex: unknown) => {
					assert.match((ex as Error).message, /Could not acquire the Git maintenance settings lock/);
					assert.strictEqual(
						((ex as Error).cause as Error | undefined)?.message,
						'simulated ENOSPC',
						'the original init failure is preserved as the cause, not swallowed by the identity check',
					);
					return true;
				},
			);

			assert.strictEqual(existsSync(lockPath), true, "the new owner's lock file survives");
			assert.strictEqual(readFileSync(lockPath, 'utf8'), replacement, 'and its content is untouched');
		} finally {
			lockRepo.cleanup();
		}
	});

	test('runMaintenanceTask(loose-objects) packs the loose objects into a new pack', async function () {
		const supported = await Promise.resolve(repo.provider.supports('git:maintenance'));
		if (!supported) {
			this.skip();
		}

		// Own repo: this test permanently creates a pack, and its precondition must not depend on
		// which sibling tests ran (or mutated the shared repo) first.
		const packRepo = createTestRepo();
		try {
			const before = await maintenanceOf(packRepo).getHealthSnapshot(packRepo.path);
			assert.strictEqual(before.packCount, 0, 'starts with no packs');

			const ran = await maintenanceOf(packRepo).runMaintenanceTask(packRepo.path, 'loose-objects');
			assert.strictEqual(ran, true, 'task reports that it ran');

			const after = await maintenanceOf(packRepo).getHealthSnapshot(packRepo.path);
			assert.ok(after.packCount >= 1, 'loose objects were packed into at least one pack');
		} finally {
			packRepo.cleanup();
		}
	});

	test('runMaintenanceTask(commit-graph) writes the graph directly, gated on git:commit-graph (not git:maintenance)', async () => {
		// The commit-graph task uses a DIRECT `git commit-graph write --reachable --split` (2.24+), NOT
		// `git maintenance run --task=commit-graph` (2.30+) — so it runs whenever git:commit-graph is supported.
		const cgRepo = createTestRepo();
		try {
			const supported = await Promise.resolve(cgRepo.provider.supports('git:commit-graph'));
			const ran = await maintenanceOf(cgRepo).runMaintenanceTask(cgRepo.path, 'commit-graph');
			assert.strictEqual(ran, supported, 'ran iff git:commit-graph is supported');
			if (supported) {
				assert.strictEqual(existsSync(commitGraphChainDir(cgRepo.path)), true, 'a --split chain was written');
			}
		} finally {
			cgRepo.cleanup();
		}
	});
});
