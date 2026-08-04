import type { Remote } from '@eamodio/supertalk';
import type { AutolinkConfig, Config, CustomRemoteType, RemotesUrlsConfig } from '../../../config.js';
import { isCustomConfigKey } from '../../protocol.js';
import type { ScopedAiModelInfo } from '../../rpc/services/types.js';
import type { SettingsServices, SettingsUpdateParams } from '../../settings/settingsService.js';
import { anchorToCategory } from './categories/index.js';
import type { CheckDescriptor, SettingsKey } from './model.js';
import { setPath } from './model.js';
import type { SettingsState } from './state.js';

/** Resolved settings sub-service type (after awaiting the sub-service property from the Remote proxy). */
export type ResolvedSettingsService = Awaited<Remote<SettingsServices>['settings']>;

/**
 * Loose editor shape for one `gitlens.remotes` entry.
 *
 * Deliberately NOT the strict `RemotesConfig` union: that union requires BOTH
 * `domain` and `regex` to be present with one set to `null`, but the package.json
 * schema declares each as `type: string` and its `oneOf` treats a present-`null`
 * matcher as satisfying the other branch's `required` — so writing the inactive
 * matcher as `null` produces a settings.json that squiggles ("matches multiple
 * schemas") on hand-edit. The editor therefore OMITS the inactive matcher field
 * entirely; the `apply()` write path casts this loose shape onto `config.remotes`.
 */
export type RemoteRuleDraft = {
	type: CustomRemoteType;
	domain?: string;
	regex?: string;
	name?: string;
	protocol?: string;
	ignoreSSLErrors?: boolean | 'force';
	urls?: RemotesUrlsConfig;
};

/**
 * Unifies user interactions with config writes for the Settings webview.
 *
 * Mirrors the legacy apply model exactly: every interaction applies
 * immediately (text inputs on blur/commit, not per keystroke); `undefined`
 * values are conveyed as removals; whole arrays/objects are rewritten for
 * nested membership changes.
 */
export class SettingsActions {
	constructor(
		private readonly state: SettingsState,
		private readonly services: Remote<SettingsServices>,
		private readonly settings: ResolvedSettingsService,
	) {}

	dispose(): void {}

	private _anchorNonce = 0;
	private _servicesLoadGeneration = 0;

	// ── Navigation ──

	selectCategory(id: string): void {
		this.state.selectedCategoryId.set(id);
		// Navigating away retires any deep-link highlight
		this.state.anchorKey.set(undefined);
	}

	/** Handles a deep-link anchor (category ids, legacy section ids, or setting keys) from the host. */
	openAnchor(anchor: string): void {
		const target = anchorToCategory(anchor);
		if (target == null) return;

		this.selectCategory(target.id);
		if (target.key != null) {
			// The nonce distinguishes repeat requests for the same anchor so the
			// detail pane re-scrolls to the control each time
			this.state.anchorKey.set({ key: target.key, nonce: ++this._anchorNonce });
		}
	}

	setScope(scope: 'user' | 'workspace'): void {
		this.state.scope.set(scope);
	}

	setQuery(query: string): void {
		this.state.query.set(query);
		// Searching takes over highlighting from any deep-link anchor
		this.state.anchorKey.set(undefined);
		// Keep the detail pane in sync with the filtered rail: when the active
		// category is filtered out of the results, move selection to the first
		// match so the pane never shows a category the rail has hidden.
		if (query) {
			const matches = this.state.searchResults.get();
			if (matches.length && !matches.some(m => m.category.id === this.state.selectedCategoryId.get())) {
				this.state.selectedCategoryId.set(matches[0].category.id);
			}
		}
	}

	// ── Shared services (subscription/integrations/AI) ──

