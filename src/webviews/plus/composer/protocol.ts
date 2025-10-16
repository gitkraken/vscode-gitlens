import type { Sources } from '../../../constants.telemetry';
import type { RepositoryShape } from '../../../git/models/repositoryShape';
import type { AIModel } from '../../../plus/ai/models/model';
import type { IpcScope, WebviewState } from '../../protocol';
import { IpcCommand, IpcNotification } from '../../protocol';

export const scope: IpcScope = 'composer';

export const currentOnboardingVersion = '1.0.0'; // Update this when onboarding changes

export interface ComposerHunk extends ComposerHunkBase {
	diffHeader: string; // Git diff header (e.g., "diff --git a/file.ts b/file.ts")
	hunkHeader: string; // Hunk header (e.g., "@@ -1,5 +1,7 @@") or "rename" for rename hunks
	content: string; // The actual diff content (lines starting with +, -, or space) or rename info
}

export interface ComposerHunkBase {
	index: number; // Unique hunk index (1-based to match hunkMap)
	fileName: string;
	additions: number;
	deletions: number;
	source: 'staged' | 'unstaged' | 'commits' | string; // commit SHA or source type
	assigned?: boolean; // True when this hunk's index is in any commit's hunkIndices array
	isRename?: boolean; // True for rename-only hunks
	originalFileName?: string; // Original filename for renames
}

export interface ComposerCommit {
	id: string;
	message: string;
	sha?: string; // Optional SHA for existing commits
	aiExplanation?: string;
	hunkIndices: number[]; // References to hunk indices in the hunk map
}

// Remove callbacks - use IPC instead

export interface ComposerBaseCommit {
	sha: string;
	message: string;
	repoName: string;
	branchName: string;
}

export interface ComposerSafetyState {
	repoPath: string;
	headSha: string;
	// branchName: string;
	// branchRefSha: string;
	// worktreeName: string;
	hashes: {
		staged: string | null;
		unstaged: string | null;
		unified: string | null;
	};

	// stagedDiff: string | null; // null if no staged changes when composer opened
	// unstagedDiff: string | null; // null if no unstaged changes when composer opened
	// unifiedDiff: string | null; // null if no changes when composer opened
	// timestamp: number;
}

export interface State extends WebviewState {
	// data model
	hunks: ComposerHunk[];

	commits: ComposerCommit[];
	baseCommit: ComposerBaseCommit;

	// UI state
	selectedCommitId: string | null;
	selectedCommitIds: Set<string>;
	selectedUnassignedSection: string | null;
	selectedHunkIds: Set<string>;
	detailsSectionExpanded: {
		commitMessage: boolean;
		aiExplanation: boolean;
		filesChanged: boolean;
	};
	generatingCommits: boolean;
	generatingCommitMessage: string | null; // commitId of the commit currently generating a message, or null
	committing: boolean; // true when finish and commit is in progress
	safetyError: string | null; // error message if safety validation failed, or null
	loadingError: string | null; // error message if there was an error loading the webview, or null
	aiOperationError: { operation: string; error?: string } | null; // error message if AI operation failed, or null

	// AI composition state
	hasUsedAutoCompose: boolean; // true if auto-compose has been successfully used at least once

	// Content state
	hasChanges: boolean; // true if there are working directory changes to compose
	workingDirectoryHasChanged: boolean; // true if working directory has changed since composer opened
	indexHasChanged: boolean; // true if index has changed since composer opened

	// Mode controls
	mode: 'experimental' | 'preview'; // experimental = normal mode, preview = locked AI preview mode

	// AI settings
	aiEnabled: {
		org: boolean;
		config: boolean;
	};
	ai: {
		model: AIModel | undefined;
	};
	onboardingDismissed: boolean;
	// only needed when multiple repositories are open
	repositoryState?: {
		current: RepositoryShape;
		hasMultipleRepositories: boolean;
	};
}

