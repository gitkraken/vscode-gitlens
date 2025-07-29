import type { AIProviderAndModel, SupportedAIModels } from './constants.ai';
import type { GroupableTreeViewTypes } from './constants.views';
import type { DateTimeFormat } from './system/date';
import type { LogLevel } from './system/logger.constants';

export interface Config {
	readonly advanced: AdvancedConfig;
	readonly ai: AIConfig;
	readonly autolinks: AutolinkConfig[] | null;
	readonly blame: BlameConfig;
	readonly changes: ChangesConfig;
	readonly cloudIntegrations: CloudIntegrationsConfig;
	readonly cloudPatches: CloudPatchesConfig;
	readonly codeLens: CodeLensConfig;
	readonly currentLine: CurrentLineConfig;
	readonly debug: boolean;
	readonly deepLinks: DeepLinksConfig;
	readonly defaultDateFormat: DateTimeFormat | (string & object) | null;
	readonly defaultDateLocale: string | null;
	readonly defaultDateShortFormat: DateTimeFormat | (string & object) | null;
	readonly defaultDateSource: DateSource;
	readonly defaultDateStyle: DateStyle;
	readonly defaultGravatarsStyle: GravatarDefaultStyle;
	readonly defaultTimeFormat: DateTimeFormat | (string & object) | null;
	readonly detectNestedRepositories: boolean;
	readonly fileAnnotations: FileAnnotationsConfig;
	readonly gitCommands: GitCommandsConfig;
	readonly gitkraken: GitKrakenConfig;
	readonly graph: GraphConfig;
	readonly heatmap: HeatmapConfig;
	readonly home: HomeConfig;
	readonly hovers: HoversConfig;
	readonly integrations: IntegrationsConfig;
	readonly keymap: KeyMap;
	readonly launchpad: LaunchpadConfig;
	readonly liveshare: LiveshareConfig;
	readonly menus: boolean | MenuConfig;
	readonly mode: ModeConfig;
	readonly modes: ModesConfig | null;
	readonly outputLevel: OutputLevel;
	readonly partners: PartnersConfig | null;
	readonly plusFeatures: PlusFeaturesConfig;
	readonly proxy: ProxyConfig | null;
	readonly rebaseEditor: RebaseEditorConfig;
	readonly remotes: RemotesConfig[] | null;
	readonly showWhatsNewAfterUpgrades: boolean;
	readonly sortBranchesBy: BranchSorting;
	readonly sortContributorsBy: ContributorSorting;
	readonly sortTagsBy: TagSorting;
	readonly sortRepositoriesBy: RepositoriesSorting;
	readonly statusBar: StatusBarConfig;
	readonly strings: StringsConfig;
	readonly telemetry: TelemetryConfig;
	readonly terminal: TerminalConfig;
	readonly terminalLinks: TerminalLinksConfig;
	readonly views: ViewsConfig;
	readonly virtualRepositories: VirtualRepositoriesConfig;
	readonly visualHistory: VisualHistoryConfig;
	readonly worktrees: WorktreesConfig;
}

export type AnnotationsToggleMode = 'file' | 'window';
export type BlameHighlightLocations = 'gutter' | 'line' | 'overview';
export type BranchSorting = 'date:desc' | 'date:asc' | 'name:asc' | 'name:desc';
export type ChangesLocations = 'gutter' | 'line' | 'overview';

export type CodeLensCommands =
	| 'gitlens.copyRemoteCommitUrl'
	| 'gitlens.copyRemoteFileUrl'
	| 'gitlens.diffWithPrevious'
	| 'gitlens.openCommitOnRemote'
	| 'gitlens.openFileOnRemote'
	| 'gitlens.revealCommitInView'
	| 'gitlens.showCommitsInView'
	| 'gitlens.showQuickCommitDetails'
	| 'gitlens.showQuickCommitFileDetails'
	| 'gitlens.showQuickRepoHistory'
	| 'gitlens.showQuickFileHistory'
	| 'gitlens.toggleFileBlame'
	| 'gitlens.toggleFileChanges'
	| 'gitlens.toggleFileChangesOnly'
	| 'gitlens.toggleFileHeatmap';

