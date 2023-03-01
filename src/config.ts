import type { DateTimeFormat } from './system/date';
import { LogLevel } from './system/logger.constants';

export interface Config {
	autolinks: AutolinkReference[] | null;
	blame: {
		avatars: boolean;
		compact: boolean;
		dateFormat: DateTimeFormat | string | null;
		format: string;
		heatmap: {
			enabled: boolean;
			location: 'left' | 'right';
		};
		highlight: {
			enabled: boolean;
			locations: BlameHighlightLocations[];
		};
		ignoreWhitespace: boolean;
		separateLines: boolean;
		toggleMode: AnnotationsToggleMode;
	};
	changes: {
		locations: ChangesLocations[];
		toggleMode: AnnotationsToggleMode;
	};
	codeLens: CodeLensConfig;
	currentLine: {
		dateFormat: string | null;
		enabled: boolean;
		format: string;
		uncommittedChangesFormat: string | null;
		pullRequests: {
			enabled: boolean;
		};
		scrollable: boolean;
	};
	debug: boolean;
	deepLinks: {
		schemeOverride: boolean | string | null;
	};
	defaultDateFormat: DateTimeFormat | string | null;
	defaultDateLocale: string | null;
	defaultDateShortFormat: DateTimeFormat | string | null;
	defaultDateSource: DateSource;
	defaultDateStyle: DateStyle;
	defaultGravatarsStyle: GravatarDefaultStyle;
	defaultTimeFormat: DateTimeFormat | string | null;
	detectNestedRepositories: boolean;
	fileAnnotations: {
		command: string | null;
	};
	gitCommands: {
		closeOnFocusOut: boolean;
		search: {
			matchAll: boolean;
			matchCase: boolean;
			matchRegex: boolean;
			showResultsInSideBar: boolean | null;
		};
		skipConfirmations: string[];
		sortBy: GitCommandSorting;
	};
	graph: GraphConfig;
	heatmap: {
		ageThreshold: number;
		coldColor: string;
		hotColor: string;
		fadeLines: boolean;
		locations: HeatmapLocations[];
		toggleMode: AnnotationsToggleMode;
	};
	hovers: {
		annotations: {
			changes: boolean;
			details: boolean;
			enabled: boolean;
			over: 'line' | 'annotation';
		};
		autolinks: {
			enabled: boolean;
			enhanced: boolean;
		};
		currentLine: {
			changes: boolean;
			details: boolean;
			enabled: boolean;
			over: 'line' | 'annotation';
		};
		avatars: boolean;
		avatarSize: number;
		changesDiff: 'line' | 'hunk';
		detailsMarkdownFormat: string;
		enabled: boolean;
		pullRequests: {
			enabled: boolean;
		};
	};
	integrations: {
		enabled: boolean;
	};
	keymap: KeyMap;
	liveshare: {
		allowGuestAccess: boolean;
	};
	menus: boolean | MenuConfig;
	mode: {
		active: string;
		statusBar: {
			enabled: boolean;
			alignment: 'left' | 'right';
		};
	};
	modes: Record<string, ModeConfig> | null;
	outputLevel: OutputLevel;
	partners: Record<
		string,
		{
			enabled: boolean;
			[key: string]: any;
		}
	> | null;
	plusFeatures: {
		enabled: boolean;
	};
	proxy: {
		url: string | null;
		strictSSL: boolean;
	} | null;
	rebaseEditor: {
		ordering: 'asc' | 'desc';
		showDetailsView: 'open' | 'selection' | false;
	};
	remotes: RemotesConfig[] | null;
	showWelcomeOnInstall: boolean;
	showWhatsNewAfterUpgrades: boolean;
	sortBranchesBy: BranchSorting;
	sortContributorsBy: ContributorSorting;
	sortTagsBy: TagSorting;
	statusBar: {
		alignment: 'left' | 'right';
		command: StatusBarCommand;
		dateFormat: DateTimeFormat | string | null;
		enabled: boolean;
		format: string;
		reduceFlicker: boolean;
		pullRequests: {
			enabled: boolean;
		};
		tooltipFormat: string;
	};
	strings: {
		codeLens: {
			unsavedChanges: {
				recentChangeAndAuthors: string;
				recentChangeOnly: string;
				authorsOnly: string;
			};
		};
	};
	telemetry: {
		enabled: boolean;
	};
	terminal: {
		overrideGitEditor: boolean;
	};
	terminalLinks: {
		enabled: boolean;
		showDetailsView: boolean;
	};
	views: ViewsConfig;
	virtualRepositories: {
		enabled: boolean;
	};
	visualHistory: {
		queryLimit: number;
	};
	worktrees: {
		defaultLocation: string | null;
		openAfterCreate: 'always' | 'alwaysNewWindow' | 'onlyWhenEmpty' | 'never' | 'prompt';
		promptForLocation: boolean;
	};
	advanced: AdvancedConfig;
}

