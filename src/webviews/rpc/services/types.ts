/**
 * Shared types that cross the RPC boundary.
 *
 * These are serializable data shapes used by multiple service interfaces.
 * Keep this file to pure type definitions — no runtime code.
 */

import type { Source, TelemetryEventData, TelemetryEvents } from '../../../constants.telemetry.js';
import type { GitTrackingUpstream } from '../../../git/models/branch.js';
import type { GitFileChangeShape, GitFileChangeStats } from '../../../git/models/fileChange.js';
import type { RepositoryChange } from '../../../git/models/repository.js';

// ============================================================
// Serialized Types
// ============================================================

/**
 * Serialized repository info for RPC.
 */
export interface SerializedRepository {
	readonly id: string;
	readonly name: string;
	readonly path: string;
	readonly uri: string;
	readonly closed: boolean;
	readonly starred: boolean;
}

/**
 * Serialized commit reference for RPC.
 */
export interface SerializedCommitRef {
	readonly repoPath: string;
	readonly sha: string;
	readonly message?: string;
}

/**
 * Repository change event data.
 *
 * `changes` contains numeric values matching the `RepositoryChange` const enum.
 * Use the `repositoryChange` constants below for comparisons in webview code
 * (which can't import the enum from `repository.ts` without pulling in `vscode`).
 */
export interface RepositoryChangeEventData {
	readonly repoPath: string;
	readonly repoUri: string;
	readonly changes: RepositoryChange[];
}

/**
 * Commit selected event data (from EventBus).
 */
export interface CommitSelectedEventData {
	readonly repoPath: string;
	readonly sha: string;
	readonly interaction: 'active' | 'passive';
	readonly preserveFocus?: boolean;
}

/**
 * Organization settings relevant to webviews.
 */
export interface OrgSettings {
	readonly ai: boolean;
	readonly drafts: boolean;
}

/**
 * Aggregate repositories state for webviews.
 */
export interface RepositoriesState {
	readonly count: number;
	readonly openCount: number;
	readonly hasUnsafe: boolean;
	readonly trusted: boolean;
}

/**
 * Integration state info for RPC.
 * A simplified, serializable shape for cloud integration descriptors.
 */
export interface IntegrationStateInfo {
	readonly id: string;
	readonly name: string;
	readonly icon: string;
	readonly connected: boolean;
	readonly supports: string[];
	readonly requiresPro: boolean;
}

/**
 * Enriched integration change event data.
 * Fires with full integration state, not just a boolean.
 */
export interface IntegrationChangeEventData {
	readonly hasAnyConnected: boolean;
	readonly integrations: IntegrationStateInfo[];
}

/**
 * Serializable AI model info.
 * A simplified shape that crosses the RPC boundary safely.
 */
export interface AiModelInfo {
	readonly id: string;
	readonly name: string;
	readonly provider: { readonly id: string; readonly name: string };
}

/**
 * AI and MCP state for webview integrations UI.
 *
 * Consolidates AI enablement (setting + org) and MCP installation state
 * into a single object. MCP is nested under AI because MCP requires AI
 * to be enabled.
 */
export interface AIState {
	/** Whether AI is enabled via settings (`ai.enabled`). */
	readonly enabled: boolean;
	/** Whether AI is enabled by the organization. */
	readonly orgEnabled: boolean;
	/** MCP state, nested under AI since MCP requires AI to be enabled. */
	readonly mcp: {
		readonly bundled: boolean;
		readonly settingEnabled: boolean;
		readonly installed: boolean;
	};
}

// ============================================================
// Git Model DTOs (serialized shapes for base RPC methods)
// ============================================================

/**
 * Serialized identity — Date becomes a timestamp over RPC.
 */
export interface SerializedGitIdentity {
	readonly name: string;
	readonly email: string | undefined;
	readonly date: number;
}

/**
 * Serialized commit for base RPC methods.
 *
 * View-specific services (e.g. CommitDetailsGitService) override the
 * base method with their own return type; this DTO types the default
 * implementation so the base class is not `unknown`.
 */
export interface SerializedGitCommit {
	readonly sha: string;
	readonly shortSha: string;
	readonly repoPath: string;
	readonly author: SerializedGitIdentity;
	readonly committer: SerializedGitIdentity;
	readonly parents: string[];
	readonly message: string | undefined;
	readonly summary: string;
	readonly stashNumber: string | undefined;
	readonly refType: 'revision' | 'stash';
}

/**
 * Serialized branch for base RPC methods.
 */
export interface SerializedGitBranch {
	readonly repoPath: string;
	readonly id: string;
	readonly name: string;
	readonly refName: string;
	readonly remote: boolean;
	readonly current: boolean;
	readonly date: number | undefined;
	readonly sha: string | undefined;
	readonly upstream: GitTrackingUpstream | undefined;
	readonly detached: boolean;
	readonly rebasing: boolean;
	readonly worktree: { readonly path: string; readonly isDefault: boolean } | false | undefined;
}

/**
 * Serialized file change — extends `GitFileChangeShape` with extra
 * data properties available on `GitFileChange` instances.
 */
export interface SerializedGitFileChange extends GitFileChangeShape {
	readonly previousSha?: string;
	readonly stats?: GitFileChangeStats;
}

// ============================================================
// Service Host Types
// ============================================================

/**
 * Minimal host interface for RPC services.
 *
 * Services only need a subset of `WebviewHost` — this avoids `WebviewHost<any>`
 * leaking through the RPC service layer.
 */
export interface RpcServiceHost {
	readonly id: string;
	readonly instanceId: string;
	sendTelemetryEvent(name: keyof TelemetryEvents, data?: TelemetryEventData, source?: Source): void;
}

// ============================================================
// RPC Result Types
// ============================================================

/**
 * Discriminated result type for RPC operations where error semantics matter.
 *
 * Use this instead of throwing when the webview needs to distinguish error
 * reasons. Supertalk only propagates error `message` across the boundary,
 * losing the `.is()` type guard pattern. Result types preserve discriminators.
 *
 * @example
 * ```typescript
 * // Service interface
 * explainCommit(sha: string): Promise<RpcResult<{ summary: string }, 'noAI' | 'rateLimited'>>;
 *
 * // Host implementation
 * return { value: { summary: '...' } };
 * return { error: { message: 'Rate limited', reason: 'rateLimited' } };
 *
 * // Webview consumer
 * const result = await services.explainCommit(sha);
 * if ('error' in result) {
 *   if (result.error.reason === 'rateLimited') { ... }
 * }
 * ```
 */
export type RpcResult<T, TReason extends string = string> =
	| { value: T; error?: never }
	| { error: { message: string; reason?: TReason }; value?: never };

// ============================================================
// Event Subscription Types
// ============================================================

/**
 * Unsubscribe function returned by event subscriptions.
 */
export type Unsubscribe = () => void;

/**
 * Event subscription function signature.
 * Returns an unsubscribe function.
 */
export type EventSubscriber<T> = (callback: (data: T) => void) => Unsubscribe;