export const initialState: Omit<State, keyof WebviewState> = {
	hunks: [],
	commits: [],
	baseCommit: {
		sha: '',
		message: '',
		repoName: '',
		branchName: '',
	},
	selectedCommitId: null,
	selectedCommitIds: new Set<string>(),
	selectedUnassignedSection: null,
	selectedHunkIds: new Set<string>(),
	detailsSectionExpanded: {
		commitMessage: true,
		aiExplanation: true,
		filesChanged: true,
	},
	generatingCommits: false,
	generatingCommitMessage: null,
	committing: false,
	safetyError: null,
	loadingError: null,
	aiOperationError: null,
	hasUsedAutoCompose: false,
	hasChanges: true,
	workingDirectoryHasChanged: false,
	indexHasChanged: false,
	mode: 'preview',
	aiEnabled: {
		org: false,
		config: false,
	},
	ai: {
		model: undefined,
	},
	onboardingDismissed: false,
};

export interface ComposerContext {
	sessionStart: string; // timestamp when the session started
	sessionDuration: number | undefined; // Only populated as user is exiting composer session
	diff: {
		files: number;
		hunks: number;
		lines: number;
		staged: boolean;
		unstaged: boolean;
		unstagedIncluded: boolean;
	};
	commits: {
		initialCount: number;
		autoComposedCount: number | undefined; // What the auto-compose did
		composedCount: number | undefined; // Anything the user did outside of auto-compose
		finalCount: number | undefined;
	};
	ai: {
		enabled: {
			org: boolean;
			config: boolean;
		};
		model: AIModel | undefined;
	};
	onboarding: {
		stepReached: number | undefined;
		dismissed: boolean;
	};
	operations: {
		generateCommits: {
			count: number;
			cancelledCount: number;
			errorCount: number;
			feedback: {
				upvoteCount: number;
				downvoteCount: number;
			};
		};
		generateCommitMessage: {
			count: number;
			cancelledCount: number;
			errorCount: number;
		};
		finishAndCommit: {
			errorCount: number;
		};
		undo: {
			count: number;
		};
		redo: {
			count: number;
		};
		reset: {
			count: number;
		};
	};
	source: Sources | undefined;
	mode: 'experimental' | 'preview';
	errors: {
		safety: {
			count: number;
		};
		operation: {
			count: number;
		};
	};
	warnings: {
		workingDirectoryChanged: boolean;
		indexChanged: boolean;
	};
}

export const baseContext: ComposerContext = {
	sessionStart: '',
	sessionDuration: undefined,
	diff: {
		files: 0,
		hunks: 0,
		lines: 0,
		staged: false,
		unstaged: false,
		unstagedIncluded: false,
	},
	commits: {
		initialCount: 0,
		autoComposedCount: undefined,
		composedCount: undefined,
		finalCount: undefined,
	},
	ai: {
		enabled: {
			org: false,
			config: false,
		},
		model: undefined,
	},
	onboarding: {
		dismissed: false,
		stepReached: undefined,
	},
	operations: {
		generateCommits: {
			count: 0,
			cancelledCount: 0,
			errorCount: 0,
			feedback: {
				upvoteCount: 0,
				downvoteCount: 0,
			},
		},
		generateCommitMessage: {
			count: 0,
			cancelledCount: 0,
			errorCount: 0,
		},
		finishAndCommit: {
			errorCount: 0,
		},
		undo: {
			count: 0,
		},
		redo: {
			count: 0,
		},
		reset: {
			count: 0,
		},
	},
	source: undefined,
	mode: 'preview',
	errors: {
		safety: { count: 0 },
		operation: { count: 0 },
	},
	warnings: {
		workingDirectoryChanged: false,
		indexChanged: false,
	},
};

export type ComposerTelemetryEvent =
	| 'composer/loaded'
	| 'composer/reloaded'
	| 'composer/action/includedUnstagedChanges'
	| 'composer/action/compose'
	| 'composer/action/compose/failed'
	| 'composer/action/recompose'
	| 'composer/action/recompose/failed'
	| 'composer/action/generateCommitMessage'
	| 'composer/action/generateCommitMessage/failed'
	| 'composer/action/changeAiModel'
	| 'composer/action/finishAndCommit'
	| 'composer/action/finishAndCommit/failed'
	| 'composer/action/undo'
	| 'composer/action/reset'
	| 'composer/warning/workingDirectoryChanged'
	| 'composer/warning/indexChanged';

