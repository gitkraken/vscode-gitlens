import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { isDescendant, joinPaths, relative } from '@gitlens/utils/path.js';
import type { FileWatchEvent } from './provider.js';
import type { WatchPollingOptions } from './watchService.js';

const defaultPollIntervalMs = 60_000;
const defaultPollActiveCheckMs = 5_000;
const defaultPollConcurrency = 4;

type GitDirStat = Awaited<ReturnType<WatchPollingOptions['stat']>>;

/** Something the {@link GitDirPoller} reads once per pass */
export interface PollTarget {
	poll(): Promise<void>;
}

/** A file or directory a poll stats, relative to the directory it watches in place of a watcher */
export interface GitDirProbe {
	/** `/`-separated, relative to the target's base path */
	readonly path: string;
	/** The relative paths a move is reported as, in place of `path` */
	readonly emitAs?: readonly string[];
}

/**
 * Runs passes over the poll targets of every watcher that can't be trusted, reading at most 4 targets at once across
 * passes and first readings. A target is read once soon after it is added, so its baseline doesn't wait for the next
 * pass; targets added together are read together.
 *
 * With the default gate (no `isActive`), one timer runs a pass every `intervalMs`, stopped by {@link suspend} and
 * restarted by {@link resume}, which runs a pass at once. With a host's `isActive`, whose changes core can't see, one
 * timer looks at it every `activeCheckMs`: a pass is due once `intervalMs` has gone by since the last one, or at the
 * first look after the gate opens (or after {@link nudge}), so a window that comes back between passes doesn't wait out
 * the rest of one.
 */
export class GitDirPoller implements UnifiedDisposable {
	private readonly targets = new Set<PollTarget>();
	/** Targets added since the last pass and not yet read */
	private readonly unread = new Set<PollTarget>();
	/** Each target's last read asked for; a target is never read twice at once, so the next waits for it */
	private readonly reading = new Map<PollTarget, Promise<void>>();
	/** Reads waiting for one of the {@link defaultPollConcurrency} slots, which a finished read hands over */
	private readonly waiting: (() => void)[] = [];
	/**
	 * The stats of the batches (a pass, or first readings) in flight, shared by every target that probes the same path,
	 * as the main checkout's root and its common dir do
	 */
	private readonly stats = new Map<string, Promise<GitDirStat>>();
	private readonly intervalMs: number;
	private readonly activeCheckMs: number;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private running: Promise<void> | undefined;
	private batches = 0;
	private slotsInUse = 0;
	/** The next look runs a pass whatever the interval says */
	private due = true;
	private lastPassAt = 0;
	private suspended = false;
	private disposed = false;

	constructor(readonly options: WatchPollingOptions) {
		this.intervalMs = options.intervalMs ?? defaultPollIntervalMs;
		this.activeCheckMs = options.activeCheckMs ?? defaultPollActiveCheckMs;
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		this.disposed = true;
		this.targets.clear();
		this.unread.clear();
		this.stats.clear();
		this.stopTimer();
	}

	get size(): number {
		return this.targets.size;
	}

	add(target: PollTarget): void {
		if (this.disposed || this.targets.has(target)) return;

		this.targets.add(target);
		this.unread.add(target);
		if (this.unread.size === 1) {
			queueMicrotask(() => this.readUnread());
		}
		this.startTimer();
	}

	delete(target: PollTarget): void {
		this.unread.delete(target);
		if (!this.targets.delete(target) || this.targets.size !== 0) return;

		this.stopTimer();
	}

	/** Makes the next look a pass, and looks now */
	nudge(): void {
		this.due = true;
		void this.tick();
	}

	/** Under the default gate, stops passes (and the timer) until {@link resume}; a host's `isActive` ignores it */
	suspend(): void {
		this.suspended = true;
		if (this.options.isActive == null) {
			this.stopTimer();
		}
	}

