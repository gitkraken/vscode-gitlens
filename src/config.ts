'use strict';

export enum CodeLensCommand {
    DiffWithPrevious = 'gitlens.diffWithPrevious',
    ShowQuickCommitDetails = 'gitlens.showQuickCommitDetails',
    ShowQuickCommitFileDetails = 'gitlens.showQuickCommitFileDetails',
    ShowQuickCurrentBranchHistory = 'gitlens.showQuickRepoHistory',
    ShowQuickFileHistory = 'gitlens.showQuickFileHistory',
    ToggleFileBlame = 'gitlens.toggleFileBlame'
}

export enum CodeLensLocations {
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

export enum ExplorerFilesLayout {
    Auto = 'auto',
    List = 'list',
    Tree = 'tree'
}

export enum FileAnnotationType {
    Gutter = 'gutter',
    Heatmap = 'heatmap',
    Hover = 'hover',
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

export enum KeyMap {
    Standard = 'standard',
    Chorded = 'chorded',
    None = 'none'
}

export enum LineAnnotationType {
    Trailing = 'trailing',
    Hover = 'hover'
}

export enum LineHighlightLocations {
    Gutter = 'gutter',
    Line = 'line',
    OverviewRuler = 'overviewRuler'
}

export enum OutputLevel {
    Silent = 'silent',
    Errors = 'errors',
    Verbose = 'verbose'
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
        suppressCommitHasNoPreviousCommitWarning: boolean,
        suppressCommitNotFoundWarning: boolean,
        suppressFileNotUnderSourceControlWarning: boolean,
        suppressGitVersionWarning: boolean,
        suppressLineUncommittedWarning: boolean,
        suppressNoRepositoryWarning: boolean,
        suppressResultsExplorerNotice: boolean,
        suppressUpdateNotice: boolean,
        suppressWelcomeNotice: boolean
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
    enabled: boolean;
    recentChange: {
        enabled: boolean;
        command: CodeLensCommand;
    };
    authors: {
        enabled: boolean;
        command: CodeLensCommand;
    };
    locations: CodeLensLocations[];
    customLocationSymbols: string[];
    perLanguageLocations: ICodeLensLanguageLocation[];
    debug: boolean;
}

export interface ICodeLensLanguageLocation {
    language: string | undefined;
    locations: CodeLensLocations[];
    customSymbols?: string[];
}

export interface IExplorerConfig {
    files: {
        layout: ExplorerFilesLayout;
        compact: boolean;
        threshold: number;
    };
    commitFormat: string;
    commitFileFormat: string;
    // dateFormat: string | null;
    gravatars: boolean;
    showTrackingBranch: boolean;
    stashFormat: string;
    stashFileFormat: string;
    statusFileFormat: string;
}

export interface IGitExplorerConfig extends IExplorerConfig {
    enabled: boolean;
    autoRefresh: boolean;
    includeWorkingTree: boolean;
    showTrackingBranch: boolean;
    view: GitExplorerView;
}

export interface IResultsExplorerConfig extends IExplorerConfig { }

export interface IRemotesConfig {
    type: CustomRemoteType;
    domain: string;
    name?: string;
    protocol?: string;
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
    annotations: {
        file: {
            gutter: {
                format: string;
                dateFormat: string | null;
                compact: boolean;
                gravatars: boolean;
                heatmap: {
                    enabled: boolean;
                    location: 'left' | 'right';
                };
                hover: {
                    details: boolean;
                    changes: boolean;
                    wholeLine: boolean;
                };
                separateLines: boolean;
            };

            hover: {
                details: boolean;
                changes: boolean;
                heatmap: {
                    enabled: boolean;
                };
            };

            recentChanges: {
                hover: {
                    details: boolean;
                    changes: boolean;
                };
            };
        };

        line: {
            hover: {
                details: boolean;
                changes: boolean;
            };

            trailing: {
                format: string;
                dateFormat: string | null;
                hover: {
                    details: boolean;
                    changes: boolean;
                    wholeLine: boolean;
                };
            };
        };
    };

    blame: {
        ignoreWhitespace: boolean;

        file: {
            annotationType: FileAnnotationType;
            lineHighlight: {
                enabled: boolean;
                locations: LineHighlightLocations[];
            };
        };

        line: {
            enabled: boolean;
            annotationType: LineAnnotationType;
        };
    };

    recentChanges: {
        file: {
            lineHighlight: {
                locations: LineHighlightLocations[];
            };
        }
    };

    codeLens: ICodeLensConfig;

    defaultDateFormat: string | null;
    defaultDateStyle: DateStyle;
    defaultGravatarsStyle: GravatarDefaultStyle;

    gitExplorer: IGitExplorerConfig;

    keymap: KeyMap;

    remotes: IRemotesConfig[];

    resultsExplorer: IResultsExplorerConfig;

    statusBar: {
        enabled: boolean;
        alignment: 'left' | 'right';
        command: StatusBarCommand;
        format: string;
        dateFormat: string | null;
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

    debug: boolean;
    insiders: boolean;
    outputLevel: OutputLevel;

    advanced: IAdvancedConfig;
}