export type ComposerLoadedErrorData = {
	'failure.reason': 'error';
	'failure.error.message': string;
};

export type ComposerGenerateCommitsEventData = {
	'customInstructions.used': boolean;
	'customInstructions.length': number;
	'customInstructions.hash': string;
	'customInstructions.setting.used': boolean;
	'customInstructions.setting.length': number;
};

export type ComposerGenerateCommitMessageEventData = {
	'customInstructions.setting.used': boolean;
	'customInstructions.setting.length': number;
	overwriteExistingMessage: boolean;
};

export type ComposerActionEventFailureData =
	| {
			'failure.reason': 'cancelled';
	  }
	| {
			'failure.reason': 'error';
			'failure.error.message': string;
	  };

// Commands that can be sent from the webview to the host

export interface GenerateWithAIParams {
	commits: ComposerCommit[];
	unassignedHunkIndices: number[];
}

// Notifications that can be sent from the host to the webview
export interface DidChangeComposerDataParams {
	hunks: ComposerHunk[];
	commits: ComposerCommit[];
	baseCommit: ComposerBaseCommit;
}

// IPC Commands and Notifications
const ipcScope = 'composer';

// Commands sent from webview to host
export const GenerateCommitsCommand = new IpcCommand<GenerateCommitsParams>(ipcScope, 'generateCommits');
export const GenerateCommitMessageCommand = new IpcCommand<GenerateCommitMessageParams>(
	ipcScope,
	'generateCommitMessage',
);
export const FinishAndCommitCommand = new IpcCommand<FinishAndCommitParams>(ipcScope, 'finishAndCommit');
export const CloseComposerCommand = new IpcCommand<void>(ipcScope, 'close');
export const ReloadComposerCommand = new IpcCommand<ReloadComposerParams>(ipcScope, 'reload');
export const CancelGenerateCommitsCommand = new IpcCommand<void>(ipcScope, 'cancelGenerateCommits');
export const CancelGenerateCommitMessageCommand = new IpcCommand<void>(ipcScope, 'cancelGenerateCommitMessage');
export const CancelFinishAndCommitCommand = new IpcCommand<void>(ipcScope, 'cancelFinishAndCommit');
export const ClearAIOperationErrorCommand = new IpcCommand<void>(ipcScope, 'clearAIOperationError');
export const OnSelectAIModelCommand = new IpcCommand<void>(ipcScope, 'selectAIModel');
export interface AIFeedbackParams {
	sessionId: string | null;
}

export const AIFeedbackHelpfulCommand = new IpcCommand<AIFeedbackParams>(ipcScope, 'aiFeedbackHelpful');
export const AIFeedbackUnhelpfulCommand = new IpcCommand<AIFeedbackParams>(ipcScope, 'aiFeedbackUnhelpful');

export const OpenOnboardingCommand = new IpcCommand<void>(ipcScope, 'openOnboarding');
export const DismissOnboardingCommand = new IpcCommand<void>(ipcScope, 'dismissOnboarding');
export const AdvanceOnboardingCommand = new IpcCommand<{ stepNumber: number }>(ipcScope, 'advanceOnboarding');

export const ChooseRepositoryCommand = new IpcCommand(scope, 'chooseRepository');

// Commands intended only to update context/telemetry
export interface OnAddHunksToCommitParams {
	source: string;
}
export const OnAddHunksToCommitCommand = new IpcCommand<OnAddHunksToCommitParams>(ipcScope, 'onAddHunksToCommit');
export const OnUndoCommand = new IpcCommand<void>(ipcScope, 'onUndo');
export const OnRedoCommand = new IpcCommand<void>(ipcScope, 'onRedo');
export const OnResetCommand = new IpcCommand<void>(ipcScope, 'onReset');