export const enum AnnotationsToggleMode {
	File = 'file',
	Window = 'window',
}

export const enum AutolinkType {
	Issue = 'Issue',
	PullRequest = 'PullRequest',
}

export interface AutolinkReference {
	prefix: string;
	url: string;
	title?: string;
	alphanumeric?: boolean;
	ignoreCase?: boolean;

	type?: AutolinkType;
	description?: string;
}

export const enum BlameHighlightLocations {
	Gutter = 'gutter',
	Line = 'line',
	Scrollbar = 'overview',
}

export const enum BranchSorting {
	DateDesc = 'date:desc',
	DateAsc = 'date:asc',
	NameAsc = 'name:asc',
	NameDesc = 'name:desc',
}

export const enum ChangesLocations {
	Gutter = 'gutter',
	Line = 'line',
	Scrollbar = 'overview',
}

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

export const enum CodeLensScopes {
	Document = 'document',
	Containers = 'containers',
	Blocks = 'blocks',
}

export const enum ContributorSorting {
	CountDesc = 'count:desc',
	CountAsc = 'count:asc',
	DateDesc = 'date:desc',
	DateAsc = 'date:asc',
	NameAsc = 'name:asc',
	NameDesc = 'name:desc',
}

export const enum CustomRemoteType {
	AzureDevOps = 'AzureDevOps',
	Bitbucket = 'Bitbucket',
	BitbucketServer = 'BitbucketServer',
	Custom = 'Custom',
	Gerrit = 'Gerrit',
	GoogleSource = 'GoogleSource',
	Gitea = 'Gitea',
	GitHub = 'GitHub',
	GitLab = 'GitLab',
}

export const enum DateSource {
	Authored = 'authored',
	Committed = 'committed',
}

export const enum DateStyle {
	Absolute = 'absolute',
	Relative = 'relative',
}

export const enum FileAnnotationType {
	Blame = 'blame',
	Changes = 'changes',
	Heatmap = 'heatmap',
}

export const enum GitCommandSorting {
	Name = 'name',
	Usage = 'usage',
}

export const enum GraphScrollMarkerTypes {
	Selection = 'selection',
	Head = 'head',
	LocalBranches = 'localBranches',
	RemoteBranches = 'remoteBranches',
	Highlights = 'highlights',
	Stashes = 'stashes',
	Tags = 'tags',
}

export const enum GraphMinimapTypes {
	Selection = 'selection',
	Head = 'head',
	LocalBranches = 'localBranches',
	RemoteBranches = 'remoteBranches',
	Highlights = 'highlights',
	Stashes = 'stashes',
	Tags = 'tags',
}

export const enum GravatarDefaultStyle {
	Faces = 'wavatar',
	Geometric = 'identicon',
	Monster = 'monsterid',
	MysteryPerson = 'mp',
	Retro = 'retro',
	Robot = 'robohash',
}

export const enum HeatmapLocations {
	Gutter = 'gutter',
	Line = 'line',
	Scrollbar = 'overview',
}

export const enum KeyMap {
	Alternate = 'alternate',
	Chorded = 'chorded',
	None = 'none',
}

