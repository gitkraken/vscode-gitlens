import type { Event } from 'vscode';
import { Disposable, EventEmitter } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import { updateRecordValue } from '@gitlens/utils/object.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import { defer } from '@gitlens/utils/promise.js';
import { compare, fromString, fromVersion, satisfies } from '@gitlens/utils/version.js';
import type { OnboardingItemState, OnboardingKeys } from '../constants.onboarding.js';
import { onboardingDefinitions } from '../constants.onboarding.js';
import type { DeprecatedGlobalStorage } from '../constants.storage.js';
import { registerCommand } from '../system/-webview/command.js';
import type { Storage, StorageChangeEvent, StorageType } from '../system/-webview/storage.js';
import type { OnboardingItem, OnboardingStorage } from './models/onboarding.js';
import { onboardingMigrations } from './onboardingMigrations.js';

export interface OnboardingChangeEvent {
	readonly key: OnboardingKeys;
	readonly dismissed: boolean;
}

type OnboardingStorageType = Exclude<StorageType, 'scoped'>;

/**
 * Centralized service for managing dismissible/onboarding UI state.
 *
 * Provides a unified API for checking, dismissing, and resetting onboarding items,
 * with built-in versioning support to re-show items after significant changes,
 * and typed data storage with schema migrations.
 */
export class OnboardingService implements Disposable {
	private readonly _onDidChange = new EventEmitter<OnboardingChangeEvent>();
	get onDidChange(): Event<OnboardingChangeEvent> {
		return this._onDidChange.event;
	}

	private readonly _disposable: Disposable;
	private _onboarding: { [key in OnboardingStorageType]: OnboardingStorage | undefined } = {
		global: undefined,
		workspace: undefined,
	};
	private readonly _ready: Deferred<void>;
	private _version: `${number}.${number}.${number}`;

	constructor(
		private readonly storage: Storage,
		version: string,
	) {
		this._version = fromVersion(fromString(version), false);
		this._ready = defer<void>();
		this._disposable = Disposable.from(
			this.storage.onDidChange(this.onStorageChanged, this),
			registerCommand('gitlens.onboarding.dismiss', args => {
				if (args.id in onboardingDefinitions) {
					void this.dismiss(args.id);
				} else {
					debugger;
					Logger.warn(`Unknown onboarding key: ${args.id}`);
				}
			}),
		);

		void this.migrateLegacyState().then(
			() => this._ready.fulfill(undefined),
			(ex: unknown) => {
				Logger.error(ex, 'OnboardingService', 'Legacy state migration failed');
				this._ready.fulfill(undefined);
			},
		);
	}

	/** Promise that resolves once legacy state migration is complete */
	get ready(): Promise<void> {
		return this._ready.promise;
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._disposable.dispose();
	}

	private onStorageChanged(e: StorageChangeEvent): void {
		if (e.type === 'scoped' || !e.keys.includes('onboarding:state')) return;

		// Invalidate the appropriate cache when storage changes externally
		const previousState = this._onboarding[e.type];
		this._onboarding[e.type] = undefined;

		if (previousState != null) {
			const currentState = this.getOnboarding(e.type);

			// Diff items to find what changed and fire events
			const keys = new Set([...Object.keys(previousState.items), ...Object.keys(currentState.items)]);
			for (const key of keys) {
				const previous = previousState.items[key]?.dismissedAt != null;
				const current = currentState.items[key]?.dismissedAt != null;

				if (previous !== current) {
					this._onDidChange.fire({ key: key as OnboardingKeys, dismissed: current });
				}
			}
		}
	}