// Notifications sent from host to webview
export const DidStartGeneratingNotification = new IpcNotification<void>(ipcScope, 'didStartGenerating');
export const DidStartGeneratingCommitMessageNotification = new IpcNotification<{ commitId: string }>(
	ipcScope,
	'didStartGeneratingCommitMessage',
);
export const DidGenerateCommitsNotification = new IpcNotification<DidGenerateCommitsParams>(
	ipcScope,
	'didGenerateCommits',
);
export const DidGenerateCommitMessageNotification = new IpcNotification<DidGenerateCommitMessageParams>(
	ipcScope,
	'didGenerateCommitMessage',
);
export const DidStartCommittingNotification = new IpcNotification<void>(ipcScope, 'didStartCommitting');
export const DidFinishCommittingNotification = new IpcNotification<void>(ipcScope, 'didFinishCommitting');
export const DidSafetyErrorNotification = new IpcNotification<DidSafetyErrorParams>(ipcScope, 'didSafetyError');
export const DidReloadComposerNotification = new IpcNotification<DidReloadComposerParams>(
	ipcScope,
	'didReloadComposer',
);
export const DidLoadingErrorNotification = new IpcNotification<DidLoadingErrorParams>(ipcScope, 'didLoadingError');
export const DidWorkingDirectoryChangeNotification = new IpcNotification<void>(ipcScope, 'didWorkingDirectoryChange');
export const DidIndexChangeNotification = new IpcNotification<void>(ipcScope, 'didIndexChange');
export const DidCancelGenerateCommitsNotification = new IpcNotification<void>(ipcScope, 'didCancelGenerateCommits');
export const DidCancelGenerateCommitMessageNotification = new IpcNotification<void>(
	ipcScope,
	'didCancelGenerateCommitMessage',
);
export interface DidErrorAIOperationParams {
	operation: string;
	error?: string;
}
export const DidErrorAIOperationNotification = new IpcNotification<DidErrorAIOperationParams>(
	ipcScope,
	'didErrorAIOperation',
);
export const DidClearAIOperationErrorNotification = new IpcNotification<void>(ipcScope, 'didClearAIOperationError');
export const DidChangeAiEnabledNotification = new IpcNotification<DidChangeAiEnabledParams>(
	ipcScope,
	'didChangeAiEnabled',
);
export const DidChangeAiModelNotification = new IpcNotification<DidChangeAiModelParams>(ipcScope, 'didChangeAiModel');

// Parameters for IPC messages
export interface GenerateCommitsParams {
	hunkIndices: number[];
	commits: ComposerCommit[];
	baseCommit: ComposerBaseCommit;
	customInstructions?: string;
	isRecompose?: boolean;
}

export interface GenerateCommitMessageParams {
	commitId: string;
	commitHunkIndices: number[];
	overwriteExistingMessage?: boolean;
}

export interface FinishAndCommitParams {
	commits: ComposerCommit[];
	baseCommit: ComposerBaseCommit;
}

export interface ReloadComposerParams {
	repoPath?: string;
	mode?: 'experimental' | 'preview';
	source?: Sources;
}

export interface DidGenerateCommitsParams {
	commits: ComposerCommit[];
}

export interface DidGenerateCommitMessageParams {
	commitId: string;
	message: string;
}

export interface DidChangeAiEnabledParams {
	org?: boolean;
	config?: boolean;
}

export interface DidChangeAiModelParams {
	model: AIModel | undefined;
}

export interface DidSafetyErrorParams {
	error: string;
}

export interface DidReloadComposerParams {
	hunks: ComposerHunk[];
	commits: ComposerCommit[];
	baseCommit: ComposerBaseCommit;
	loadingError: string | null;
	hasChanges: boolean;
	repositoryState?: {
		current: RepositoryShape;
		hasMultipleRepositories: boolean;
	};
}

export interface DidLoadingErrorParams {
	error: string;
}