	/** Lifts {@link suspend}, and runs a pass now, so what moved meanwhile is polled rather than at the next look */
	resume(): void {
		this.suspended = false;
		this.nudge();
	}

	/** One look at the gate: runs a pass when one is due, the gate is open and none is in flight */
	tick(): Promise<void> {
		if (this.disposed || this.targets.size === 0) return Promise.resolve();

		if (!(this.options.isActive?.() ?? !this.suspended)) {
			this.due = true;
			return Promise.resolve();
		}

		// A pass asked for while one is in flight runs once it ends; an elapsed interval just waits for the next look
		if (this.running != null) return this.running;

		const now = performance.now();
		if (!this.due && now - this.lastPassAt < this.intervalMs) return Promise.resolve();

		// Under the default gate the timer counts the interval from this pass, whatever started it
		if (this.options.isActive == null) {
			this.stopTimer();
			this.startTimer();
		}
		this.due = false;
		this.lastPassAt = now;
		this.running = this.pass().finally(() => {
			this.running = undefined;
			if (this.due) {
				void this.tick();
			}
		});
		return this.running;
	}

	/** Stats `path` once for every target that probes it in the batches in flight */
	stat(path: string): Promise<GitDirStat> {
		if (this.batches === 0) return this.options.stat(path);

		let stat = this.stats.get(path);
		if (stat == null) {
			stat = this.options.stat(path);
			this.stats.set(path, stat);
		}
		return stat;
	}

	/** `path` changed since it was statted, so the next target to probe it in a batch in flight stats it again */
	invalidate(path: string): void {
		this.stats.delete(path);
	}

	private pass(): Promise<void> {
		// A pass reads its own stats, never ones from before it began
		this.stats.clear();
		// The pass baselines any target not read yet
		this.unread.clear();
		return this.readAll([...this.targets]);
	}

	private readUnread(): void {
		if (this.unread.size === 0) return;

		const targets = [...this.unread];
		this.unread.clear();
		void this.readAll(targets);
	}

	private async readAll(targets: readonly PollTarget[]): Promise<void> {
		this.batches++;
		try {
			// A target that fails is read again next pass; nothing it saw this time is reported
			await Promise.allSettled(targets.map(target => this.read(target)));
		} finally {
			this.batches--;
			if (this.batches === 0) {
				this.stats.clear();
			}
		}
	}

	/** Reads `target` once any read of it in flight ends, so the reading is fresh and its probes current */
	private read(target: PollTarget): Promise<void> {
		const poll = async (): Promise<void> => {
			if (!this.targets.has(target)) return;

			await this.acquireSlot();
			try {
				if (this.targets.has(target)) {
					await target.poll();
				}
			} finally {
				this.releaseSlot();
			}
		};
		const previous = this.reading.get(target);
		const reading: Promise<void> = (previous != null ? previous.then(poll, poll) : poll()).finally(() => {
			if (this.reading.get(target) === reading) {
				this.reading.delete(target);
			}
		});
		this.reading.set(target, reading);
		return reading;
	}

	private acquireSlot(): Promise<void> | undefined {
		if (this.slotsInUse < defaultPollConcurrency) {
			this.slotsInUse++;
			return undefined;
		}

		return new Promise(resolve => this.waiting.push(resolve));
	}

	private releaseSlot(): void {
		const next = this.waiting.shift();
		if (next != null) {
			next();
		} else {
			this.slotsInUse--;
		}
	}

	private startTimer(): void {
		if (this.timer != null || this.disposed || this.targets.size === 0) return;

		if (this.options.isActive != null) {
			this.timer = setInterval(() => void this.tick(), this.activeCheckMs);
		} else if (!this.suspended) {
			this.timer = setTimeout(() => {
				this.timer = undefined;
				this.due = true;
				void this.tick();
			}, this.intervalMs);
		} else {
			return;
		}

		// A poll alone must not keep a (Node) process alive; in the browser timers are numbers
		if (typeof this.timer !== 'number') {
			this.timer.unref();
		}
	}

