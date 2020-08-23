'use strict';
import { TraceLevel } from './logger';

export interface Config {
	autolinks: AutolinkReference[] | null;
	blame: {
		avatars: boolean;
		compact: boolean;
		dateFormat: string | null;
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
		pullRequests: {
			enabled: boolean;
		};
		scrollable: boolean;
	};
	debug: boolean;
	defaultDateFormat: string | null;
	defaultDateShortFormat: string | null;
	defaultDateSource: DateSource;
	defaultDateStyle: DateStyle;
	defaultGravatarsStyle: GravatarDefaultStyle;
	gitCommands: {
		closeOnFocusOut: boolean;
		search: {
			matchAll: boolean;
			matchCase: boolean;
			matchRegex: boolean;
			showResultsInView: boolean;
		};
		skipConfirmations: string[];
	};
	heatmap: {
		ageThreshold: number;
		coldColor: string;
		hotColor: string;
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
	insiders: boolean;
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
	modes: Record<string, ModeConfig>;
	outputLevel: TraceLevel;
	remotes: RemotesConfig[] | null;
	showWhatsNewAfterUpgrades: boolean;
	sortBranchesBy: BranchSorting;
	sortTagsBy: TagSorting;
	statusBar: {
		alignment: 'left' | 'right';
		command: StatusBarCommand;
		dateFormat: string | null;
		enabled: boolean;
		format: string;
		reduceFlicker: boolean;
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
	views: ViewsConfig;
	advanced: AdvancedConfig;
}

export enum AnnotationsToggleMode {
	File = 'file',
	Window = 'window',
}

export interface AutolinkReference {
	prefix: string;
	url: string;
	title?: string;
	alphanumeric?: boolean;
	ignoreCase?: boolean;
}

export enum BlameHighlightLocations {
	Gutter = 'gutter',
	Line = 'line',
	Overview = 'overview',
}

export enum BranchSorting {
	NameDesc = 'name:desc',
	NameAsc = 'name:asc',
	DateDesc = 'date:desc',
	DateAsc = 'date:asc',
}

export enum ChangesLocations {
	Gutter = 'gutter',
	Overview = 'overview',
}

export enum CodeLensCommand {
	DiffWithPrevious = 'gitlens.diffWithPrevious',
	RevealCommitInView = 'gitlens.revealCommitInView',
	ShowCommitsInView = 'gitlens.showCommitsInView',
	ShowQuickCommitDetails = 'gitlens.showQuickCommitDetails',
	ShowQuickCommitFileDetails = 'gitlens.showQuickCommitFileDetails',
	ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
	ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
	ToggleFileBlame = 'gitlens.toggleFileBlame',
}

export enum CodeLensScopes {
	Document = 'document',
	Containers = 'containers',
	Blocks = 'blocks',
}

export enum CustomRemoteType {
	Bitbucket = 'Bitbucket',
	BitbucketServer = 'BitbucketServer',
	Custom = 'Custom',
	GitHub = 'GitHub',
	GitLab = 'GitLab',
}

export enum DateSource {
	Authored = 'authored',
	Committed = 'committed',
}

export enum DateStyle {
	Absolute = 'absolute',
	Relative = 'relative',
}

export enum FileAnnotationType {
	Blame = 'blame',
	Changes = 'changes',
	Heatmap = 'heatmap',
}

export enum GravatarDefaultStyle {
	Faces = 'wavatar',
	Geometric = 'identicon',
	Monster = 'monsterid',
	MysteryPerson = 'mp',
	Retro = 'retro',
	Robot = 'robohash',
}

export enum KeyMap {
	Alternate = 'alternate',
	Chorded = 'chorded',
	None = 'none',
}

export enum StatusBarCommand {
	DiffWithPrevious = 'gitlens.diffWithPrevious',
	DiffWithWorking = 'gitlens.diffWithWorking',
	RevealCommitInView = 'gitlens.revealCommitInView',
	ShowCommitsInView = 'gitlens.showCommitsInView',
	ShowQuickCommitDetails = 'gitlens.showQuickCommitDetails',
	ShowQuickCommitFileDetails = 'gitlens.showQuickCommitFileDetails',
	ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
	ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
	ToggleCodeLens = 'gitlens.toggleCodeLens',
	ToggleFileBlame = 'gitlens.toggleFileBlame',
}

export enum TagSorting {
	NameDesc = 'name:desc',
	NameAsc = 'name:asc',
	DateDesc = 'date:desc',
	DateAsc = 'date:asc',
}

export enum ViewBranchesLayout {
	List = 'list',
	Tree = 'tree',
}

export enum ViewFilesLayout {
	Auto = 'auto',
	List = 'list',
	Tree = 'tree',
}

export enum ViewLocation {
	Explorer = 'explorer',
	GitLens = 'gitlens',
	SourceControl = 'scm',
}

export enum ViewShowBranchComparison {
	Branch = 'branch',
	Working = 'working',
}

export interface AdvancedConfig {
	abbreviatedShaLength: number;
	blame: {
		customArguments: string[] | null;
		delayAfterEdit: number;
		sizeThresholdAfterEdit: number;
	};
	caching: {
		enabled: boolean;
	};
	fileHistoryFollowsRenames: boolean;
	fileHistoryShowAllBranches: boolean;
	maxListItems: number;
	maxSearchItems: number;
	messages: {
		suppressCommitHasNoPreviousCommitWarning: boolean;
		suppressCommitNotFoundWarning: boolean;
		suppressFileNotUnderSourceControlWarning: boolean;
		suppressGitDisabledWarning: boolean;
		suppressGitVersionWarning: boolean;
		suppressLineUncommittedWarning: boolean;
		suppressNoRepositoryWarning: boolean;
	};
	quickPick: {
		closeOnFocusOut: boolean;
	};
	repositorySearchDepth: number;
	similarityThreshold: number | null;
	useSymmetricDifferenceNotation: boolean;
}

export interface CodeLensConfig {
	authors: {
		enabled: boolean;
		command: CodeLensCommand | false;
	};
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
				details: boolean;
				history: boolean;
				remote: boolean;
		  };
	editorGroup:
		| false
		| {
				compare: boolean;
				history: boolean;
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
				authors: boolean;
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
	views?: boolean;
}

export interface RemotesConfig {
	domain: string;
	name?: string;
	protocol?: string;
	type: CustomRemoteType;
	urls?: RemotesUrlsConfig;
}

export interface RemotesUrlsConfig {
	repository: string;
	branches: string;
	branch: string;
	commit: string;
	file: string;
	fileInBranch: string;
	fileInCommit: string;
	fileLine: string;
	fileRange: string;
}

export interface ViewsCommonConfig {
	commitFileDescriptionFormat: string;
	commitFileFormat: string;
	commitDescriptionFormat: string;
	commitFormat: string;
	defaultItemLimit: number;
	pageItemLimit: number;
	showRelativeDateMarkers: boolean;
	stashFileDescriptionFormat: string;
	stashFileFormat: string;
	stashDescriptionFormat: string;
	stashFormat: string;
	statusFileDescriptionFormat: string;
	statusFileFormat: string;
}

export const viewsCommonConfigKeys: (keyof ViewsCommonConfig)[] = [
	'commitFileDescriptionFormat',
	'commitFileFormat',
	'commitDescriptionFormat',
	'commitFormat',
	'defaultItemLimit',
	'pageItemLimit',
	'showRelativeDateMarkers',
	'stashFileDescriptionFormat',
	'stashFileFormat',
	'stashDescriptionFormat',
	'stashFormat',
	'statusFileDescriptionFormat',
	'statusFileFormat',
];

interface ViewsConfigs {
	branches: BranchesViewConfig;
	compare: CompareViewConfig;
	contributors: ContributorsViewConfig;
	fileHistory: FileHistoryViewConfig;
	history: HistoryViewConfig;
	lineHistory: LineHistoryViewConfig;
	remotes: RemotesViewConfig;
	repositories: RepositoriesViewConfig;
	search: SearchViewConfig;
	stashes: StashesViewConfig;
	tags: TagsViewConfig;
}

export type ViewsConfigKeys = keyof ViewsConfigs;
export const viewsConfigKeys: ViewsConfigKeys[] = [
	'branches',
	'compare',
	'contributors',
	'fileHistory',
	'history',
	'lineHistory',
	'remotes',
	'repositories',
	'search',
	'stashes',
	'tags',
];

export type ViewsConfig = ViewsCommonConfig & ViewsConfigs;

type ViewsWithLocation = keyof Pick<
	ViewsConfigs,
	'compare' | 'fileHistory' | 'lineHistory' | 'repositories' | 'search'
>;

export const viewsWithLocationConfigKeys: ViewsWithLocation[] = [
	'compare',
	'fileHistory',
	'lineHistory',
	'repositories',
	'search',
];

export interface BranchesViewConfig {
	avatars: boolean;
	branches: {
		layout: ViewBranchesLayout;
	};
	files: ViewsFilesConfig;
	showTrackingBranch: boolean;
}

export interface CompareViewConfig {
	avatars: boolean;
	enabled: boolean;
	files: ViewsFilesConfig;
	location: ViewLocation;
}

export interface ContributorsViewConfig {
	avatars: boolean;
	files: ViewsFilesConfig;
}

export interface FileHistoryViewConfig {
	avatars: boolean;
	enabled: boolean;
	location: ViewLocation;
}

export interface HistoryViewConfig {
	avatars: boolean;
	branches: undefined;
	files: ViewsFilesConfig;
	showBranchComparison: false | ViewShowBranchComparison;
	showTrackingBranch: boolean;
}

export interface LineHistoryViewConfig {
	avatars: boolean;
	enabled: boolean;
	location: ViewLocation;
}

export interface RemotesViewConfig {
	avatars: boolean;
	branches: {
		layout: ViewBranchesLayout;
	};
	files: ViewsFilesConfig;
	showTrackingBranch: boolean;
}

export interface RepositoriesViewConfig {
	autoRefresh: boolean;
	autoReveal: boolean;
	avatars: boolean;
	branches: {
		layout: ViewBranchesLayout;
	};
	compact: boolean;
	enabled: boolean;
	files: ViewsFilesConfig;
	includeWorkingTree: boolean;
	location: ViewLocation;
	showBranchComparison: false | ViewShowBranchComparison;
	showTrackingBranch: boolean;
}

export interface SearchViewConfig {
	avatars: boolean;
	enabled: boolean;
	files: ViewsFilesConfig;
	location: ViewLocation;
}

export interface StashesViewConfig {
	avatars: boolean;
	files: ViewsFilesConfig;
}

export interface TagsViewConfig {
	avatars: boolean;
	branches: {
		layout: ViewBranchesLayout;
	};
	files: ViewsFilesConfig;
}

export interface ViewsFilesConfig {
	compact: boolean;
	layout: ViewFilesLayout;
	threshold: number;
}