	/**
	 * Populates the shared-service signals progressively — the panels show
	 * skeletons until each resolves, and an error state that retries via this
	 * method if a fetch fails. None of these gate the app's `loading`.
	 */
	async loadSharedServices(): Promise<void> {
		const s = this.state;
		// A superseded attempt's late failure must not flip an in-flight retry
		// back to the error state
		const generation = ++this._servicesLoadGeneration;
		s.serviceErrors.set({ subscription: false, integrations: false, ai: false, agents: false });

		// A superseded attempt's late resolution must touch neither the error flags
		// nor the data signals, or it could overwrite fresher data from the retry
		const current = () => generation === this._servicesLoadGeneration;

		const failed = (...services: ('subscription' | 'integrations' | 'ai' | 'agents')[]) => {
			if (!current()) return;

			const errors = { ...s.serviceErrors.get() };
			for (const service of services) {
				errors[service] = true;
			}
			s.serviceErrors.set(errors);
		};

		let subscription;
		let integrations;
		let ai;
		let agents;
		try {
			// Resolving the sub-service handles is itself an RPC round-trip that
			// can reject — without this, a retry could silently skeleton forever
			[subscription, integrations, ai, agents] = await Promise.all([
				this.services.subscription,
				this.services.integrations,
				this.services.ai,
				this.services.agents,
			]);
		} catch {
			failed('subscription', 'integrations', 'ai', 'agents');
			return;
		}

		void subscription.getSubscription().then(
			sub => {
				if (current()) {
					s.subscription.set(sub);
				}
			},
			() => failed('subscription'),
		);
		void integrations.getIntegrationStates().then(
			states => {
				if (current()) {
					s.cloudIntegrations.set(states);
				}
			},
			() => failed('integrations'),
		);
		void ai.getModel().then(
			model => {
				if (current()) {
					s.aiModel.set(model);
				}
			},
			() => failed('ai'),
		);
		void ai.getState().then(
			state => {
				if (current()) {
					s.aiState.set(state);
				}
			},
			() => failed('ai'),
		);

		// Walkthrough progress feeds the Get Started launchpad's two walkthrough steps. It's
		// non-critical — a failure just leaves those steps reading "Not started", never an error.
		void this.services.walkthrough
			.then(walkthrough => walkthrough.getProgress())
			.then(progress => {
				if (current() && progress != null) {
					s.walkthrough.set(progress);
				}
			})
			.catch(() => {});

		void agents.getAgents().then(
			list => {
				if (current()) {
					s.agents.set(list);
				}
			},
			() => failed('agents'),
		);
		void ai.getScopedModels().then(
			scopedModels => {
				if (current()) {
					s.scopedAiModels.set(scopedModels);
				}
			},
			() => failed('ai'),
		);
	}

	/**
	 * Re-reads the current model and the compose/review/resolve scope overrides together.
	 * Called after `switchAiModel`/`resetAiModel` land, and by the `ai.onModelChanged` push
	 * (which fires for scope-only changes too, always with the global model as its payload —
	 * so any fire means "re-read the scoped models", not just the global one).
	 *
	 * Never rejects: every call site fires this off with `void` (the event push, the row
	 * buttons), so an escaping rejection would land as an unhandled rejection instead of
	 * anything the user can act on. A failure flags the AI service — the same signal
	 * `loadSharedServices` uses — and leaves the last-known values on screen; a later
	 * success clears the flag so a transient failure doesn't strand the error text.
	 */
	async refreshAiModels(): Promise<void> {
		try {
			const ai = await this.services.ai;
			const [model, scopedModels] = await Promise.all([ai.getModel(), ai.getScopedModels()]);
			this.state.aiModel.set(model);
			this.state.scopedAiModels.set(scopedModels);
			this.setAiServiceError(false);
		} catch {
			this.setAiServiceError(true);
		}
	}

	/** Flags (or clears) the AI shared-service error without disturbing its siblings. */
	private setAiServiceError(failed: boolean): void {
		const errors = this.state.serviceErrors.get();
		if (errors.ai === failed) return;

		this.state.serviceErrors.set({ ...errors, ai: failed });
	}

