import type { AnthropicModels } from './ai/anthropicProvider';
import type { OpenAIModels } from './ai/openaiProvider';
import type { AIProviders } from './constants';
import type { DateTimeFormat } from './system/date';
import type { LogLevel } from './system/logger.constants';

export interface Config {
	readonly ai: {
		readonly experimental: {
			readonly generateCommitMessage: {
				readonly enabled: boolean;
			};
			readonly provider: AIProviders | null;
			readonly openai: {
				readonly model: OpenAIModels | null;
				readonly url: string | null;
			};
			readonly anthropic: {
				readonly model: AnthropicModels | null;
			};
		};
	};
	readonly autolinks: AutolinkReference[] | null;
	readonly blame: {
		readonly avatars: boolean;
		readonly compact: boolean;
		readonly dateFormat: DateTimeFormat | (string & object) | null;
		readonly format: string;
		readonly heatmap: {
			readonly enabled: boolean;
			readonly location: 'left' | 'right';
		};
		readonly highlight: {
			readonly enabled: boolean;
			readonly locations: BlameHighlightLocations[];
		};
		readonly ignoreWhitespace: boolean;
		readonly separateLines: boolean;
		/*readonly*/ toggleMode: AnnotationsToggleMode;
	};
	readonly changes: {
		readonly locations: ChangesLocations[];
		/*readonly*/ toggleMode: AnnotationsToggleMode;
	};
	readonly cloudPatches: {
		readonly enabled: boolean;
		readonly experimental: {
			readonly layout: 'editor' | 'view';
		};
	};
	readonly codeLens: CodeLensConfig;
	readonly currentLine: {
		readonly dateFormat: string | null;
		/*readonly*/ enabled: boolean;
		readonly format: string;
		readonly uncommittedChangesFormat: string | null;
		readonly pullRequests: {
			readonly enabled: boolean;
		};
		readonly scrollable: boolean;
	};
	readonly debug: boolean;
	readonly deepLinks: {
		readonly schemeOverride: boolean | string | null;
	};
	readonly defaultDateFormat: DateTimeFormat | (string & object) | null;
	readonly defaultDateLocale: string | null;
	readonly defaultDateShortFormat: DateTimeFormat | (string & object) | null;
	readonly defaultDateSource: DateSource;
	readonly defaultDateStyle: DateStyle;
	readonly defaultGravatarsStyle: GravatarDefaultStyle;
	readonly defaultTimeFormat: DateTimeFormat | (string & object) | null;
	readonly detectNestedRepositories: boolean;
	readonly experimental: {
		readonly generateCommitMessagePrompt: string;
		readonly nativeGit: boolean;
		readonly openChangesInMultiDiffEditor: boolean;
	};
	readonly fileAnnotations: {
		readonly command: string | null;
	};
	readonly focus: {
		readonly allowMultiple: boolean;
	};
	readonly gitCommands: {
		readonly closeOnFocusOut: boolean;
		readonly search: {
			readonly matchAll: boolean;
			readonly matchCase: boolean;
			readonly matchRegex: boolean;
			readonly showResultsInSideBar: boolean | null;
		};
		readonly skipConfirmations: string[];
		readonly sortBy: GitCommandSorting;
	};
	readonly gitKraken: {
		readonly activeOrganizationId: string | null;
	};
	readonly graph: GraphConfig;
	readonly heatmap: {
		readonly ageThreshold: number;
		readonly coldColor: string;
		readonly hotColor: string;
		readonly fadeLines: boolean;
		readonly locations: HeatmapLocations[];
		/*readonly*/ toggleMode: AnnotationsToggleMode;
	};
	readonly hovers: {
		readonly annotations: {
			readonly changes: boolean;
			readonly details: boolean;
			readonly enabled: boolean;
			readonly over: 'line' | 'annotation';
		};
		readonly autolinks: {
			readonly enabled: boolean;
			readonly enhanced: boolean;
		};
		readonly currentLine: {
			readonly changes: boolean;
			readonly details: boolean;
			readonly enabled: boolean;
			readonly over: 'line' | 'annotation';
		};
		readonly avatars: boolean;
		readonly avatarSize: number;
		readonly changesDiff: 'line' | 'hunk';
		readonly detailsMarkdownFormat: string;
		/*readonly*/ enabled: boolean;
		readonly pullRequests: {
			readonly enabled: boolean;
		};
	};
	readonly integrations: {
		readonly enabled: boolean;
	};
	readonly keymap: KeyMap;
	readonly liveshare: {
		readonly enabled: boolean;
		readonly allowGuestAccess: boolean;
	};
	readonly menus: boolean | MenuConfig;
	readonly mode: {
		readonly active: string;
		readonly statusBar: {
			readonly enabled: boolean;
			readonly alignment: 'left' | 'right';
		};
	};
	readonly modes: Record<string, ModeConfig> | null;
	readonly outputLevel: OutputLevel;
	readonly partners: Record<
		string,
		{
			readonly enabled: boolean;
			readonly [key: string]: any;
		}
	> | null;
	readonly plusFeatures: {
		readonly enabled: boolean;
	};
	readonly proxy: {
		readonly url: string | null;
		readonly strictSSL: boolean;
	} | null;
	readonly rebaseEditor: {
		readonly ordering: 'asc' | 'desc';
		readonly showDetailsView: 'open' | 'selection' | false;
	};
	readonly remotes: RemotesConfig[] | null;
	readonly showWelcomeOnInstall: boolean;
	readonly showWhatsNewAfterUpgrades: boolean;
	readonly sortBranchesBy: BranchSorting;
	readonly sortContributorsBy: ContributorSorting;
	readonly sortTagsBy: TagSorting;
	readonly sortRepositoriesBy: RepositoriesSorting;
	readonly statusBar: {
		readonly alignment: 'left' | 'right';
		readonly command: StatusBarCommand;
		readonly dateFormat: DateTimeFormat | (string & object) | null;
		/*readonly*/ enabled: boolean;
		readonly format: string;
		readonly reduceFlicker: boolean;
		readonly pullRequests: {
			readonly enabled: boolean;
		};
		readonly tooltipFormat: string;
	};
	readonly strings: {
		readonly codeLens: {
			readonly unsavedChanges: {
				readonly recentChangeAndAuthors: string;
				readonly recentChangeOnly: string;
				readonly authorsOnly: string;
			};
		};
	};
	readonly telemetry: {
		readonly enabled: boolean;
	};
	readonly terminal: {
		readonly overrideGitEditor: boolean;
	};
	readonly terminalLinks: {
		readonly enabled: boolean;
		readonly showDetailsView: boolean;
	};
	readonly views: ViewsConfig;
	readonly virtualRepositories: {
		readonly enabled: boolean;
	};
	readonly visualHistory: {
		readonly allowMultiple: boolean;
		readonly queryLimit: number;
	};
	readonly worktrees: {
		readonly defaultLocation: string | null;
		readonly openAfterCreate: 'always' | 'alwaysNewWindow' | 'onlyWhenEmpty' | 'never' | 'prompt';
		readonly promptForLocation: boolean;
	};
	readonly advanced: AdvancedConfig;
}