export const enum OutputLevel {
	Silent = 'silent',
	Errors = 'errors',
	Verbose = 'verbose',
	Debug = 'debug',
}

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

export const enum TagSorting {
	DateDesc = 'date:desc',
	DateAsc = 'date:asc',
	NameAsc = 'name:asc',
	NameDesc = 'name:desc',
}

export const enum ViewBranchesLayout {
	List = 'list',
	Tree = 'tree',
}

export const enum ViewFilesLayout {
	Auto = 'auto',
	List = 'list',
	Tree = 'tree',
}

export const enum ViewShowBranchComparison {
	Branch = 'branch',
	Working = 'working',
}

export interface AdvancedConfig {
	abbreviatedShaLength: number;
	abbreviateShaOnCopy: boolean;
	blame: {
		customArguments: string[] | null;
		delayAfterEdit: number;
		sizeThresholdAfterEdit: number;
	};
	caching: {
		enabled: boolean;
	};
	commitOrdering: 'date' | 'author-date' | 'topo' | null;
	externalDiffTool: string | null;
	externalDirectoryDiffTool: string | null;
	fileHistoryFollowsRenames: boolean;
	fileHistoryShowAllBranches: boolean;
	maxListItems: number;
	maxSearchItems: number;
	messages: { [key in SuppressedMessages]: boolean };
	quickPick: {
		closeOnFocusOut: boolean;
	};
	repositorySearchDepth: number | null;
	similarityThreshold: number | null;
}

export interface GraphConfig {
	avatars: boolean;
	commitOrdering: 'date' | 'author-date' | 'topo';
	dateFormat: DateTimeFormat | string | null;
	dateStyle: DateStyle | null;
	defaultItemLimit: number;
	dimMergeCommits: boolean;
	experimental: {
		minimap: {
			enabled: boolean;
			additionalTypes: GraphMinimapTypes[];
		};
	};
	highlightRowsOnRefHover: boolean;
	scrollRowPadding: number;
	showDetailsView: 'open' | 'selection' | false;
	showGhostRefsOnRowHover: boolean;
	scrollMarkers: {
		enabled: boolean;
		additionalTypes: GraphScrollMarkerTypes[];
	};
	pullRequests: {
		enabled: boolean;
	};
	showRemoteNames: boolean;
	showUpstreamStatus: boolean;
	pageItemLimit: number;
	searchItemLimit: number;
	statusBar: {
		enabled: boolean;
	};
}

export interface CodeLensConfig {
	authors: {
		enabled: boolean;
		command: CodeLensCommand | false;
	};
	dateFormat: DateTimeFormat | string | null;
	enabled: boolean;
	includeSingleLineSymbols: boolean;
	recentChange: {
		enabled: boolean;
		command: CodeLensCommand | false;
	};
	scopes: CodeLensScopes[];
	scopesByLanguage: CodeLensLanguageScope[] | null;
	symbolScopes: string[];
}

export interface CodeLensLanguageScope {
	language: string | undefined;
	scopes?: CodeLensScopes[];
	symbolScopes?: string[];
}

export interface MenuConfig {
	editor:
		| false
		| {
				blame: boolean;
				clipboard: boolean;
				compare: boolean;
				history: boolean;
				remote: boolean;
		  };
	editorGroup:
		| false
		| {
				blame: boolean;
				compare: boolean;
		  };
	editorTab:
		| false
		| {
				clipboard: boolean;
				compare: boolean;
				history: boolean;
				remote: boolean;
		  };
	explorer:
		| false
		| {
				clipboard: boolean;
				compare: boolean;
				history: boolean;
				remote: boolean;
		  };
	scm:
		| false
		| {
				graph: boolean;
		  };
	scmTitleInline:
		| false
		| {
				graph: boolean;
		  };
	scmTitle:
		| false
		| {
				authors: boolean;
				graph: boolean;
		  };
	scmGroupInline:
		| false
		| {
				stash: boolean;
		  };
	scmGroup:
		| false
		| {
				compare: boolean;
				openClose: boolean;
				stash: boolean;
		  };
	scmItemInline:
		| false
		| {
				stash: boolean;
		  };
	scmItem:
		| false
		| {
				clipboard: boolean;
				compare: boolean;
				history: boolean;
				remote: boolean;
				stash: boolean;
		  };
}