	/**
	 * Switches the AI provider/model for `scope` (or the global default when omitted) via
	 * VS Code's native picker, then re-reads the resolved models directly. The picker command
	 * resolves only after the selection is persisted, so the `ai.onModelChanged` event would
	 * race this read if relied on alone — see `switchAIModel` in
	 * `src/webviews/apps/plus/graph/components/detailsActions.ts` for the same hazard on the
	 * graph details side. The explicit re-read below must stay, even though `onModelChanged`
	 * also triggers a `refreshAiModels()` call (via `settings.ts`).
	 */
	async switchAiModel(scope?: ScopedAiModelInfo['scope']): Promise<void> {
		try {
			const commands = await this.services.commands;
			await commands.execute('gitlens.ai.switchProvider', {
				source: 'settings',
				detail: scope ?? 'default',
				scope: scope,
			});
		} catch {
			// The picker owns its own error surfacing; a dispatch failure leaves the selection
			// untouched, so there's nothing to re-read and nothing to add on top of it
			return;
		}

		await this.refreshAiModels();
	}

	/** Clears a scope's stored override, reverting it to the resolved default. */
	async resetAiModel(scope: ScopedAiModelInfo['scope']): Promise<void> {
		try {
			const ai = await this.services.ai;
			await ai.clearScopedModel(scope);
		} catch {
			this.setAiServiceError(true);
			return;
		}

		await this.refreshAiModels();
	}

	// ── Config writes ──

	/**
	 * Applies a set of changes at the current scope. Entries with an
	 * `undefined` value are sent as removals (mirrors the legacy
	 * `UpdateConfigurationCommand` semantics). Resolves `true` when the write
	 * lands and `false` when it fails (rolled back) — so callers that promote
	 * local state on a confirmed write can await the outcome.
	 */
	async apply(changes: Record<string, unknown>): Promise<boolean> {
		// Descriptor keys are typed SettingsKey at authoring time; the runtime maps are
		// string-keyed, so re-assert the params shape once at the RPC boundary
		const writes: SettingsUpdateParams['changes'] = {};
		const removes: SettingsUpdateParams['removes'] = [];

		for (const [key, value] of Object.entries(changes) as [SettingsKey, unknown][]) {
			if (value === undefined) {
				removes.push(key);
			} else {
				writes[key] = value as SettingsUpdateParams['changes'][SettingsKey];
			}
		}

		// Reflect the change locally before the write round-trips. The host echo
		// (`onConfigChanged`) lags each write, so without this a second edit to the
		// same composite setting (the `menus` object, a checkgroup array, autolinks)
		// would recompute from the pre-edit snapshot and clobber the first — the
		// legacy app sidestepped this by mutating its config in place. The echo
		// reconciles to authoritative values; a failed write rolls back.
		const previousConfig = this.state.config.get();
		const previousCustomSettings = this.state.customSettings.get();
		this.applyOptimistic(changes);

		try {
			await this.settings.update({ changes: writes, removes: removes, scope: this.state.scope.get() });
			return true;
		} catch (ex) {
			// The failed write never echoes, so restore the pre-edit values
			this.state.config.set(previousConfig);
			this.state.customSettings.set(previousCustomSettings);
			this.state.error.set(ex instanceof Error ? ex.message : String(ex));
			return false;
		}
	}