export type AnnotationsToggleMode = 'file' | 'window';
export type AutolinkType = 'issue' | 'pullrequest';

export interface AutolinkReference {
	readonly prefix: string;
	readonly url: string;
	readonly title?: string;
	readonly alphanumeric?: boolean;
	readonly ignoreCase?: boolean;

	readonly type?: AutolinkType;
	readonly description?: string;
}

export type BlameHighlightLocations = 'gutter' | 'line' | 'overview';
export type BranchSorting = 'date:desc' | 'date:asc' | 'name:asc' | 'name:desc';
export type ChangesLocations = 'gutter' | 'line' | 'overview';

export const enum CodeLensCommand {
	CopyRemoteCommitUrl = 'gitlens.copyRemoteCommitUrl',
	CopyRemoteFileUrl = 'gitlens.copyRemoteFileUrl',
	DiffWithPrevious = 'gitlens.diffWithPrevious',
	OpenCommitOnRemote = 'gitlens.openCommitOnRemote',
	OpenFileOnRemote = 'gitlens.openFileOnRemote',
	RevealCommitInView = 'gitlens.revealCommitInView',
	ShowCommitsInView = 'gitlens.showCommitsInView',
	ShowQuickCommitDetails = 'gitlens.showQuickCommitDetails',
	ShowQuickCommitFileDetails = 'gitlens.showQuickCommitFileDetails',
	ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
	ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
	ToggleFileBlame = 'gitlens.toggleFileBlame',
	ToggleFileChanges = 'gitlens.toggleFileChanges',
	ToggleFileChangesOnly = 'gitlens.toggleFileChangesOnly',
	ToggleFileHeatmap = 'gitlens.toggleFileHeatmap',
}