export type CodeLensScopes = 'document' | 'containers' | 'blocks';
export type ContributorSorting =
	| 'count:desc'
	| 'count:asc'
	| 'date:desc'
	| 'date:asc'
	| 'name:asc'
	| 'name:desc'
	| 'score:desc'
	| 'score:asc';
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
export type GraphBranchesVisibility = 'all' | 'smart' | 'current' | 'favorited';
export type GraphMultiSelectionMode = boolean | 'topological';
export type GraphScrollMarkersAdditionalTypes =
	| 'localBranches'
	| 'remoteBranches'
	| 'stashes'
	| 'tags'
	| 'pullRequests';
export type GraphMinimapMarkersAdditionalTypes =
	| 'localBranches'
	| 'remoteBranches'
	| 'stashes'
	| 'tags'
	| 'pullRequests';
export type GravatarDefaultStyle = 'wavatar' | 'identicon' | 'monsterid' | 'mp' | 'retro' | 'robohash';
export type HeatmapLocations = 'gutter' | 'line' | 'overview';
export type KeyMap = 'alternate' | 'chorded' | 'none';

type DeprecatedOutputLevel =
	| /** @deprecated use `off` */ 'silent'
	| /** @deprecated use `error` */ 'errors'
	| /** @deprecated use `info` */ 'verbose';
export type OutputLevel = LogLevel | DeprecatedOutputLevel;

export type StatusBarCommands =
	| 'gitlens.copyRemoteCommitUrl'
	| 'gitlens.copyRemoteFileUrl'
	| 'gitlens.diffWithPrevious'
	| 'gitlens.diffWithWorking'
	| 'gitlens.openCommitOnRemote'
	| 'gitlens.openFileOnRemote'
	| 'gitlens.revealCommitInView'
	| 'gitlens.showCommitsInView'
	| 'gitlens.showQuickCommitDetails'
	| 'gitlens.showQuickCommitFileDetails'
	| 'gitlens.showQuickRepoHistory'
	| 'gitlens.showQuickFileHistory'
	| 'gitlens.toggleCodeLens'
	| 'gitlens.toggleFileBlame'
	| 'gitlens.toggleFileChanges'
	| 'gitlens.toggleFileChangesOnly'
	| 'gitlens.toggleFileHeatmap';

// NOTE: Must be kept in sync with `gitlens.advanced.messages` setting in the package.json
export type SuppressedMessages =
	| 'suppressBitbucketPRCommitLinksAppNotInstalledWarning'
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
	| 'suppressGkDisconnectedTooManyFailedRequestsWarningMessage'
	| 'suppressGkRequestFailed500Warning'
	| 'suppressGkRequestTimedOutWarning'
	| 'suppressIntegrationDisconnectedTooManyFailedRequestsWarning'
	| 'suppressIntegrationRequestFailed500Warning'
	| 'suppressIntegrationRequestTimedOutWarning'
	| 'suppressBlameInvalidIgnoreRevsFileWarning'
	| 'suppressBlameInvalidIgnoreRevsFileBadRevisionWarning';

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
		readonly gitPath: boolean;
	};
	readonly commitOrdering: 'date' | 'author-date' | 'topo' | null;
	readonly commits: {
		readonly delayLoadingFileDetails: boolean;
	};
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