	/**
	 * Mirrors a set of changes onto the local config/customSettings signals so
	 * apply-on-interaction reflects immediately and successive edits to the same
	 * composite setting accumulate instead of racing the host echo. Custom keys
	 * live in `customSettings`; everything else is a (dot-delimited) path within
	 * the raw config. An `undefined` value clears the path — the host strips it to
	 * the default, which the authoritative echo then restores.
	 */
	private applyOptimistic(changes: Record<string, unknown>): void {
		const config = this.state.config.get();

		let draftConfig: Config | undefined;
		let draftCustomSettings: Record<string, boolean> | undefined;

		for (const [key, value] of Object.entries(changes)) {
			if (isCustomConfigKey(key)) {
				if (typeof value === 'boolean') {
					draftCustomSettings ??= { ...this.state.customSettings.get() };
					draftCustomSettings[key] = value;
				}
				continue;
			}

			if (config == null) continue;

			// Clone once, then layer every config change onto the same draft
			draftConfig ??= structuredClone(config);
			setPath(draftConfig, key, value);
		}

		if (draftConfig != null) {
			this.state.config.set(draftConfig);
		}
		if (draftCustomSettings != null) {
			this.state.customSettings.set(draftCustomSettings);
		}
	}

	/** Applies a checkbox/switch change, including object/array/custom semantics and additional settings. */
	async applyCheck(descriptor: CheckDescriptor, checked: boolean): Promise<boolean> {
		const changes: Record<string, unknown> = {};
		const valueOn = descriptor.valueOn !== undefined ? descriptor.valueOn : true;

		switch (descriptor.type) {
			case 'custom':
				changes[descriptor.key] = checked;
				break;

			case 'object': {
				// Clone so we don't mutate the live config object in place (parity with the autolinks paths)
				const object: Record<string, unknown> = structuredClone(
					this.state.getSettingValue<Record<string, unknown>>(descriptor.key) ?? {},
				);
				setPath(
					object,
					descriptor.path ?? '',
					checked ? (descriptor.checkedRemoves ? undefined : valueOn) : false,
				);
				changes[descriptor.key] = object;
				break;
			}

			case 'array':
				changes[descriptor.key] = toggleArrayMember(
					this.state.getSettingValue<string[]>(descriptor.key) ?? [],
					descriptor.value ?? '',
					checked,
				);
				break;

			default:
				changes[descriptor.key] = checked
					? descriptor.checkedRemoves
						? undefined
						: valueOn
					: descriptor.valueOff !== undefined
						? descriptor.valueOff
						: false;
				break;
		}

		const additional = checked ? descriptor.addSettingsOn : descriptor.addSettingsOff;
		if (additional != null) {
			for (const [key, value] of additional) {
				changes[key] = value;
			}
		}

		return this.apply(changes);
	}

	/** Applies a select/segmented change with legacy boolean/null coercion. */
	applyOption(key: SettingsKey, value: string): Promise<boolean> {
		return this.apply({ [key]: ensureIfBooleanOrNull(value) });
	}

	/** Applies a text input commit; an empty value falls back to `defaultValue`, else `null`. */
	applyText(key: SettingsKey, value: string, defaultValue?: string): Promise<boolean> {
		return this.apply({ [key]: value ? value : (defaultValue ?? null) });
	}

	/** Applies a numeric input commit. */
	applyNumber(key: SettingsKey, value: string, defaultValue?: string): Promise<boolean> {
		return this.apply({ [key]: value ? Number(value) : defaultValue != null ? Number(defaultValue) : null });
	}

	applyValue(key: SettingsKey, value: unknown): Promise<boolean> {
		return this.apply({ [key]: value });
	}

	/** Toggles membership of `value` in the string-array setting `key`. */
	applyArrayMember(key: SettingsKey, value: string, include: boolean): Promise<boolean> {
		return this.apply({
			[key]: toggleArrayMember(this.state.getSettingValue<string[]>(key) ?? [], value, include),
		});
	}

	// ── Autolinks ──

	/** Writes one property of an autolink rule; writes the whole array (or removes the key when empty). */
	async applyAutolinkChange(
		index: number,
		prop: keyof AutolinkConfig,
		value: string | boolean | null,
	): Promise<boolean> {
		const autolinks: AutolinkConfig[] = structuredClone(
			this.state.getSettingValue<AutolinkConfig[]>('autolinks') ?? [],
		);

		if (value == null || value === '') {
			// Clearing a prop on a not-yet-real rule shouldn't create one
			if (autolinks[index] == null) return false;
		}

		const current: AutolinkConfig = autolinks[index] ?? {
			prefix: '',
			url: '',
			alphanumeric: false,
			ignoreCase: false,
			title: null,
		};
		autolinks[index] = { ...current, [prop]: value };

		return this.apply({ autolinks: autolinks.length ? autolinks : undefined });
	}