export type CodeLensScopes = 'document' | 'containers' | 'blocks';
export type ContributorSorting = 'count:desc' | 'count:asc' | 'date:desc' | 'date:asc' | 'name:asc' | 'name:desc';
export type RepositoriesSorting = 'discovered' | 'lastFetched:desc' | 'lastFetched:asc' | 'name:asc' | 'name:desc';
export type CustomRemoteType =
	| 'AzureDevOps'
	| 'Bitbucket'
	| 'BitbucketServer'
	| 'Custom'
	| 'Gerrit'
	| 'GoogleSource'
	| 'Gitea'
	| 'GitHub'
	| 'GitLab';

export type DateSource = 'authored' | 'committed';
export type DateStyle = 'absolute' | 'relative';
export type FileAnnotationType = 'blame' | 'changes' | 'heatmap';
export type GitCommandSorting = 'name' | 'usage';
export type GraphScrollMarkersAdditionalTypes = 'localBranches' | 'remoteBranches' | 'stashes' | 'tags';
export type GraphMinimapMarkersAdditionalTypes = 'localBranches' | 'remoteBranches' | 'stashes' | 'tags';
export type GravatarDefaultStyle = 'wavatar' | 'identicon' | 'monsterid' | 'mp' | 'retro' | 'robohash';
export type HeatmapLocations = 'gutter' | 'line' | 'overview';
export type KeyMap = 'alternate' | 'chorded' | 'none';

type DeprecatedOutputLevel =
	| /** @deprecated use `off` */ 'silent'
	| /** @deprecated use `error` */ 'errors'
	| /** @deprecated use `info` */ 'verbose';
export type OutputLevel = LogLevel | DeprecatedOutputLevel;

export const enum StatusBarCommand {
	CopyRemoteCommitUrl = 'gitlens.copyRemoteCommitUrl',
	CopyRemoteFileUrl = 'gitlens.copyRemoteFileUrl',
	DiffWithPrevious = 'gitlens.diffWithPrevious',
	DiffWithWorking = 'gitlens.diffWithWorking',
	OpenCommitOnRemote = 'gitlens.openCommitOnRemote',
	OpenFileOnRemote = 'gitlens.openFileOnRemote',
	RevealCommitInView = 'gitlens.revealCommitInView',
	ShowCommitsInView = 'gitlens.showCommitsInView',
	ShowQuickCommitDetails = 'gitlens.showQuickCommitDetails',
	ShowQuickCommitFileDetails = 'gitlens.showQuickCommitFileDetails',
	ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
	ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
	ToggleCodeLens = 'gitlens.toggleCodeLens',
	ToggleFileBlame = 'gitlens.toggleFileBlame',
	ToggleFileChanges = 'gitlens.toggleFileChanges',
	ToggleFileChangesOnly = 'gitlens.toggleFileChangesOnly',
	ToggleFileHeatmap = 'gitlens.toggleFileHeatmap',
}

export type TagSorting = 'date:desc' | 'date:asc' | 'name:asc' | 'name:desc';

export type ViewBranchesLayout = 'list' | 'tree';
export type ViewFilesLayout = 'auto' | 'list' | 'tree';
export type ViewShowBranchComparison = 'branch' | 'working';

export interface AdvancedConfig {
	readonly abbreviatedShaLength: number;
	readonly abbreviateShaOnCopy: boolean;
	readonly blame: {
		readonly customArguments: string[] | null;
		readonly delayAfterEdit: number;
		readonly sizeThresholdAfterEdit: number;
	};
	readonly caching: {
		readonly enabled: boolean;
	};
	readonly commitOrdering: 'date' | 'author-date' | 'topo' | null;
	readonly externalDiffTool: string | null;
	readonly externalDirectoryDiffTool: string | null;
	readonly fileHistoryFollowsRenames: boolean;
	readonly fileHistoryShowAllBranches: boolean;
	readonly fileHistoryShowMergeCommits: boolean;
	readonly maxListItems: number;
	readonly maxSearchItems: number;
	readonly messages: { [key in SuppressedMessages]: boolean };
	readonly quickPick: {
		readonly closeOnFocusOut: boolean;
	};
	readonly repositorySearchDepth: number | null;
	readonly similarityThreshold: number | null;
}