interface AIConfig {
	readonly enabled: boolean;
	readonly experimental: {
		readonly composer: {
			readonly enabled: boolean;
		};
	};
	readonly azure: {
		readonly url: string | null;
	};
	readonly explainChanges: {
		readonly customInstructions: string;
	};
	readonly generateChangelog: {
		readonly customInstructions: string;
	};
	readonly generatePullRequestMessage: {
		readonly customInstructions: string;
		readonly enabled: boolean;
	};
	readonly generateCommitMessage: {
		readonly customInstructions: string;
		readonly enabled: boolean;
	};
	readonly generateStashMessage: {
		readonly customInstructions: string;
	};
	readonly generateCreateCloudPatch: {
		readonly customInstructions: string;
	};
	readonly generateCreateCodeSuggest: {
		readonly customInstructions: string;
	};
	readonly generateCreatePullRequest: {
		readonly customInstructions: string;
	};
	readonly generateSearchQuery: {
		readonly customInstructions: string;
	};
	readonly gitkraken: {
		readonly model: AIProviderAndModel | null;
	};
	readonly largePromptWarningThreshold: number;
	readonly model: SupportedAIModels | null;
	readonly modelOptions: {
		readonly temperature: number;
	};
	readonly ollama: {
		readonly url: string | null;
	};
	readonly openai: {
		readonly url: string | null;
	};
	readonly openaicompatible: {
		readonly url: string | null;
	};
	readonly vscode: {
		readonly model: AIProviderAndModel | null;
	};
}

export interface AutolinkConfig {
	/** Short prefix to match to generate autolinks for the external resource */
	readonly prefix: string;
	/** URL of the external resource to link to */
	readonly url: string;
	/** Whether alphanumeric characters should be allowed in `<num>` */
	readonly alphanumeric: boolean;
	/** Whether case should be ignored when matching the prefix */
	readonly ignoreCase: boolean;
	readonly title: string | null;
}

interface BlameConfig {
	readonly avatars: boolean;
	readonly compact: boolean;
	readonly dateFormat: DateTimeFormat | (string & object) | null;
	readonly fontFamily: string;
	readonly fontSize: number;
	readonly fontStyle: string;
	readonly fontWeight: string;
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
}

interface ChangesConfig {
	readonly locations: ChangesLocations[];
	/*readonly*/ toggleMode: AnnotationsToggleMode;
}

interface CloudIntegrationsConfig {
	readonly enabled: boolean;
}

interface CloudPatchesConfig {
	readonly enabled: boolean;
	readonly experimental: {
		readonly layout: 'editor' | 'view';
	};
}