	/**
	 * Writes a whole autolink rule at `index` — draft rows commit their full
	 * draft each time so a second field's commit can't clobber the first while
	 * its config echo is still in flight.
	 */
	async applyAutolinkRule(index: number, rule: AutolinkConfig): Promise<boolean> {
		const autolinks: AutolinkConfig[] = structuredClone(
			this.state.getSettingValue<AutolinkConfig[]>('autolinks') ?? [],
		);
		// A stale index past the array end (e.g. after an external `settings.json`
		// edit shrank it) would silently append/overwrite the wrong rule — refuse it.
		// `=== length` legitimately appends a new row; `< length` replaces in place.
		if (index > autolinks.length) return false;

		autolinks[index] = { ...rule };
		return this.apply({ autolinks: autolinks });
	}

	async removeAutolink(index: number): Promise<boolean> {
		const autolinks: AutolinkConfig[] = structuredClone(
			this.state.getSettingValue<AutolinkConfig[]>('autolinks') ?? [],
		);
		autolinks.splice(index, 1);
		return this.apply({ autolinks: autolinks.length ? autolinks : undefined });
	}

	// ── Custom remotes ──

	/**
	 * Writes a whole remote entry at `index` — the editor commits the full entry
	 * each time (never a single property) so a matcher-mode/type switch can't leave
	 * a stale `domain`/`regex` alongside the new one while its config echo is still
	 * in flight. Untouched entries keep their original (hand-authored) shape; only
	 * the rewritten entry is emitted through the omit-inactive-matcher projection.
	 */
	async applyRemoteRule(index: number, rule: RemoteRuleDraft): Promise<boolean> {
		const remotes: RemoteRuleDraft[] = structuredClone(
			this.state.getSettingValue<RemoteRuleDraft[]>('remotes') ?? [],
		);
		// A stale index past the array end (e.g. after an external `settings.json`
		// edit shrank it) would silently append/overwrite the wrong entry — refuse it.
		// `=== length` legitimately appends a new row; `< length` replaces in place.
		if (index > remotes.length) return false;

		remotes[index] = { ...rule };
		return this.apply({ remotes: remotes });
	}

	async removeRemote(index: number): Promise<boolean> {
		const remotes: RemoteRuleDraft[] = structuredClone(
			this.state.getSettingValue<RemoteRuleDraft[]>('remotes') ?? [],
		);
		remotes.splice(index, 1);
		return this.apply({ remotes: remotes.length ? remotes : undefined });
	}

	// ── Previews ──

	/** Renders a format template via the host's real `CommitFormatter`/`StatusFileFormatter`. */
	generateFormatPreview(
		key: string,
		type: 'commit' | 'commit-uncommitted' | 'file',
		format: string,
		markdown?: boolean,
	): Promise<string> {
		return this.settings.generateFormatPreview({ key: key, type: type, format: format, markdown: markdown });
	}
}

/** Legacy select-value coercion: 'true'/'false' → boolean, 'null' → null, else the string. */
export function ensureIfBooleanOrNull(value: string): string | boolean | null {
	if (value === 'true') return true;
	if (value === 'false') return false;
	if (value === 'null') return null;
	return value;
}

/** Returns a new array with `value` added (if absent) or removed (if present). */
function toggleArrayMember(array: readonly string[], value: string, include: boolean): string[] {
	const result = [...array];
	const index = result.indexOf(value);
	if (include) {
		if (index === -1) {
			result.push(value);
		}
	} else if (index !== -1) {
		result.splice(index, 1);
	}
	return result;
}