export interface GraphConfig {
	readonly allowMultiple: boolean;
	readonly avatars: boolean;
	readonly commitOrdering: 'date' | 'author-date' | 'topo';
	readonly dateFormat: DateTimeFormat | string | null;
	readonly dateStyle: DateStyle | null;
	readonly defaultItemLimit: number;
	readonly dimMergeCommits: boolean;
	readonly minimap: {
		readonly enabled: boolean;
		readonly dataType: 'commits' | 'lines';
		readonly additionalTypes: GraphMinimapMarkersAdditionalTypes[];
	};
	readonly highlightRowsOnRefHover: boolean;
	readonly layout: 'editor' | 'panel';
	readonly scrollRowPadding: number;
	readonly showDetailsView: 'open' | 'selection' | false;
	readonly showGhostRefsOnRowHover: boolean;
	readonly scrollMarkers: {
		readonly enabled: boolean;
		readonly additionalTypes: GraphScrollMarkersAdditionalTypes[];
	};
	readonly pullRequests: {
		readonly enabled: boolean;
	};
	readonly showRemoteNames: boolean;
	readonly showUpstreamStatus: boolean;
	readonly pageItemLimit: number;
	readonly searchItemLimit: number;
	readonly statusBar: {
		readonly enabled: boolean;
	};
}

export interface CodeLensConfig {
	readonly authors: {
		readonly enabled: boolean;
		readonly command: CodeLensCommand | false;
	};
	readonly dateFormat: DateTimeFormat | string | null;
	/*readonly*/ enabled: boolean;
	readonly includeSingleLineSymbols: boolean;
	readonly recentChange: {
		readonly enabled: boolean;
		readonly command: CodeLensCommand | false;
	};
	readonly scopes: CodeLensScopes[];
	readonly scopesByLanguage: CodeLensLanguageScope[] | null;
	readonly symbolScopes: string[];
}

export interface CodeLensLanguageScope {
	readonly language: string | undefined;
	readonly scopes?: CodeLensScopes[];
	readonly symbolScopes?: string[];
}

export interface MenuConfig {
	readonly editor:
		| false
		| {
				readonly blame: boolean;
				readonly clipboard: boolean;
				readonly compare: boolean;
				readonly history: boolean;
				readonly remote: boolean;
		  };
	readonly editorGroup:
		| false
		| {
				readonly blame: boolean;
				readonly compare: boolean;
		  };
	readonly editorGutter:
		| false
		| {
				readonly compare: boolean;
				readonly remote: boolean;
				readonly share: boolean;
		  };
	readonly editorTab:
		| false
		| {
				readonly clipboard: boolean;
				readonly compare: boolean;
				readonly history: boolean;
				readonly remote: boolean;
		  };
	readonly explorer:
		| false
		| {
				readonly clipboard: boolean;
				readonly compare: boolean;
				readonly history: boolean;
				readonly remote: boolean;
		  };
	readonly ghpr:
		| false
		| {
				readonly worktree: boolean;
		  };
	readonly scm:
		| false
		| {
				readonly graph: boolean;
		  };
	readonly scmRepositoryInline: false | { readonly graph: boolean };
	readonly scmRepository:
		| false
		| {
				readonly authors: boolean;
				readonly generateCommitMessage: boolean;
				readonly graph: boolean;
		  };
	readonly scmGroupInline:
		| false
		| {
				readonly stash: boolean;
		  };
	readonly scmGroup:
		| false
		| {
				readonly compare: boolean;
				readonly openClose: boolean;
				readonly stash: boolean;
		  };
	readonly scmItemInline:
		| false
		| {
				readonly stash: boolean;
		  };
	readonly scmItem:
		| false
		| {
				readonly clipboard: boolean;
				readonly compare: boolean;
				readonly history: boolean;
				readonly remote: boolean;
				readonly share: boolean;
				readonly stash: boolean;
		  };
}

export interface ModeConfig {
	readonly name: string;
	readonly statusBarItemName?: string;
	readonly description?: string;
	readonly annotations?: 'blame' | 'changes' | 'heatmap';
	readonly codeLens?: boolean;
	readonly currentLine?: boolean;
	readonly hovers?: boolean;
	readonly statusBar?: boolean;
}

export type RemotesConfig =
	| {
			readonly domain: string;
			readonly regex: null;
			readonly name?: string;
			readonly protocol?: string;
			readonly type: CustomRemoteType;
			readonly urls?: RemotesUrlsConfig;
			readonly ignoreSSLErrors?: boolean | 'force';
	  }
	| {
			readonly domain: null;
			readonly regex: string;
			readonly name?: string;
			readonly protocol?: string;
			readonly type: CustomRemoteType;
			readonly urls?: RemotesUrlsConfig;
			readonly ignoreSSLErrors?: boolean | 'force';
	  };