export interface ModeConfig {
	name: string;
	statusBarItemName?: string;
	description?: string;
	annotations?: 'blame' | 'changes' | 'heatmap';
	codeLens?: boolean;
	currentLine?: boolean;
	hovers?: boolean;
	statusBar?: boolean;
}

export type RemotesConfig =
	| {
			domain: string;
			regex: null;
			name?: string;
			protocol?: string;
			type: CustomRemoteType;
			urls?: RemotesUrlsConfig;
			ignoreSSLErrors?: boolean | 'force';
	  }
	| {
			domain: null;
			regex: string;
			name?: string;
			protocol?: string;
			type: CustomRemoteType;
			urls?: RemotesUrlsConfig;
			ignoreSSLErrors?: boolean | 'force';
	  };

export interface RemotesUrlsConfig {
	repository: string;
	branches: string;
	branch: string;
	commit: string;
	comparison?: string;
	file: string;
	fileInBranch: string;
	fileInCommit: string;
	fileLine: string;
	fileRange: string;
}

// NOTE: Must be kept in sync with `gitlens.advanced.messages` setting in the package.json
export const enum SuppressedMessages {
	CommitHasNoPreviousCommitWarning = 'suppressCommitHasNoPreviousCommitWarning',
	CommitNotFoundWarning = 'suppressCommitNotFoundWarning',
	CreatePullRequestPrompt = 'suppressCreatePullRequestPrompt',
	SuppressDebugLoggingWarning = 'suppressDebugLoggingWarning',
	FileNotUnderSourceControlWarning = 'suppressFileNotUnderSourceControlWarning',
	GitDisabledWarning = 'suppressGitDisabledWarning',
	GitMissingWarning = 'suppressGitMissingWarning',
	GitVersionWarning = 'suppressGitVersionWarning',
	LineUncommittedWarning = 'suppressLineUncommittedWarning',
	NoRepositoryWarning = 'suppressNoRepositoryWarning',
	RebaseSwitchToTextWarning = 'suppressRebaseSwitchToTextWarning',
	IntegrationDisconnectedTooManyFailedRequestsWarning = 'suppressIntegrationDisconnectedTooManyFailedRequestsWarning',
	IntegrationRequestFailed500Warning = 'suppressIntegrationRequestFailed500Warning',
	IntegrationRequestTimedOutWarning = 'suppressIntegrationRequestTimedOutWarning',
}

export interface ViewsCommonConfig {
	defaultItemLimit: number;
	formats: {
		commits: {
			label: string;
			description: string;
			tooltip: string;
			tooltipWithStatus: string;
		};
		files: {
			label: string;
			description: string;
		};
		stashes: {
			label: string;
			description: string;
		};
	};
	pageItemLimit: number;
	showRelativeDateMarkers: boolean;