export interface CodeLensConfig {
	readonly authors: {
		readonly enabled: boolean;
		readonly command: CodeLensCommands | false;
	};
	readonly dateFormat: DateTimeFormat | string | null;
	/*readonly*/ enabled: boolean;
	readonly includeSingleLineSymbols: boolean;
	readonly recentChange: {
		readonly enabled: boolean;
		readonly command: CodeLensCommands | false;
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

interface CurrentLineConfig {
	readonly dateFormat: string | null;
	/*readonly*/ enabled: boolean;
	readonly fontFamily: string;
	readonly fontSize: number;
	readonly fontStyle: string;
	readonly fontWeight: string;
	readonly format: string;
	readonly pullRequests: {
		readonly enabled: boolean;
	};
	readonly scrollable: boolean;
	readonly uncommittedChangesFormat: string | null;
}

interface DeepLinksConfig {
	readonly schemeOverride: boolean | string | null;
}

interface FileAnnotationsConfig {
	readonly preserveWhileEditing: boolean;
	readonly command: string | null;
	readonly dismissOnEscape: boolean;
}

interface GitCommandsConfig {
	readonly avatars: boolean;
	readonly closeOnFocusOut: boolean;
	readonly search: {
		readonly matchAll: boolean;
		readonly matchCase: boolean;
		readonly matchRegex: boolean;
		readonly matchWholeWord: boolean;
		readonly showResultsInSideBar: boolean | null;
	};
	readonly skipConfirmations: string[];
	readonly sortBy: GitCommandSorting;
}

interface GitKrakenConfig {
	readonly activeOrganizationId: string | null;
	readonly cli: GitKrakenCliConfig;
}

interface GitKrakenCliConfig {
	readonly integration: {
		readonly enabled: boolean;
	};
}

export interface GraphConfig {
	readonly allowMultiple: boolean;
	readonly avatars: boolean;
	readonly branchesVisibility: GraphBranchesVisibility;
	readonly commitOrdering: 'date' | 'author-date' | 'topo';
	readonly dateFormat: DateTimeFormat | string | null;
	readonly dateStyle: DateStyle | null;
	readonly defaultItemLimit: number;
	readonly dimMergeCommits: boolean;
	readonly experimental: {
		readonly renderer: {
			readonly enabled: boolean;
		};
	};
	readonly highlightRowsOnRefHover: boolean;
	readonly issues: {
		readonly enabled: boolean;
	};
	readonly layout: 'editor' | 'panel';
	readonly minimap: {
		readonly enabled: boolean;
		readonly dataType: 'commits' | 'lines';
		readonly additionalTypes: GraphMinimapMarkersAdditionalTypes[];
	};
	readonly multiselect: GraphMultiSelectionMode;
	readonly onlyFollowFirstParent: boolean;
	readonly pageItemLimit: number;
	readonly pullRequests: {
		readonly enabled: boolean;
	};
	readonly scrollMarkers: {
		readonly enabled: boolean;
		readonly additionalTypes: GraphScrollMarkersAdditionalTypes[];
	};
	readonly scrollRowPadding: number;
	readonly searchItemLimit: number;
	readonly showDetailsView: 'open' | 'selection' | false;
	readonly showGhostRefsOnRowHover: boolean;
	readonly showRemoteNames: boolean;
	readonly showUpstreamStatus: boolean;
	readonly sidebar: {
		readonly enabled: boolean;
	};
	readonly statusBar: {
		readonly enabled: boolean;
	};
}

interface HeatmapConfig {
	readonly ageThreshold: number;
	readonly coldColor: string;
	readonly hotColor: string;
	readonly fadeLines: boolean;
	readonly locations: HeatmapLocations[];
	/*readonly*/ toggleMode: AnnotationsToggleMode;
}

interface HomeConfig {
	readonly preview: {
		readonly enabled: boolean;
	};
}

interface HoversConfig {
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
}

interface IntegrationsConfig {
	readonly enabled: boolean;
}

interface LaunchpadConfig {
	readonly allowMultiple: boolean;
	readonly includedOrganizations: string[];
	readonly ignoredOrganizations: string[];
	readonly ignoredRepositories: string[];
	readonly staleThreshold: number | null;
	readonly indicator: {
		readonly enabled: boolean;
		readonly icon: 'default' | 'group';
		readonly label: false | 'item' | 'counts';
		readonly useColors: boolean;
		readonly groups: ('mergeable' | 'blocked' | 'needs-review' | 'follow-up')[];
		readonly polling: {
			enabled: boolean;
			interval: number;
		};
	};
	readonly experimental: {
		readonly queryLimit: number;
	};
}

interface LiveshareConfig {
	readonly enabled: boolean;
	readonly allowGuestAccess: boolean;
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
	readonly scmRepositoryInline:
		| false
		| {
				readonly generateCommitMessage: boolean;
				readonly graph: boolean;
				readonly stash: boolean;
		  };
	readonly scmRepository:
		| false
		| {
				readonly authors: boolean;
				readonly generateCommitMessage: boolean;
				readonly patch: boolean;
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
				readonly patch: boolean;
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

interface ModeConfig {
	readonly active: string;
	readonly statusBar: {
		readonly enabled: boolean;
		readonly alignment: 'left' | 'right';
	};
}

interface ModesConfig {
	readonly [key: string]: Mode;
}

export interface Mode {
	readonly name: string;
	readonly statusBarItemName?: string;
	readonly description?: string;
	readonly annotations?: 'blame' | 'changes' | 'heatmap';
	readonly codeLens?: boolean;
	readonly currentLine?: boolean;
	readonly hovers?: boolean;
	readonly statusBar?: boolean;
}

interface PartnersConfig {
	readonly [key: string]: {
		readonly enabled: boolean;
		readonly [key: string]: any;
	};
}

interface PlusFeaturesConfig {
	readonly enabled: boolean;
}

interface ProxyConfig {
	readonly url: string | null;
	readonly strictSSL: boolean;
}

interface RebaseEditorConfig {
	readonly ordering: 'asc' | 'desc';
	readonly showDetailsView: 'open' | 'selection' | false;
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
	readonly createPullRequest?: string;
	readonly file: string;
	readonly fileInBranch: string;
	readonly fileInCommit: string;
	readonly fileLine: string;
	readonly fileRange: string;
}

interface StatusBarConfig {
	readonly alignment: 'left' | 'right';
	readonly command: StatusBarCommands;
	readonly dateFormat: DateTimeFormat | (string & object) | null;
	/*readonly*/ enabled: boolean;
	readonly format: string;
	readonly reduceFlicker: boolean;
	readonly pullRequests: {
		readonly enabled: boolean;
	};
	readonly tooltipFormat: string;
}

interface StringsConfig {
	readonly codeLens: {
		readonly unsavedChanges: {
			readonly recentChangeAndAuthors: string;
			readonly recentChangeOnly: string;
			readonly authorsOnly: string;
		};
	};
}

interface TelemetryConfig {
	readonly enabled: boolean;
}

interface TerminalConfig {
	readonly overrideGitEditor: boolean;
}

interface TerminalLinksConfig {
	readonly enabled: boolean;
	readonly showDetailsView: boolean;
}

export interface ViewsCommonConfig {
	readonly collapseWorktreesWhenPossible: boolean;
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
			readonly tooltip: string;
		};
	};
	readonly multiselect: boolean;
	readonly openChangesInMultiDiffEditor: boolean;
	readonly pageItemLimit: number;
	readonly scm: {
		grouped: {
			readonly default: GroupableTreeViewTypes;
			readonly views: Record<GroupableTreeViewTypes, boolean>;
			readonly hiddenViews: Record<GroupableTreeViewTypes, boolean>;
		};
	};
	readonly showComparisonContributors: boolean;
	readonly showContributorsStatistics: boolean;
	readonly showCurrentBranchOnTop: boolean;
	readonly showRelativeDateMarkers: boolean;
}

export const viewsCommonConfigKeys: (keyof ViewsCommonConfig)[] = [
	'collapseWorktreesWhenPossible',
	'defaultItemLimit',
	'formats',
	'openChangesInMultiDiffEditor',
	'pageItemLimit',
	'showComparisonContributors',
	'showContributorsStatistics',
	'showCurrentBranchOnTop',
	'showRelativeDateMarkers',
];

interface ViewsConfigs {
	readonly branches: BranchesViewConfig;
	readonly commits: CommitsViewConfig;
	readonly commitDetails: CommitDetailsViewConfig;
	readonly contributors: ContributorsViewConfig;
	readonly drafts: DraftsViewConfig;
	readonly fileHistory: FileHistoryViewConfig;
	readonly launchpad: LaunchpadViewConfig;
	readonly lineHistory: LineHistoryViewConfig;
	readonly patchDetails: PatchDetailsViewConfig;
	readonly pullRequest: PullRequestViewConfig;
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
	'pullRequest',
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
		readonly compact: boolean;
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
	readonly showRemoteBranches: boolean;
	readonly showStashes: boolean;
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
	readonly showStashes: boolean;
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

export interface ContributorsViewConfig {
	readonly avatars: boolean;
	readonly files: ViewsFilesConfig;
	readonly maxWait: number;
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForCommits: boolean;
	};
	readonly reveal: boolean;
	readonly showAllBranches: boolean;
	readonly showStatistics: boolean;
}

export interface DraftsViewConfig {
	readonly avatars: boolean;
	readonly branches: undefined;
	readonly files: ViewsFilesConfig;
	readonly pullRequests: undefined;
	readonly reveal: undefined;
}

export interface FileHistoryViewConfig {
	readonly avatars: boolean;
	readonly files: ViewsFilesConfig;
	readonly mode: 'commits' | 'contributors';
	readonly pullRequests: {
		readonly enabled: boolean;
		readonly showForCommits: boolean;
	};
}

export interface LaunchpadViewConfig {
	readonly enabled: boolean;

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

export interface PatchDetailsViewConfig {
	readonly avatars: boolean;
	readonly files: ViewsFilesConfig;
}

export interface PullRequestViewConfig {
	readonly avatars: boolean;
	readonly branches: undefined;
	readonly files: ViewsFilesConfig;
	readonly pullRequests: undefined;
	readonly reveal: undefined;
	readonly showBranchComparison: undefined;
}

export interface RemotesViewConfig {
	readonly avatars: boolean;
	readonly branches: {
		readonly compact: boolean;
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
		readonly compact: boolean;
		readonly layout: ViewBranchesLayout;
		readonly showBranchComparison: false | Extract<ViewShowBranchComparison, 'branch'>;
		readonly showStashes: boolean;
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
	readonly worktrees: {
		readonly viewAs: ViewWorktreesViewAs;
	};
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
		readonly compact: boolean;
		readonly layout: ViewBranchesLayout;
	};
	readonly files: ViewsFilesConfig;
	readonly reveal: boolean;
}

export type ViewWorktreesViewAs = 'name' | 'path' | 'relativePath';

export interface WorktreesViewConfig {
	readonly avatars: boolean;
	readonly branches: {
		readonly compact: boolean;
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
	readonly showStashes: boolean;
	readonly worktrees: {
		readonly viewAs: ViewWorktreesViewAs;
	};
}

export interface WorkspacesViewConfig {
	readonly avatars: boolean;
	readonly branches: {
		readonly compact: boolean;
		readonly layout: ViewBranchesLayout;
		readonly showBranchComparison: false | Extract<ViewShowBranchComparison, 'branch'>;
		readonly showStashes: boolean;
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
	readonly worktrees: {
		readonly viewAs: ViewWorktreesViewAs;
	};
}

export interface ViewsFilesConfig {
	readonly compact: boolean;
	readonly icon: 'status' | 'type';
	readonly layout: ViewFilesLayout;
	readonly threshold: number;
}

interface VirtualRepositoriesConfig {
	readonly enabled: boolean;
}

interface VisualHistoryConfig {
	readonly allowMultiple: boolean;
	readonly queryLimit: number;
}

interface WorktreesConfig {
	readonly defaultLocation: string | null;
	readonly openAfterCreate: 'always' | 'alwaysNewWindow' | 'onlyWhenEmpty' | 'never' | 'prompt';
	readonly promptForLocation: boolean;
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

export type CoreConfig = {
	readonly editor: {
		readonly letterSpacing: number;
	};
	readonly files: {
		readonly encoding: string;
		readonly exclude: Record<string, boolean>;
	};
	readonly git: {
		readonly autoRepositoryDetection: boolean | 'subFolders' | 'openEditors';
		readonly enabled: boolean;
		readonly fetchOnPull: boolean;
		readonly path: string | string[] | null;
		readonly pullTags: boolean;
		readonly repositoryScanIgnoredFolders: string[];
		readonly repositoryScanMaxDepth: number;
		readonly useForcePushIfIncludes: boolean;
		readonly useForcePushWithLease: boolean;
	};
	readonly http: {
		readonly proxy: string;
		readonly proxySupport: 'fallback' | 'off' | 'on' | 'override';
		readonly proxyStrictSSL: boolean;
	};
	readonly search: {
		readonly exclude: Record<string, boolean>;
	};
	readonly workbench: {
		readonly editorAssociations: Record<string, string> | { viewType: string; filenamePattern: string }[];
		readonly tree: {
			readonly renderIndentGuides: 'always' | 'none' | 'onHover';
			readonly indent: number;
		};
	};
};
