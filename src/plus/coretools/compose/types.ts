/**
 * Centralized type re-exports from `@gitkraken/compose-tools` and `@gitkraken/shared-tools`.
 *
 * Consumers across GitLens should import compose-tools / shared-tools types FROM HERE,
 * not directly from the upstream packages. Keeps the dependency surface visible in one
 * place and lets us swap or wrap types behind GitLens-internal names if we ever need to.
 *
 * Pure type re-exports — no runtime value escapes this file, so it's safe to type-import
 * from worker-bundle code without dragging the library's Node deps into the bundle.
 */

export type {
	ApplyPatchOptions,
	ApplyUpTo,
	CheckoutOptions,
	CleanOptions,
	CommitTreeOptions,
	ComposeApplyPlan,
	ComposeGitPort,
	ComposeHunk,
	ComposePlan,
	ComposePlanResult,
	ComposeProgressEvent,
	ComposeSource,
	ComposeTarget,
	DeleteBranchOptions,
	DiffTreeOptions,
	ForEachRefOptions,
	IndexScopedOptions,
	LogOptions,
	OnBeforePrompt,
	OpOptions,
	SigningConfig,
	StageAllOptions,
	StashConflict,
	StashPushOptions,
	UndoForceOptions,
	UpdateRefOptions,
} from '@gitkraken/compose-tools';

export type {
	AiGenerateParams,
	AiGenerateResult,
	AiModelPort,
	AiTokenUsage,
	GitExecOptions,
} from '@gitkraken/shared-tools';