export interface RemotesUrlsConfig {
	readonly repository: string;
	readonly branches: string;
	readonly branch: string;
	readonly commit: string;
	readonly comparison?: string;
	readonly file: string;
	readonly fileInBranch: string;
	readonly fileInCommit: string;
	readonly fileLine: string;
	readonly fileRange: string;
}

// NOTE: Must be kept in sync with `gitlens.advanced.messages` setting in the package.json
export type SuppressedMessages =
	| 'suppressCommitHasNoPreviousCommitWarning'
	| 'suppressCommitNotFoundWarning'
	| 'suppressCreatePullRequestPrompt'
	| 'suppressDebugLoggingWarning'
	| 'suppressFileNotUnderSourceControlWarning'
	| 'suppressGitDisabledWarning'
	| 'suppressGitMissingWarning'
	| 'suppressGitVersionWarning'
	| 'suppressLineUncommittedWarning'
	| 'suppressNoRepositoryWarning'
	| 'suppressRebaseSwitchToTextWarning'
	| 'suppressIntegrationDisconnectedTooManyFailedRequestsWarning'
	| 'suppressIntegrationRequestFailed500Warning'
	| 'suppressIntegrationRequestTimedOutWarning'
	| 'suppressBlameInvalidIgnoreRevsFileWarning'
	| 'suppressBlameInvalidIgnoreRevsFileBadRevisionWarning';

export interface ViewsCommonConfig {
	readonly defaultItemLimit: number;
	readonly formats: {
		readonly commits: {
			readonly label: string;
			readonly description: string;
			readonly tooltip: string;
			readonly tooltipWithStatus: string;
		};
		readonly files: {
			readonly label: string;
			readonly description: string;
		};
		readonly stashes: {
			readonly label: string;
			readonly description: string;
		};
	};
	readonly pageItemLimit: number;
	readonly showRelativeDateMarkers: boolean;

	readonly experimental: {
		readonly multiSelect: {
			readonly enabled: boolean | null | undefined;
		};
	};
}

export const viewsCommonConfigKeys: (keyof ViewsCommonConfig)[] = [
	'defaultItemLimit',
	'formats',
	'pageItemLimit',
	'showRelativeDateMarkers',
];

interface ViewsConfigs {
	readonly branches: BranchesViewConfig;
	readonly commits: CommitsViewConfig;
	readonly commitDetails: CommitDetailsViewConfig;
	readonly contributors: ContributorsViewConfig;
	readonly drafts: object; // TODO@eamodio add real types
	readonly fileHistory: FileHistoryViewConfig;
	readonly lineHistory: LineHistoryViewConfig;
	readonly patchDetails: PatchDetailsViewConfig;
	readonly remotes: RemotesViewConfig;
	readonly repositories: RepositoriesViewConfig;
	readonly searchAndCompare: SearchAndCompareViewConfig;
	readonly stashes: StashesViewConfig;
	readonly tags: TagsViewConfig;
	readonly worktrees: WorktreesViewConfig;
	readonly workspaces: WorkspacesViewConfig;
}

export type ViewsConfigKeys = keyof ViewsConfigs;
export const viewsConfigKeys: ViewsConfigKeys[] = [
	'branches',
	'commits',
	'commitDetails',
	'contributors',
	'drafts',
	'fileHistory',
	'lineHistory',
	'patchDetails',
	'remotes',
	'repositories',
	'searchAndCompare',
	'stashes',
	'tags',
	'worktrees',
	'workspaces',
];

export type ViewsConfig = ViewsCommonConfig & ViewsConfigs;

export interface BranchesViewConfig {
	readonly avatars: boolean;
	readonly branches: {
		readonly layout: ViewBranchesLayout;
	};
	readonly files: ViewsFilesConfig;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForBranches: boolean;
		readonly showForCommits: boolean;
	};
	readonly reveal: boolean;
	readonly showBranchComparison: false | Extract<ViewShowBranchComparison, 'branch'>;
}

export interface CommitsViewConfig {
	readonly avatars: boolean;
	readonly branches: undefined;
	readonly files: ViewsFilesConfig;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForBranches: boolean;
		readonly showForCommits: boolean;
	};
	readonly reveal: boolean;
	readonly showBranchComparison: false | ViewShowBranchComparison;
}