	private stopTimer(): void {
		if (this.timer == null) return;

		if (this.options.isActive != null) {
			clearInterval(this.timer);
		} else {
			clearTimeout(this.timer);
		}
		this.timer = undefined;
		this.due = true;
	}
}

/**
 * Stands in for a watcher on `basePath`: stats each probe and reports one whose `mtime:size` moved as a `change` of
 * the paths it is emitted as, through the same handler the watcher's own events take. A probe's first read (and a
 * probe new to the set, as after a branch switch) only records; one that was missing and is now present moved. A stat
 * that throws keeps the last reading, so it never counts as a move.
 */
export class GitDirProbeTarget implements PollTarget {
	private readonly signatures = new Map<string, string>();
	/** For each poll whose stats are in flight, the paths {@link forget} cleared meanwhile, which it must not record */
	private readonly forgottenDuringPolls = new Set<Set<string>>();

	constructor(
		private readonly basePath: string,
		private readonly stats: Pick<GitDirPoller, 'stat' | 'invalidate'>,
		private readonly getProbes: () => Iterable<GitDirProbe>,
		/** For each path a probe may be emitted as, the paths of the probes emitted as it */
		private readonly probesByEmittedPath: ReadonlyMap<string, readonly string[]>,
		private readonly onMoved: (event: FileWatchEvent, probe: GitDirProbe) => void,
	) {}

	async poll(): Promise<void> {
		const probes = [...this.getProbes()];
		const forgotten = new Set<string>();
		this.forgottenDuringPolls.add(forgotten);
		const readings = await Promise.all(probes.map(p => this.read(p.path)));
		this.forgottenDuringPolls.delete(forgotten);

		const seen = new Set<string>();
		const moved: GitDirProbe[] = [];
		for (let i = 0; i < probes.length; i++) {
			const probe = probes[i];
			seen.add(probe.path);

			const reading = readings[i];
			if (reading == null || forgotten.has(probe.path)) continue;

			const previous = this.signatures.get(probe.path);
			this.signatures.set(probe.path, reading);
			if (previous != null && previous !== reading) {
				moved.push(probe);
			}
		}

		// A probe that left the set starts over if it comes back
		for (const path of this.signatures.keys()) {
			if (!seen.has(path)) {
				this.signatures.delete(path);
			}
		}

		for (const probe of moved) {
			for (const path of probe.emitAs ?? [probe.path]) {
				this.onMoved({ path: joinPaths(this.basePath, path), reason: 'change' }, probe);
			}
		}
	}

	/**
	 * The watcher reported `path` itself, so the next poll records the probes it touched (the path, a ref's lock file
	 * standing for the ref, the directories above it, and the probes emitted as it, like `logs/HEAD` as `HEAD`, which
	 * the watcher never sees) without reporting them again.
	 */
	forget(path: string): void {
		if (!isDescendant(path, this.basePath)) return;

		let relativePath = relative(this.basePath, path);
		if (relativePath.endsWith('.lock')) {
			relativePath = relativePath.substring(0, relativePath.length - 5);
		}

		for (let p = relativePath; p.length > 0; p = p.substring(0, Math.max(0, p.lastIndexOf('/')))) {
			this.clearSignature(p);
		}

		for (const probePath of this.probesByEmittedPath.get(relativePath) ?? []) {
			this.clearSignature(probePath);
		}
	}

	private clearSignature(path: string): void {
		this.signatures.delete(path);
		this.stats.invalidate(joinPaths(this.basePath, path));
		for (const forgotten of this.forgottenDuringPolls) {
			forgotten.add(path);
		}
	}

	private async read(path: string): Promise<string | undefined> {
		try {
			const stat = await this.stats.stat(joinPaths(this.basePath, path));
			return stat == null ? 'missing' : `${stat.mtime}:${stat.size}`;
		} catch {
			return undefined;
		}
	}
}