	/**
	 * Checks if an onboarding item is dismissed
	 * Respects `reshowAfter` - if the user dismissed before that version, returns false
	 */
	isDismissed(key: OnboardingKeys, skipLegacyFallback: boolean = false): boolean {
		const item = this.getItem(key);
		if (!item?.dismissedAt) {
			// During migration, check legacy storage keys as a fallback so callers
			// that run before migration completes don't see unmigrated (false) state
			if (!skipLegacyFallback && this._ready.pending) {
				return this.isLegacyDismissed(key);
			}
			return false;
		}

		// If reshowAfter is set and user dismissed before that version, re-show
		const { reshowAfter } = onboardingDefinitions[key] as { reshowAfter?: `${number}.${number}.${number}` };
		if (reshowAfter && item.dismissedVersion) {
			if (satisfies(item.dismissedVersion, `< ${reshowAfter}`)) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Checks legacy (pre-onboarding-service) storage keys for dismiss state.
	 * Only used as a fallback during the brief migration window on upgrade.
	 */
	private isLegacyDismissed(key: OnboardingKeys): boolean {
		/* eslint-disable @typescript-eslint/no-deprecated -- intentional: reading deprecated keys as migration fallback */
		switch (key) {
			case 'views:scmGrouped:welcome':
				return this.storage.get('views:scm:grouped:welcome:dismissed') ?? false;
			case 'mcp:banner':
				return this.storage.get('mcp:banner:dismissed') ?? false;
			case 'home:walkthrough':
				return this.storage.get('home:walkthrough:dismissed') ?? false;
			case 'home:integrationBanner':
				return this.storage.get('home:sections:collapsed')?.includes('integrationBanner') ?? false;
			case 'composer:onboarding':
				return this.storage.get('composer:onboarding:dismissed') != null;
			default:
				return false;
		}
		/* eslint-enable @typescript-eslint/no-deprecated */
	}

	/** Dismiss an onboarding item, recording the current timestamp and GitLens version */
	async dismiss(key: OnboardingKeys): Promise<void> {
		const { scope } = onboardingDefinitions[key];

		const onboarding = this.getOnboarding(scope);
		const existing = onboarding.items[key];

		onboarding.items[key] = {
			...existing,
			dismissedAt: new Date().toISOString(),
			dismissedVersion: this._version,
		};

		await this.saveOnboarding(scope, onboarding);
		this._onDidChange.fire({ key: key, dismissed: true });
	}

	/** Get item state, running migrations if needed */
	getItemState<T extends OnboardingKeys>(key: T): OnboardingItemState<T> | undefined {
		const item = this.getItem(key);
		if (!item?.state) return undefined;

		const { schema: currentSchema, scope } = onboardingDefinitions[key];
		const storedSchema = item.schema;

		// No schema defined or already current - no migration needed
		if (!currentSchema || (storedSchema && compare(storedSchema, currentSchema) >= 0)) {
			return item.state as OnboardingItemState<T>;
		}

		// Run migrations in version order for versions between stored and current
		const migrations = onboardingMigrations[key];
		let state: OnboardingItemState<T> = item.state;

		if (migrations) {
			// Sort migration versions and run applicable ones
			const migrationVersions = Object.keys(migrations).sort((a, b) => compare(a, b));

			for (const version of migrationVersions) {
				// Skip migrations at or before stored schema
				if (storedSchema && compare(version, storedSchema) <= 0) {
					continue;
				}

				// Skip migrations after current schema
				if (compare(version, currentSchema) > 0) {
					continue;
				}

				const migrate = migrations[version as `${number}.${number}.${number}`];
				if (migrate) {
					state = migrate(state);
				}
			}
		}

		// Persist migrated data so we don't re-migrate next time
		void this.setItemStateCore(key, state, scope, currentSchema);

		return state;
	}

	/** Set typed data for an item */
	async setItemState<T extends OnboardingKeys>(key: T, state: OnboardingItemState<T>): Promise<void> {
		const { scope, schema } = onboardingDefinitions[key];
		await this.setItemStateCore(key, state, scope, schema);
	}

	/** Resets a specific onboarding item */
	async reset(key: OnboardingKeys): Promise<void> {
		const { scope } = onboardingDefinitions[key];

		const onboarding = this.getOnboarding(scope);
		const dismissed = onboarding.items[key]?.dismissedAt != null;

		updateRecordValue(onboarding.items, key, undefined);

		await this.saveOnboarding(scope, onboarding);
		if (dismissed) {
			this._onDidChange.fire({ key: key, dismissed: false });
		}
	}

	/** Resets all onboarding state */
	async resetAll(): Promise<void> {
		// Collect previously dismissed keys before clearing — use getOnboarding()
		// to ensure storage is read (not just the cache) so change events fire correctly
		const dismissedKeys: OnboardingKeys[] = [];
		for (const scope of ['global', 'workspace'] as const) {
			const onboarding = this.getOnboarding(scope);
			for (const [key, item] of Object.entries(onboarding.items)) {
				if (item?.dismissedAt != null) {
					dismissedKeys.push(key as OnboardingKeys);
				}
			}
		}

		this._onboarding.global = { items: {} };
		this._onboarding.workspace = { items: {} };
		await this.storage.store('onboarding:state', undefined);
		await this.storage.storeWorkspace('onboarding:state', undefined);

		for (const key of dismissedKeys) {
			this._onDidChange.fire({ key: key, dismissed: false });
		}
	}

	private async migrateLegacyState(): Promise<void> {
		const onboarding = this.getOnboarding('global');
		// Support both the old boolean flag and new versioned flag
		/* eslint-disable @typescript-eslint/no-deprecated -- intentional access to deprecated `migrated` flag */
		const migratedVersion = onboarding.migratedVersion ?? (onboarding.migrated ? '17.8.0' : undefined);
		/* eslint-enable @typescript-eslint/no-deprecated */

		// Batch 1 (17.8.0): Original deprecated key migrations
		if (!migratedVersion || compare(migratedVersion, '17.8.0') < 0) {
			const batch1: { legacy: keyof DeprecatedGlobalStorage; current: OnboardingKeys }[] = [
				{ legacy: 'views:scm:grouped:welcome:dismissed', current: 'views:scmGrouped:welcome' },
				{ legacy: 'mcp:banner:dismissed', current: 'mcp:banner' },
				{ legacy: 'home:walkthrough:dismissed', current: 'home:walkthrough' },
			];

			for (const { legacy, current } of batch1) {
				// Intentionally reading/deleting deprecated keys during migration
				// eslint-disable-next-line @typescript-eslint/no-deprecated
				const wasDismissed = this.storage.get(legacy);
				if (wasDismissed) {
					if (!this.isDismissed(current, true)) {
						await this.dismiss(current);
					}
					await this.storage.delete(legacy);
				}
			}
		}

		// Batch 2 (17.9.0): home:sections:collapsed + composer onboarding
		if (!migratedVersion || compare(migratedVersion, '17.9.0') < 0) {
			// Migrate onboarding items from home:sections:collapsed array
			const collapsedSections = this.storage.get('home:sections:collapsed');
			if (collapsedSections != null) {
				const sectionMap: Record<string, OnboardingKeys> = { integrationBanner: 'home:integrationBanner' };

				for (const section of collapsedSections) {
					const key = sectionMap[section];
					if (key && !this.isDismissed(key, true)) {
						await this.dismiss(key);
					}
				}
				await this.storage.delete('home:sections:collapsed');
			}

			// Intentionally reading/deleting deprecated keys during migration
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			const composerDismissed = this.storage.get('composer:onboarding:dismissed');
			// eslint-disable-next-line @typescript-eslint/no-deprecated
			const composerStepReached = this.storage.get('composer:onboarding:stepReached');
			if (composerDismissed != null || composerStepReached != null) {
				if (composerDismissed != null && !this.isDismissed('composer:onboarding', true)) {
					await this.dismiss('composer:onboarding');
				}
				if (composerStepReached != null) {
					await this.setItemState('composer:onboarding', {
						stepReached: composerStepReached,
					});
				}
				await this.storage.delete('composer:onboarding:dismissed');
				await this.storage.delete('composer:onboarding:stepReached');
			}
		}

		// Re-read since dismiss calls above may have invalidated the cached state
		const state = this.getOnboarding('global');
		state.migratedVersion = '17.9.0';
		// eslint-disable-next-line @typescript-eslint/no-deprecated
		delete state.migrated;
		await this.saveOnboarding('global', state);
	}

	private async setItemStateCore<T extends OnboardingKeys>(
		key: T,
		state: OnboardingItemState<T>,
		scope: OnboardingStorageType,
		schema: `${number}.${number}.${number}` | undefined,
	): Promise<void> {
		const onboarding = this.getOnboarding(scope);
		const existing = onboarding.items[key] ?? {};

		const updated: OnboardingItem<OnboardingItemState<T>> = {
			...existing,
			schema: schema,
			state: state,
		};
		onboarding.items[key] = updated;

		await this.saveOnboarding(scope, onboarding);
	}

	private getItem<T extends OnboardingKeys>(key: T): OnboardingItem<OnboardingItemState<T>> | undefined {
		const scope = onboardingDefinitions[key].scope;
		return this.getOnboarding(scope).items[key] as OnboardingItem<OnboardingItemState<T>> | undefined;
	}

	private getOnboarding(scope: OnboardingStorageType): OnboardingStorage {
		let onboarding = this._onboarding[scope];
		if (onboarding == null) {
			onboarding = (scope === 'workspace'
				? this.storage.getWorkspace('onboarding:state')
				: this.storage.get('onboarding:state')) ?? { items: {} };
			this._onboarding[scope] = onboarding;
		}
		return onboarding;
	}

	private async saveOnboarding(scope: OnboardingStorageType, onboarding: OnboardingStorage): Promise<void> {
		this._onboarding[scope] = onboarding;
		if (scope === 'workspace') {
			await this.storage.storeWorkspace('onboarding:state', onboarding);
		} else {
			await this.storage.store('onboarding:state', onboarding);
		}
	}
}