export interface CommitDetailsViewConfig {
	readonly avatars: boolean;
	readonly files: ViewsFilesConfig;
	readonly autolinks: {
		readonly enabled: boolean;
		readonly enhanced: boolean;
	};
	readonly pullRequests: {
		readonly enabled: boolean;
	};
}

export interface PatchDetailsViewConfig {
	readonly avatars: boolean;
	readonly files: ViewsFilesConfig;
}

export interface ContributorsViewConfig {
	readonly avatars: boolean;
	readonly files: ViewsFilesConfig;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForCommits: boolean;
	};
	readonly reveal: boolean;
	readonly showAllBranches: boolean;
	readonly showStatistics: boolean;
}

export interface FileHistoryViewConfig {
	readonly avatars: boolean;
	readonly files: ViewsFilesConfig;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForCommits: boolean;
	};
}

export interface LineHistoryViewConfig {
	readonly avatars: boolean;
}

export interface RemotesViewConfig {
	readonly avatars: boolean;
	readonly branches: {
		readonly layout: ViewBranchesLayout;
	};
	readonly files: ViewsFilesConfig;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForBranches: boolean;
		readonly showForCommits: boolean;
	};
	readonly reveal: boolean;
}

export interface RepositoriesViewConfig {
	readonly autoRefresh: boolean;
	readonly autoReveal: boolean;
	readonly avatars: boolean;
	readonly branches: {
		readonly layout: ViewBranchesLayout;
		readonly showBranchComparison: false | Extract<ViewShowBranchComparison, 'branch'>;
	};
	readonly compact: boolean;
	readonly files: ViewsFilesConfig;
	readonly includeWorkingTree: boolean;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForBranches: boolean;
		readonly showForCommits: boolean;
	};
	readonly showBranchComparison: false | ViewShowBranchComparison;
	readonly showBranches: boolean;
	readonly showCommits: boolean;
	readonly showContributors: boolean;
	readonly showIncomingActivity: boolean;
	readonly showRemotes: boolean;
	readonly showStashes: boolean;
	readonly showTags: boolean;
	readonly showUpstreamStatus: boolean;
	readonly showWorktrees: boolean;
}

export interface SearchAndCompareViewConfig {
	readonly avatars: boolean;
	readonly files: ViewsFilesConfig;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForCommits: boolean;
	};
}

export interface StashesViewConfig {
	readonly files: ViewsFilesConfig;
	readonly reveal: boolean;
}

export interface TagsViewConfig {
	readonly avatars: boolean;
	readonly branches: {
		readonly layout: ViewBranchesLayout;
	};
	readonly files: ViewsFilesConfig;
	readonly reveal: boolean;
}

export interface WorktreesViewConfig {
	readonly avatars: boolean;
	readonly files: ViewsFilesConfig;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForBranches: boolean;
		readonly showForCommits: boolean;
	};
	readonly reveal: boolean;
	readonly showBranchComparison: false | Extract<ViewShowBranchComparison, 'branch'>;
}

export interface WorkspacesViewConfig {
	readonly avatars: boolean;
	readonly branches: {
		readonly layout: ViewBranchesLayout;
		readonly showBranchComparison: false | Extract<ViewShowBranchComparison, 'branch'>;
	};
	readonly compact: boolean;
	readonly files: ViewsFilesConfig;
	readonly includeWorkingTree: boolean;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForBranches: boolean;
		readonly showForCommits: boolean;
	};
	readonly showBranchComparison: false | ViewShowBranchComparison;
	readonly showBranches: boolean;
	readonly showCommits: boolean;
	readonly showContributors: boolean;
	readonly showIncomingActivity: boolean;
	readonly showRemotes: boolean;
	readonly showStashes: boolean;
	readonly showTags: boolean;
	readonly showUpstreamStatus: boolean;
	readonly showWorktrees: boolean;
}

export interface ViewsFilesConfig {
	readonly compact: boolean;
	readonly icon: 'status' | 'type';
	readonly layout: ViewFilesLayout;
	readonly threshold: number;
}

export function fromOutputLevel(level: OutputLevel): LogLevel {
	switch (level) {
		case /** @deprecated use `off` */ 'silent':
			return 'off';
		case /** @deprecated use `error` */ 'errors':
			return 'error';
		case /** @deprecated use `info` */ 'verbose':
			return 'info';
		default:
			return level;
	}
}
