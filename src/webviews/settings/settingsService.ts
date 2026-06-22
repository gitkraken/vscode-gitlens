/**
 * RPC Service interface for the Settings webview.
 *
 * Architecture (mirrors Commit Details):
 * - Backend is stateless — it reads/writes VS Code configuration and forwards events
 * - Webview owns all UI state (selected category, search query, etc.)
 * - Webview fetches the config snapshot via RPC and re-fetches nothing — fresh
 *   snapshots are pushed through `onConfigChanged` (save-last buffered)
 *
 * Service Layout:
 * - SharedWebviewServices: repositories, config, storage, subscription, integrations, ai, ...
 *   (the shared subscription/integrations/ai services also drive the Cloud
 *   Integrations & AI panels and the Autolinks integration banner)
 * - settings: view-specific sub-service — config snapshot/updates (scope-aware),
 *   format-string previews, deep-link anchors
 */
import type { Config } from '../../config.js';
import type { ConfigPath, ConfigPathValue } from '../../system/-webview/configuration.js';
import type { CustomConfigPath, CustomConfigPathValue } from '../protocol.js';
import type { SharedWebviewServices } from '../rpc/services/common.js';
import type { Unsubscribe } from '../rpc/services/types.js';

// ============================================================
// Event Types (used by subscription callbacks)
// ============================================================

/** A deep-link anchor was requested on an already-live webview (e.g. `gitlens.showSettingsPage!commit-graph`). */
export interface AnchorRequestedEvent {
	anchor: string;
}

// ============================================================
// Data Types
// ============================================================

/** A configuration scope the user can save into. */
export type SettingsScope = ['user' | 'workspace', string];

/**
 * The current effective configuration, pushed on every change.
 *
 * `config` is the raw configuration (without mode overrides mixed in).
 * `customSettings` are virtual boolean settings computed host-side
 * (e.g. `rebaseEditor.enabled` backed by `workbench.editorAssociations`).
 */
export interface SettingsConfigSnapshot {
	config: Config;
	customSettings: Record<string, boolean>;
}

/** Everything the webview needs to render initially. */
export interface SettingsInitialContext extends SettingsConfigSnapshot {
	version: string;
	scopes: SettingsScope[];
	/** Pending deep-link anchor captured before the webview was ready; consumed on read. */
	anchor?: string;
}

export interface SettingsUpdateParams {
	/**
	 * Setting values to write. `null` is a real value (it clears a format override, for
	 * example); values equal to the default are converted to a removal at user scope.
	 */
	changes: {
		[key in ConfigPath | CustomConfigPath]?: ConfigPathValue<ConfigPath> | CustomConfigPathValue<CustomConfigPath>;
	};
	/** Setting keys whose overrides should be removed at the given scope. */
	removes: (ConfigPath | CustomConfigPath)[];
	scope: 'user' | 'workspace';
}

export interface GenerateFormatPreviewParams {
	/** The setting key the preview is for (drives pull-request token inclusion). */
	key: string;
	type: 'commit' | 'commit-uncommitted';
	format: string;
}

// ============================================================
// View-Specific Sub-Service: Settings
// ============================================================

export interface SettingsViewService {
	// ── Events ──

	/** Fired when a deep-link anchor is requested on an already-live webview. */
	onAnchorRequested(callback: (event: AnchorRequestedEvent) => void): Unsubscribe;

	/**
	 * Fired with a fresh snapshot when any GitLens setting (or a custom setting's
	 * backing key) changes — including external `settings.json` edits.
	 */
	onConfigChanged(callback: (event: SettingsConfigSnapshot) => void): Unsubscribe;

	// ── Initialization ──

	getInitialContext(): Promise<SettingsInitialContext>;

	// ── Mutations ──

	/** Apply configuration changes at the given scope, with default-stripping semantics. */
	update(params: SettingsUpdateParams): Promise<void>;

	// ── Queries ──

	/**
	 * Render a format template against the canned sample commit using the real
	 * `CommitFormatter`, so the preview matches what GitLens will actually display.
	 * Returns 'Invalid format' when the template fails to parse.
	 */
	generateFormatPreview(params: GenerateFormatPreviewParams): Promise<string>;
}

// ============================================================
// Combined Services Interface
// ============================================================

/** RPC services for the Settings webview. */
export interface SettingsServices extends SharedWebviewServices {
	readonly settings: SettingsViewService;
}
