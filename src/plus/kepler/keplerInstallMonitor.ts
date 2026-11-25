import type { Disposable } from 'vscode';
import { uuid } from '@gitlens/utils/crypto.js';
import type { StoredKeplerInstall } from '../../constants.storage.js';
import type { Container } from '../../container.js';
import type { KeplerInstallStep, KeplerReleaseFileKind } from './keplerRelease.js';

export const keplerInstallHeartbeatInterval = 30_000;
export const keplerInstallStaleAfter = 2 * 60_000;
export const keplerInstallCheckMaxDelay = 10_000;

export class KeplerInstallMonitor implements Disposable {
	private readonly windowId = uuid();
	private _install: StoredKeplerInstall | undefined;
	private _heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	private _checkTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly container: Container) {}

	dispose(): void {
		clearInterval(this._heartbeatTimer);
		clearTimeout(this._checkTimer);
	}

	watchForAbandoned(): void {
		this.scheduleCheck(0);
	}

	start(kind: KeplerReleaseFileKind): { concurrent: boolean } {
		const now = Date.now();
		const concurrent = Object.entries(this.read()).some(
			([windowId, install]) => windowId !== this.windowId && !isStale(install, now),
		);

		this._install = { kind: kind, startedAt: now, heartbeatAt: now };
		this.write();
		clearInterval(this._heartbeatTimer);
		this._heartbeatTimer = setInterval(() => this.beat(), keplerInstallHeartbeatInterval);
		return { concurrent: concurrent };
	}

	setStep(step: KeplerInstallStep): void {
		if (this._install == null || this._install.step === step) return;

		this._install = { ...this._install, step: step, heartbeatAt: Date.now() };
		this.write();
	}

	stop(): void {
		clearInterval(this._heartbeatTimer);
		this._heartbeatTimer = undefined;
		this._install = undefined;
		this.write();
	}

	private beat(): void {
		if (this._install == null) return;

		this._install = { ...this._install, heartbeatAt: Date.now() };
		this.write();
	}

	private read(): Record<string, StoredKeplerInstall> {
		return this.container.storage.get('kepler:installs') ?? {};
	}

	private write(): void {
		const { [this.windowId]: _, ...installs } = this.read();
		if (this._install != null) {
			installs[this.windowId] = this._install;
		}
		this.store(installs);
	}

	private store(installs: Record<string, StoredKeplerInstall>): void {
		void this.container.storage.store('kepler:installs', Object.keys(installs).length ? installs : undefined);
	}

	// KEEP: the random delay — windows restored together would otherwise all report the same install
	private scheduleCheck(delay: number): void {
		clearTimeout(this._checkTimer);
		this._checkTimer = setTimeout(() => this.reportAbandoned(), delay + Math.random() * keplerInstallCheckMaxDelay);
	}

	private reportAbandoned(): void {
		const now = Date.now();
		const remaining: Record<string, StoredKeplerInstall> = {};
		const abandoned: StoredKeplerInstall[] = [];
		let nextStaleAt: number | undefined;

		for (const [windowId, install] of Object.entries(this.read())) {
			if (windowId !== this.windowId && isStale(install, now)) {
				abandoned.push(install);
				continue;
			}

			remaining[windowId] = install;
			if (windowId !== this.windowId) {
				nextStaleAt = Math.min(nextStaleAt ?? Infinity, install.heartbeatAt + keplerInstallStaleAfter);
			}
		}

		if (abandoned.length) {
			this.store(remaining);
			for (const install of abandoned) {
				this.container.telemetry.sendEvent('kepler/install/abandoned', {
					kind: install.kind,
					step: install.step,
					duration: install.heartbeatAt - install.startedAt,
				});
			}
		}

		if (nextStaleAt != null) {
			this.scheduleCheck(nextStaleAt - now);
		}
	}
}

function isStale(install: StoredKeplerInstall, now: number): boolean {
	return now - install.heartbeatAt >= keplerInstallStaleAfter;
}
