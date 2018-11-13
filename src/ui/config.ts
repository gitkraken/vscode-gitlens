'use strict';

export enum AnnotationsToggleMode {
    File = 'file',
    Window = 'window'
}

export enum CodeLensCommand {
    DiffWithPrevious = 'gitlens.diffWithPrevious',
    ShowQuickCommitDetails = 'gitlens.showQuickCommitDetails',
    ShowQuickCommitFileDetails = 'gitlens.showQuickCommitFileDetails',
    ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
    ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
    ToggleFileBlame = 'gitlens.toggleFileBlame'
}

export interface CodeLensLanguageScope {
    language: string | undefined;
    scopes?: CodeLensScopes[];
    symbolScopes?: string[];
}

export enum CodeLensScopes {
    Document = 'document',
    Containers = 'containers',
    Blocks = 'blocks'
}

export enum CustomRemoteType {
    Bitbucket = 'Bitbucket',
    BitbucketServer = 'BitbucketServer',
    Custom = 'Custom',
    GitHub = 'GitHub',
    GitLab = 'GitLab'
}

export enum DateStyle {
    Absolute = 'absolute',
    Relative = 'relative'
}

export enum ViewBranchesLayout {
    List = 'list',
    Tree = 'tree'
}

export enum ViewFilesLayout {
    Auto = 'auto',
    List = 'list',
    Tree = 'tree'
}

export enum FileAnnotationType {
    Blame = 'blame',
    Heatmap = 'heatmap',
    RecentChanges = 'recentChanges'
}

export enum GravatarDefaultStyle {
    Faces = 'wavatar',
    Geometric = 'identicon',
    Monster = 'monsterid',
    MysteryPerson = 'mp',
    Retro = 'retro',
    Robot = 'robohash'
}

export enum HighlightLocations {
    Gutter = 'gutter',
    Line = 'line',
    Overview = 'overview'
}

export enum KeyMap {
    Alternate = 'alternate',
    Chorded = 'chorded',
    None = 'none'
}

export enum LogLevel {
    Silent = 'silent',
    Errors = 'errors',
    Verbose = 'verbose',
    Debug = 'debug'
}

export enum StatusBarCommand {
    DiffWithPrevious = 'gitlens.diffWithPrevious',
    DiffWithWorking = 'gitlens.diffWithWorking',
    ShowQuickCommitDetails = 'gitlens.showQuickCommitDetails',
    ShowQuickCommitFileDetails = 'gitlens.showQuickCommitFileDetails',
    ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
    ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
    ToggleCodeLens = 'gitlens.toggleCodeLens',
    ToggleFileBlame = 'gitlens.toggleFileBlame'
}

export interface AdvancedConfig {
    blame: {
        customArguments: string[] | null;
        delayAfterEdit: number;
        sizeThresholdAfterEdit: number;
    };
    caching: {
        enabled: boolean;
    };
    fileHistoryFollowsRenames: boolean;
    maxListItems: number;
    messages: {
        suppressCommitHasNoPreviousCommitWarning: boolean;
        suppressCommitNotFoundWarning: boolean;
        suppressFileNotUnderSourceControlWarning: boolean;
        suppressGitDisabledWarning: boolean;
        suppressGitVersionWarning: boolean;
        suppressLineUncommittedWarning: boolean;
        suppressNoRepositoryWarning: boolean;
        suppressShowKeyBindingsNotice: boolean;
        suppressSupportGitLensNotification: boolean;
    };
    quickPick: {
        closeOnFocusOut: boolean;
    };
    repositorySearchDepth: number;
    telemetry: {
        enabled: boolean;
    };
}

export interface CodeLensConfig {
    authors: {
        enabled: boolean;
        command: CodeLensCommand;
    };
    enabled: boolean;
    includeSingleLineSymbols: boolean;
    recentChange: {
        enabled: boolean;
        command: CodeLensCommand;
    };
    scopes: CodeLensScopes[];
    scopesByLanguage: CodeLensLanguageScope[];
    symbolScopes: string[];
}

export interface ViewsConfig {
    avatars: boolean;
    fileHistory: FileHistoryViewConfig;
    files: {
        layout: ViewFilesLayout;
        compact: boolean;
        threshold: number;
    };
    commitFileFormat: string;
    commitFormat: string;
    compare: CompareViewConfig;
    // dateFormat: string | null;
    defaultItemLimit: number;
    lineHistory: LineHistoryViewConfig;
    repositories: RepositoriesViewConfig;
    search: SearchViewConfig;
    stashFileFormat: string;
    stashFormat: string;
    statusFileFormat: string;
}

export interface ViewsFilesConfig {
    compact: boolean;
    layout: ViewFilesLayout;
    threshold: number;
}

export interface FileHistoryViewConfig {
    avatars: boolean;
    enabled: boolean;
    location: 'explorer' | 'gitlens' | 'scm';
}

export interface LineHistoryViewConfig extends FileHistoryViewConfig {}

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
              compare: boolean;
              history: boolean;
              remote: boolean;
          };
    explorer:
        | false
        | {
              compare: boolean;
              history: boolean;
              remote: boolean;
          };
}

export interface ModeConfig {
    name: string;
    statusBarItemName?: string;
    description?: string;
    codeLens?: boolean;
    currentLine?: boolean;
    hovers?: boolean;
    statusBar?: boolean;
    views?: boolean;
}

export interface RepositoriesViewConfig {
    autoRefresh: boolean;
    autoReveal: boolean;
    branches: {
        layout: ViewBranchesLayout;
    };
    enabled: boolean;
    files: ViewsFilesConfig;
    includeWorkingTree: boolean;
    location: 'explorer' | 'gitlens' | 'scm';
    showTrackingBranch: boolean;
}

export interface CompareViewConfig {
    enabled: boolean;
    files: ViewsFilesConfig;
    location: 'explorer' | 'gitlens' | 'scm';
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

export interface SearchViewConfig {
    enabled: boolean;
    files: ViewsFilesConfig;
    location: 'explorer' | 'gitlens' | 'scm';
}

export interface Config {
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
            locations: HighlightLocations[];
        };
        ignoreWhitespace: boolean;
        separateLines: boolean;
        toggleMode: AnnotationsToggleMode;
    };
    currentLine: {
        scrollable: boolean;
        dateFormat: string | null;
        enabled: boolean;
        format: string;
    };
    codeLens: CodeLensConfig;
    debug: boolean;
    defaultDateFormat: string | null;
    defaultDateStyle: DateStyle;
    defaultGravatarsStyle: GravatarDefaultStyle;
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
        currentLine: {
            changes: boolean;
            details: boolean;
            enabled: boolean;
            over: 'line' | 'annotation';
        };
        avatars: boolean;
        enabled: boolean;
    };
    insiders: boolean;
    keymap: KeyMap;
    menus: boolean | MenuConfig;
    mode: {
        active: string;
        statusBar: {
            enabled: boolean;
            alignment: 'left' | 'right';
        };
    };
    modes: { [key: string]: ModeConfig };
    outputLevel: LogLevel;
    recentChanges: {
        highlight: {
            locations: HighlightLocations[];
        };
        toggleMode: AnnotationsToggleMode;
    };
    remotes: RemotesConfig[];
    showWhatsNewAfterUpgrades: boolean;
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
