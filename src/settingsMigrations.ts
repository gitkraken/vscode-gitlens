import { ConfigurationTarget } from 'vscode';
import type { TrackedUsage, TrackedUsageKeys } from './constants.telemetry.js';
import { configuration } from './system/-webview/configuration.js';
import type { Storage } from './system/-webview/storage.js';

export type SettingsMigration = {
	/** Stable identifier, tracked in the `settings:migrated` storage key */
	id: string;
	/** What the migration does — shown in the `Reset Stored Data → Migrations` picker */
	description: string;
	/** Live state worth surfacing in the picker (e.g. a still-armed deferred step) */
	status?: (storage: Storage) => string | undefined;
	migrate: (storage: Storage) => Promise<void>;
};

// One-time settings migrations, each identified by a stable `id` and applied at most once per
// install (tracked by id in the `settings:migrated` storage key). Append new entries — no
// per-migration storage key, and no reliance on the install version (which spans two schemes:
// stable `18.x` and date-based pre-release). Migrations MUST be idempotent (a fresh install runs
// them as no-ops).
export const settingsMigrations: SettingsMigration[] = [
	{
		// Move existing explicit `right`/`bottom` Commit Graph details locations onto the new
		// width-aware `auto` default. Window-scoped, so only user/workspace can hold a value.
		id: 'graph.details.location:auto',
		description: 'Moved explicit right/bottom Commit Graph details locations onto the width-aware auto default',
		migrate: async () => {
			const inspect = configuration.inspect('graph.details.location');
			const isPinned = (v: unknown) => v === 'right' || v === 'bottom';
			if (isPinned(inspect?.globalValue)) {
				await configuration.update('graph.details.location', 'auto', ConfigurationTarget.Global);
			}
			if (isPinned(inspect?.workspaceValue)) {
				await configuration.update('graph.details.location', 'auto', ConfigurationTarget.Workspace);
			}
		},
	},
	{
		// Replace the boolean `terminalLinks.showDetailsView` with the `terminalLinks.showIn` enum.
		// Old default (`true` = show the Inspect view) maps to `inspect`; `false` maps to `quickpick`.
		// Unset users fall through to the new `graph` default.
		id: 'terminalLinks.showIn:enum',
		description:
			"Replaced the boolean 'terminalLinks.showDetailsView' setting with the 'terminalLinks.showIn' enum",
		migrate: async () => {
			await configuration.migrate('terminalLinks.showDetailsView', 'terminalLinks.showIn', {
				migrationFn: (v: unknown) => (v === false ? 'quickpick' : 'inspect'),
			});
		},
	},
	{
		// Unpin installs that a passive AI-model resolve silently wrote to Copilot: resolving the fallback
		// used to persist its result, so merely rendering an AI chip could write `ai.model`, after which
		// signing in never re-evaluated. Such a write only ever landed in User settings, so only Global is
		// inspected. Either tell on its own is enough to call it passive:
		//  - the model is `copilot:gpt-4.1`, the passive fallback's hardcoded pick and the only Copilot id
		//    GitLens has ever hardcoded. Copilot no longer serves it, so the setting is already inert —
		//    it resolves to nothing and falls through to the fallback regardless.
		//  - the AI picker was never opened on this machine, so no Copilot model here was ever chosen.
		//    This covers the fallback's `?? models[0]` branch, which could have stored any id.
		// A Copilot model other than gpt-4.1 on a machine where the picker HAS been opened is a real
		// choice, and is left alone. Clearing lets the fallback re-evaluate: GitKraken AI once signed in.
		id: 'ai.model:unpin-passive-copilot',
		description: 'Cleared AI model pins that a passive fallback resolve had silently written to Copilot',
		migrate: async (storage: Storage) => {
			if (configuration.inspect('ai.model')?.globalValue !== 'vscode') return;

			const isPassiveModel = configuration.inspect('ai.vscode.model')?.globalValue === 'copilot:gpt-4.1';
			// `UsageTracker` is only a typed view over this key, and the Container doesn't exist yet here
			const usages: Partial<Record<TrackedUsageKeys, TrackedUsage>> = storage.get('usages') ?? {};
			const pickerOpened = (
				['gitlens.ai.switchProvider', 'gitlens.ai.switchProvider:scm', 'gitlens.switchAIModel'] as const
			).some(c => usages[`command:${c}:executed`] != null);

			if (!isPassiveModel && pickerOpened) return;

			await configuration.update('ai.model', undefined, ConfigurationTarget.Global);
			await configuration.update('ai.vscode.model', undefined, ConfigurationTarget.Global);
		},
	},
	{
		// Home, Cloud Patches and Cloud Workspaces are hidden by default since #5545, but the manifest's
		// `visibility: "hidden"` only applies where VS Code has no stored state — and it records
		// `isHidden: false` for every view a profile has ever loaded, without any user action. So the
		// declaration alone hides nothing for the installed base; hide them once here. One-shot: a user
		// who re-shows a view afterwards keeps it. (Distinct from the Graph-location migration the
		// Aug 3 standup removed — that directive was about placement, and this task's "hide by default"
		// decision explicitly targets existing users.)
		id: 'views.legacy:hidden',
		description: 'Hid the Home, Cloud Patches & Cloud Workspaces views for upgraded profiles',
		status: storage =>
			storage.get('views:pendingLegacyHide') ? 'armed — the hide itself runs on the next reload' : undefined,
		migrate: async (storage: Storage) => {
			// LOCAL versions only — a deliberate trade-off. A synced-only version is a fresh machine;
			// its Settings Sync snapshot MAY carry `isHidden: false` view state from a pre-19.0 machine
			// (view visibility syncs), which this gate then misses — but that heals itself once any of
			// the user's machines upgrades and re-syncs the hidden state. Arming on synced versions
			// instead would race the new-install reveal in `Views` with this consumer's container
			// toggle (a close/reopen flicker) on EVERY fresh synced machine, healing never.
			if ((storage.get('version') ?? storage.get('preVersion')) == null) return;

			// Arm only — the per-view hide commands aren't registered yet this early in startup
			// (verified: running them here is a silent no-op); `applyPendingLegacyViewHiding` consumes
			// this once the container is ready
			await storage.store('views:pendingLegacyHide', true);
		},
	},
];