	experimental: {
		multiSelect: {
			enabled: boolean | null | undefined;
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
	branches: BranchesViewConfig;
	commits: CommitsViewConfig;
	commitDetails: CommitDetailsViewConfig;
	contributors: ContributorsViewConfig;
	fileHistory: FileHistoryViewConfig;
	lineHistory: LineHistoryViewConfig;
	remotes: RemotesViewConfig;
	repositories: RepositoriesViewConfig;
	searchAndCompare: SearchAndCompareViewConfig;
	stashes: StashesViewConfig;
	tags: TagsViewConfig;
	worktrees: WorktreesViewConfig;
}

export type ViewsConfigKeys = keyof ViewsConfigs;
export const viewsConfigKeys: ViewsConfigKeys[] = [
	'commits',
	'repositories',
	'fileHistory',
	'lineHistory',
	'branches',
	'remotes',
	'stashes',
	'tags',
	'contributors',
	'searchAndCompare',
	'worktrees',
];

export type ViewsConfig = ViewsCommonConfig & ViewsConfigs;

export interface BranchesViewConfig {
	avatars: boolean;
	branches: {
		layout: ViewBranchesLayout;
	};
	files: ViewsFilesConfig;
	pullRequests: {
		enabled: boolean;
		showForBranches: boolean;
		showForCommits: boolean;
	};
	reveal: boolean;
	showBranchComparison: false | ViewShowBranchComparison.Branch;
}

export interface CommitsViewConfig {
	avatars: boolean;
	branches: undefined;
	files: ViewsFilesConfig;
	pullRequests: {
		enabled: boolean;
		showForBranches: boolean;
		showForCommits: boolean;
	};
	reveal: boolean;
	showBranchComparison: false | ViewShowBranchComparison;
}

export interface CommitDetailsViewConfig {
	avatars: boolean;
	files: ViewsFilesConfig;
	autolinks: {
		enabled: boolean;
		enhanced: boolean;
	};
	pullRequests: {
		enabled: boolean;
	};
}

export interface ContributorsViewConfig {
	avatars: boolean;
	files: ViewsFilesConfig;
	pullRequests: {
		enabled: boolean;
		showForCommits: boolean;
	};
	reveal: boolean;
	showAllBranches: boolean;
	showStatistics: boolean;
}

export interface FileHistoryViewConfig {
	avatars: boolean;
	files: ViewsFilesConfig;
}

export interface LineHistoryViewConfig {
	avatars: boolean;
}

export interface RemotesViewConfig {
	avatars: boolean;
	branches: {
		layout: ViewBranchesLayout;
	};
	files: ViewsFilesConfig;
	pullRequests: {
		enabled: boolean;
		showForBranches: boolean;
		showForCommits: boolean;
	};
	reveal: boolean;
}

export interface RepositoriesViewConfig {
	autoRefresh: boolean;
	autoReveal: boolean;
	avatars: boolean;
	branches: {
		layout: ViewBranchesLayout;
		showBranchComparison: false | ViewShowBranchComparison.Branch;
	};
	compact: boolean;
	files: ViewsFilesConfig;
	includeWorkingTree: boolean;
	pullRequests: {
		enabled: boolean;
		showForBranches: boolean;
		showForCommits: boolean;
	};
	showBranchComparison: false | ViewShowBranchComparison;
	showBranches: boolean;
	showCommits: boolean;
	showContributors: boolean;
	showIncomingActivity: boolean;
	showRemotes: boolean;
	showStashes: boolean;
	showTags: boolean;
	showUpstreamStatus: boolean;
	showWorktrees: boolean;
}

export interface SearchAndCompareViewConfig {
	avatars: boolean;
	files: ViewsFilesConfig;
	pullRequests: {
		enabled: boolean;
		showForCommits: boolean;
	};
}

export interface StashesViewConfig {
	files: ViewsFilesConfig;
	reveal: boolean;
}

export interface TagsViewConfig {
	avatars: boolean;
	branches: {
		layout: ViewBranchesLayout;
	};
	files: ViewsFilesConfig;
	reveal: boolean;
}

export interface WorktreesViewConfig {
	avatars: boolean;
	files: ViewsFilesConfig;
	pullRequests: {
		enabled: boolean;
		showForBranches: boolean;
		showForCommits: boolean;
	};
	reveal: boolean;
	showBranchComparison: false | ViewShowBranchComparison.Branch;
}

export interface ViewsFilesConfig {
	compact: boolean;
	layout: ViewFilesLayout;
	threshold: number;
}

export function fromOutputLevel(level: LogLevel | OutputLevel): LogLevel {
	switch (level) {
		case OutputLevel.Silent:
			return LogLevel.Off;
		case OutputLevel.Errors:
			return LogLevel.Error;
		case OutputLevel.Verbose:
			return LogLevel.Info;
		case OutputLevel.Debug:
			return LogLevel.Debug;
		default:
			return level;
	}
}
