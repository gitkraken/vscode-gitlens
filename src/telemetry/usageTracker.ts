import type { Disposable, Event } from 'vscode';
import { EventEmitter } from 'vscode';
import type { TrackedUsage, TrackedUsageKeys } from '../constants.telemetry';
import type { Container } from '../container';
import { updateRecordValue } from '../system/object';
import type { Storage } from '../system/vscode/storage';

export type UsageChangeEvent = {
	/**
	 * The key of the action/event/feature who's usage was tracked
	 */
	readonly key: TrackedUsageKeys;
	readonly usage?: TrackedUsage;
};

export class UsageTracker implements Disposable {
	private _onDidChange = new EventEmitter<UsageChangeEvent | undefined>();
	get onDidChange(): Event<UsageChangeEvent | undefined> {
		return this._onDidChange.event;
	}

	constructor(
		private readonly container: Container,
		private readonly storage: Storage,
	) {}

	dispose(): void {}

	get(key: TrackedUsageKeys): TrackedUsage | undefined {
		return this.storage.get('usages')?.[key];
	}

	isUsed(key: TrackedUsageKeys): boolean {
		return Boolean(this.get(key)?.firstUsedAt);
	}

	async reset(key?: TrackedUsageKeys): Promise<void> {
		let usages = this.storage.get('usages');
		if (usages == null) return;

		if (key == null) {
			await this.storage.delete('usages');
			this._onDidChange.fire(undefined);

			return;
		}

		usages = updateRecordValue(usages, key, undefined);

		await this.storage.store('usages', usages);
		this._onDidChange.fire({ key: key, usage: undefined });
	}

	async track(key: TrackedUsageKeys): Promise<void> {
		let usages = this.storage.get('usages');
		if (usages == null) {
			usages = Object.create(null) as NonNullable<typeof usages>;
		}

		const usedAt = Date.now();

		let usage = usages[key];
		if (usage == null) {
			usage = {
				count: 1,
				firstUsedAt: usedAt,
				lastUsedAt: usedAt,
			};
			usages[key] = usage;
		} else {
			if (usage.count !== Number.MAX_SAFE_INTEGER) {
				usage.count++;
			}
			usage.lastUsedAt = usedAt;
		}

		this.container.telemetry.sendEvent('usage/track', { 'usage.key': key, 'usage.count': usage.count });

		await this.storage.store('usages', usages);

		this._onDidChange.fire({ key: key, usage: usage });
	}
}
