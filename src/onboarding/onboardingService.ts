import type { Event } from 'vscode';
import { Disposable, EventEmitter } from 'vscode';
import type { OnboardingItemState, OnboardingKeys } from '../constants.onboarding.js';
import { onboardingDefinitions } from '../constants.onboarding.js';
import { registerCommand } from '../system/-webview/command.js';
import type { Storage, StorageChangeEvent } from '../system/-webview/storage.js';
import { updateRecordValue } from '../system/object.js';
import { compare, fromString, fromVersion, satisfies } from '../system/version.js';
import type { OnboardingItem, OnboardingStorage } from './models/onboarding.js';
import { onboardingMigrations } from './onboardingMigrations.js';

export interface OnboardingChangeEvent {
	readonly key: OnboardingKeys;
	readonly dismissed: boolean;
}

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
	private _globalOnboarding: OnboardingStorage | undefined;
	private _workspaceOnboarding: OnboardingStorage | undefined;
	private _version: `${number}.${number}.${number}`;

	constructor(
		private readonly storage: Storage,
		version: string,
	) {
		this._version = fromVersion(fromString(version), false);
		this._disposable = Disposable.from(
			this.storage.onDidChange(this.onStorageChanged, this),
			registerCommand('gitlens.onboarding.dismiss', args => this.dismiss(args.id)),
		);

		void this.migrateLegacyState();
	}

	dispose(): void {
		this._onDidChange.dispose();
		this._disposable.dispose();
	}

	private onStorageChanged(e: StorageChangeEvent): void {
		if (e.keys.includes('onboarding:state')) {
			const previousState = e.workspace ? this._workspaceOnboarding : this._globalOnboarding;

			// Invalidate the appropriate cache when storage changes externally
			if (e.workspace) {
				this._workspaceOnboarding = undefined;
			} else {
				this._globalOnboarding = undefined;
			}

			if (previousState != null) {
				const currentState = this.getOnboarding(e.workspace ? 'workspace' : 'global');

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
	}

	/**
	 * Checks if an onboarding item is dismissed
	 * Respects `reshowAfter` - if the user dismissed before that version, returns false
	 */
	isDismissed(key: OnboardingKeys): boolean {
		const item = this.getItem(key);
		if (!item?.dismissedAt) return false;

		// If reshowAfter is set and user dismissed before that version, re-show
		const { reshowAfter } = onboardingDefinitions[key] as { reshowAfter?: `${number}.${number}.${number}` };
		if (reshowAfter && item.dismissedVersion) {
			if (satisfies(item.dismissedVersion, `< ${reshowAfter}`)) {
				return false;
			}
		}

		return true;
	}

	/** Dismiss an onboarding item, recording the current timestamp and GitLens version */
	async dismiss(key: OnboardingKeys): Promise<void> {
		const { scope } = onboardingDefinitions[key];

		const onboarding = this.getOnboarding(scope);
		const existing = onboarding.items[key];

		onboarding.items[key] = {
			...existing,
			dismissedAt: new Date().toISOString(),
			dismissedVersion: fromVersion(fromString(this._version), false),
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
		this._globalOnboarding = { items: {} };
		this._workspaceOnboarding = { items: {} };
		await this.storage.store('onboarding:state', undefined);
		await this.storage.storeWorkspace('onboarding:state', undefined);
	}

	private async migrateLegacyState(): Promise<void> {
		const state = this.getOnboarding('global');
		if (state.migrated) return;

		const migrations = [
			{ legacy: 'views:scm:grouped:welcome:dismissed', current: 'views:scmGrouped:welcome' },
			{ legacy: 'mcp:banner:dismissed', current: 'mcp:banner' },
			{ legacy: 'home:walkthrough:dismissed', current: 'home:walkthrough' },
		] as const;

		let changed = false;
		for (const { legacy, current } of migrations) {
			const wasDismissed = this.storage.get(legacy as any);
			if (wasDismissed) {
				if (!this.isDismissed(current)) {
					await this.dismiss(current);
				}
				await this.storage.delete(legacy as any);
				changed = true;
			}
		}

		if (changed || !state.migrated) {
			state.migrated = true;
			await this.saveOnboarding('global', state);
		}
	}

	private async setItemStateCore<T extends OnboardingKeys>(
		key: T,
		state: OnboardingItemState<T>,
		scope: 'global' | 'workspace',
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

	private getOnboarding(scope: 'global' | 'workspace'): OnboardingStorage {
		if (scope === 'workspace') {
			this._workspaceOnboarding ??= this.storage.getWorkspace('onboarding:state') ?? { items: {} };
			return this._workspaceOnboarding;
		}
		this._globalOnboarding ??= this.storage.get('onboarding:state') ?? { items: {} };
		return this._globalOnboarding;
	}

	private async saveOnboarding(scope: 'global' | 'workspace', onboarding: OnboardingStorage): Promise<void> {
		if (scope === 'workspace') {
			this._workspaceOnboarding = onboarding;
			await this.storage.storeWorkspace('onboarding:state', onboarding);
		} else {
			this._globalOnboarding = onboarding;
			await this.storage.store('onboarding:state', onboarding);
		}
	}
}
