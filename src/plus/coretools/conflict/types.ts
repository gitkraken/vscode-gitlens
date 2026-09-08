/**
 * Centralized type re-exports from `@gitkraken/conflict-tools`.
 *
 * Consumers across GitLens should import conflict-tools types FROM HERE, not directly from the
 * upstream package. Keeps the dependency surface visible in one place and lets us swap or wrap
 * types behind GitLens-internal names if we ever need to.
 *
 * Pure type re-exports — no runtime value escapes this file, so it's safe to type-import from
 * worker-bundle code without dragging the library's Node deps into the bundle.
 */

import type {
	Resolution as ConflictToolsResolution,
	StepResult as ConflictToolsStepResult,
} from '@gitkraken/conflict-tools';

/** Identifies canonical GitLens-authored resolution descriptions that may be localized for display.
 *  `description` itself remains canonical because conflict-tools includes it in later model context. */
export type ResolutionDescriptionKind = 'automatic-both-deleted';

export type Resolution = ConflictToolsResolution & {
	descriptionKind?: ResolutionDescriptionKind;
};

export type StepResult = Omit<ConflictToolsStepResult, 'resolutions'> & {
	resolutions: Resolution[];
};

export type {
	AIErrorCode,
	BlameOptions,
	Conflict,
	ConflictDiffOptions,
	ConflictErrorCode,
	ConflictGitOps,
	ConflictGitPort,
	ConflictMarker,
	ConflictModelMessage,
	ConflictModelParams,
	ConflictModelPort,
	ConflictModelResult,
	ConflictProgressEvent,
	ConflictType,
	FileRule,
	GrepOptions,
	LogOptions,
	OpOptions,
	ResolutionContext,
	ResolutionMetrics,
	ResolutionRefs,
	ResolutionStrategy,
	ResolutionVerifier,
	ResolvedChunk,
	ResolverConfig,
	ShowFileOptions,
	ShowOptions,
	StepConfig,
	ThreeWayDiff,
	ToolCall,
	ToolDefinition,
	ToolResult,
	UnmergedEntry,
	UnmergedReason,
	VerificationResult,
} from '@gitkraken/conflict-tools';
