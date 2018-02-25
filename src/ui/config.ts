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
    scopes: CodeLensScopes[];
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

export enum ExplorerBranchesLayout {
    List = 'list',
    Tree = 'tree'
}

export enum ExplorerFilesLayout {
    Auto = 'auto',
    List = 'list',
    Tree = 'tree'
}

export enum FileAnnotationType {
    Blame = 'blame',
    Heatmap = 'heatmap',
    RecentChanges = 'recentChanges'
}

export enum GitExplorerView {
    Auto = 'auto',
    History = 'history',
    Repository = 'repository'
}

export enum GravatarDefaultStyle {
    Faces = 'wavatar',
    Geometric = 'identicon',
    Monster = 'monsterid',
    MysteryMan = 'mm',
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

export enum OutputLevel {
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

export interface IAdvancedConfig {
    blame: {
        delayAfterEdit: number;
        sizeThresholdAfterEdit: number;
    };

    caching: {
        enabled: boolean;
    };

    git: string;
    fileHistoryFollowsRenames: boolean;
    maxListItems: number;

    menus: {
        explorerContext: {
            fileDiff: boolean;
            history: boolean;
            remote: boolean;
        };
        editorContext: {
            blame: boolean;
            copy: boolean;
            details: boolean;
            fileDiff: boolean;
            history: boolean;
            lineDiff: boolean;
            remote: boolean;
        };
        editorTitle: {
            blame: boolean;
            fileDiff: boolean;
            history: boolean;
            status: boolean;
        };
        editorTitleContext: {
            blame: boolean;
            fileDiff: boolean;
            history: boolean;
            remote: boolean;
        };
    };

    messages: {
        suppressCommitHasNoPreviousCommitWarning: boolean;
        suppressCommitNotFoundWarning: boolean;
        suppressFileNotUnderSourceControlWarning: boolean;
        suppressGitVersionWarning: boolean;
        suppressLineUncommittedWarning: boolean;
        suppressNoRepositoryWarning: boolean;
        suppressResultsExplorerNotice: boolean;
    };

    quickPick: {
        closeOnFocusOut: boolean;
    };

    repositorySearchDepth: number;

    telemetry: {
        enabled: boolean;
    };
}

export interface ICodeLensConfig {
    authors: {
        enabled: boolean;
        command: CodeLensCommand;
    };

    enabled: boolean;

    recentChange: {
        enabled: boolean;
        command: CodeLensCommand;
    };

    scopes: CodeLensScopes[];
    scopesByLanguage: CodeLensLanguageScope[];
    symbolScopes: string[];
}

export interface IExplorersConfig {
    avatars: boolean;

    files: {
        layout: ExplorerFilesLayout;
        compact: boolean;
        threshold: number;
    };

    commitFileFormat: string;
    commitFormat: string;
    // dateFormat: string | null;

    stashFileFormat: string;
    stashFormat: string;
    statusFileFormat: string;
}

export interface IExplorersFilesConfig {
    compact: boolean;
    layout: ExplorerFilesLayout;
    threshold: number;
}

export interface IGitExplorerConfig {
    autoRefresh: boolean;

    branches: {
        layout: ExplorerBranchesLayout;
    };

    enabled: boolean;
    files: IExplorersFilesConfig;
    includeWorkingTree: boolean;
    showTrackingBranch: boolean;
    view: GitExplorerView;
}

export interface IResultsExplorerConfig {
    files: IExplorersFilesConfig;
}

export interface IRemotesConfig {
    domain: string;
    name?: string;
    protocol?: string;
    type: CustomRemoteType;
    urls?: IRemotesUrlsConfig;
}

export interface IRemotesUrlsConfig {
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

export interface IConfig {
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
        dateFormat: string | null;
        enabled: boolean;
        format: string;
    };

    codeLens: ICodeLensConfig;

    debug: boolean;
    defaultDateFormat: string | null;
    defaultDateStyle: DateStyle;
    defaultGravatarsStyle: GravatarDefaultStyle;

    explorers: IExplorersConfig;

    gitExplorer: IGitExplorerConfig;

    heatmap: {
        toggleMode: AnnotationsToggleMode;
    };

    hovers: {
        annotations: {
            changes: boolean;
            details: boolean;
            enabled: boolean;
            over: 'line' | 'annotation'
        };

        currentLine: {
            changes: boolean;
            details: boolean;
            enabled: boolean;
            over: 'line' | 'annotation'
        };

        enabled: boolean;
    };

    insiders: boolean;
    keymap: KeyMap;
    outputLevel: OutputLevel;

    recentChanges: {
        highlight: {
            locations: HighlightLocations[];
        };
        toggleMode: AnnotationsToggleMode;
    };

    remotes: IRemotesConfig[];

    resultsExplorer: IResultsExplorerConfig;

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

    advanced: IAdvancedConfig;
}