import type { extensionPrefix } from './constants';

export type Colors =
	| `${typeof extensionPrefix}.closedAutolinkedIssueIconColor`
	| `${typeof extensionPrefix}.closedPullRequestIconColor`
	| `${typeof extensionPrefix}.decorations.addedForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchAheadForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchBehindForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchDivergedForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchMissingUpstreamForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchUpToDateForegroundColor`
	| `${typeof extensionPrefix}.decorations.branchUnpublishedForegroundColor`
	| `${typeof extensionPrefix}.decorations.copiedForegroundColor`
	| `${typeof extensionPrefix}.decorations.deletedForegroundColor`
	| `${typeof extensionPrefix}.decorations.ignoredForegroundColor`
	| `${typeof extensionPrefix}.decorations.modifiedForegroundColor`
	| `${typeof extensionPrefix}.decorations.statusMergingOrRebasingConflictForegroundColor`
	| `${typeof extensionPrefix}.decorations.statusMergingOrRebasingForegroundColor`
	| `${typeof extensionPrefix}.decorations.renamedForegroundColor`
	| `${typeof extensionPrefix}.decorations.untrackedForegroundColor`
	| `${typeof extensionPrefix}.decorations.workspaceCurrentForegroundColor`
	| `${typeof extensionPrefix}.decorations.workspaceRepoMissingForegroundColor`
	| `${typeof extensionPrefix}.decorations.workspaceRepoOpenForegroundColor`
	| `${typeof extensionPrefix}.decorations.worktreeHasUncommittedChangesForegroundColor`
	| `${typeof extensionPrefix}.decorations.worktreeMissingForegroundColor`
	| `${typeof extensionPrefix}.gutterBackgroundColor`
	| `${typeof extensionPrefix}.gutterForegroundColor`
	| `${typeof extensionPrefix}.gutterUncommittedForegroundColor`
	| `${typeof extensionPrefix}.launchpadIndicatorMergeableColor`
	| `${typeof extensionPrefix}.launchpadIndicatorMergeableHoverColor`
	| `${typeof extensionPrefix}.launchpadIndicatorBlockedColor`
	| `${typeof extensionPrefix}.launchpadIndicatorBlockedHoverColor`
	| `${typeof extensionPrefix}.launchpadIndicatorAttentionColor`
	| `${typeof extensionPrefix}.launchpadIndicatorAttentionHoverColor`
	| `${typeof extensionPrefix}.lineHighlightBackgroundColor`
	| `${typeof extensionPrefix}.lineHighlightOverviewRulerColor`
	| `${typeof extensionPrefix}.mergedPullRequestIconColor`
	| `${typeof extensionPrefix}.openAutolinkedIssueIconColor`
	| `${typeof extensionPrefix}.openPullRequestIconColor`
	| `${typeof extensionPrefix}.trailingLineBackgroundColor`
	| `${typeof extensionPrefix}.trailingLineForegroundColor`
	| `${typeof extensionPrefix}.unpublishedChangesIconColor`
	| `${typeof extensionPrefix}.unpublishedCommitIconColor`
	| `${typeof extensionPrefix}.unpulledChangesIconColor`;

export type CoreColors =
	| 'editorOverviewRuler.addedForeground'
	| 'editorOverviewRuler.deletedForeground'
	| 'editorOverviewRuler.modifiedForeground'
	| 'list.foreground'
	| 'list.warningForeground'
	| 'statusBarItem.warningBackground';
