'use strict';
import { FileAnnotationType } from './annotations/annotationController';
import { Commands } from './commands';
import { LineAnnotationType } from './currentLineController';
import { GitExplorerView } from './views/gitExplorer';
import { OutputLevel } from './logger';

export { ExtensionKey } from './constants';

export type CodeLensCommand =
    'gitlens.toggleFileBlame' |
    'gitlens.showBlameHistory' |
    'gitlens.showFileHistory' |
    'gitlens.diffWithPrevious' |
    'gitlens.showQuickCommitDetails' |
    'gitlens.showQuickCommitFileDetails' |
    'gitlens.showQuickFileHistory' |
    'gitlens.showQuickRepoHistory';
export const CodeLensCommand = {
    BlameAnnotate: Commands.ToggleFileBlame as CodeLensCommand,
    ShowBlameHistory: Commands.ShowBlameHistory as CodeLensCommand,
    ShowFileHistory: Commands.ShowFileHistory as CodeLensCommand,
    DiffWithPrevious: Commands.DiffWithPrevious as CodeLensCommand,
    ShowQuickCommitDetails: Commands.ShowQuickCommitDetails as CodeLensCommand,
    ShowQuickCommitFileDetails: Commands.ShowQuickCommitFileDetails as CodeLensCommand,
    ShowQuickFileHistory: Commands.ShowQuickFileHistory as CodeLensCommand,
    ShowQuickCurrentBranchHistory: Commands.ShowQuickCurrentBranchHistory as CodeLensCommand
};

export type CodeLensLocations = 'document' | 'containers' | 'blocks' | 'custom';
export const CodeLensLocations = {
    Document: 'document' as CodeLensLocations,
    Containers: 'containers' as CodeLensLocations,
    Blocks: 'blocks' as CodeLensLocations,
    Custom: 'custom' as CodeLensLocations
};

export type LineHighlightLocations = 'gutter' | 'line' | 'overviewRuler';
export const LineHighlightLocations = {
    Gutter: 'gutter' as LineHighlightLocations,
    Line: 'line' as LineHighlightLocations,
    OverviewRuler: 'overviewRuler' as LineHighlightLocations
};

export type CustomRemoteType =
    'Bitbucket' |
    'GitHub' |
    'GitLab';
export const CustomRemoteType = {
    Bitbucket: 'Bitbucket' as CustomRemoteType,
    BitbucketServer: 'BitbucketServer' as CustomRemoteType,
    GitHub: 'GitHub' as CustomRemoteType,
    GitLab: 'GitLab' as CustomRemoteType
};

export type GitExplorerFilesLayout =
    'auto' |
    'list' |
    'tree';
export const GitExplorerFilesLayout = {
    Auto: 'auto' as GitExplorerFilesLayout,
    List: 'list' as GitExplorerFilesLayout,
    Tree: 'tree' as GitExplorerFilesLayout
};

export type StatusBarCommand =
    'gitlens.toggleFileBlame' |
    'gitlens.showBlameHistory' |
    'gitlens.showFileHistory' |
    'gitlens.toggleCodeLens' |
    'gitlens.diffWithPrevious' |
    'gitlens.diffWithWorking' |
    'gitlens.showQuickCommitDetails' |
    'gitlens.showQuickCommitFileDetails' |
    'gitlens.showQuickFileHistory' |
    'gitlens.showQuickRepoHistory';
export const StatusBarCommand = {
    BlameAnnotate: Commands.ToggleFileBlame as StatusBarCommand,
    ShowBlameHistory: Commands.ShowBlameHistory as StatusBarCommand,
    ShowFileHistory: Commands.ShowFileHistory as CodeLensCommand,
    DiffWithPrevious: Commands.DiffWithPrevious as StatusBarCommand,
    DiffWithWorking: Commands.DiffWithWorking as StatusBarCommand,
    ToggleCodeLens: Commands.ToggleCodeLens as StatusBarCommand,
    ShowQuickCommitDetails: Commands.ShowQuickCommitDetails as StatusBarCommand,
    ShowQuickCommitFileDetails: Commands.ShowQuickCommitFileDetails as StatusBarCommand,
    ShowQuickFileHistory: Commands.ShowQuickFileHistory as StatusBarCommand,
    ShowQuickCurrentBranchHistory: Commands.ShowQuickCurrentBranchHistory as StatusBarCommand
};

export interface IAdvancedConfig {
    caching: {
        enabled: boolean;
        maxLines: number;
    };
    git: string;
    gitignore: {
        enabled: boolean;
    };
    maxQuickHistory: number;
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
    quickPick: {
        closeOnFocusOut: boolean;
    };
    telemetry: {
        enabled: boolean;
    };
    toggleWhitespace: {
        enabled: boolean;
    };
}

export interface ICodeLensLanguageLocation {
    language: string | undefined;
    locations: CodeLensLocations[];
    customSymbols?: string[];
}

export interface IGitExplorerConfig {
    enabled: boolean;
    view: GitExplorerView;
    files: {
        layout: GitExplorerFilesLayout;
        compact: boolean;
        threshold: number;
    };
    includeWorkingTree: boolean;
    showTrackingBranch: boolean;
    commitFormat: string;
    commitFileFormat: string;
    stashFormat: string;
    stashFileFormat: string;
    statusFileFormat: string;
    // dateFormat: string | null;
}

export interface IRemotesConfig {
    type: CustomRemoteType;
    domain: string;
}

export interface IThemeConfig {
    annotations: {
        file: {
            gutter: {
                separateLines: boolean;
                dark: {
                    backgroundColor: string | null;
                    foregroundColor: string;
                    uncommittedForegroundColor: string | null;
                };
                light: {
                    backgroundColor: string | null;
                    foregroundColor: string;
                    uncommittedForegroundColor: string | null;
                };
            };
        };

        line: {
            trailing: {
                dark: {
                    backgroundColor: string | null;
                    foregroundColor: string;
                };
                light: {
                    backgroundColor: string | null;
                    foregroundColor: string;
                };
            };
        };
    };

    lineHighlight: {
        dark: {
            backgroundColor: string;
            overviewRulerColor: string;
        };
        light: {
            backgroundColor: string;
            overviewRulerColor: string;
        };
    };
}

export const themeDefaults: IThemeConfig = {
    annotations: {
        file: {
            gutter: {
                separateLines: true,
                dark: {
                    backgroundColor: null,
                    foregroundColor: 'rgb(190, 190, 190)',
                    uncommittedForegroundColor: null
                },
                light: {
                    backgroundColor: null,
                    foregroundColor: 'rgb(116, 116, 116)',
                    uncommittedForegroundColor: null
                }
            }
        },
        line: {
            trailing: {
                dark: {
                    backgroundColor: null,
                    foregroundColor: 'rgba(153, 153, 153, 0.35)'
                },
                light: {
                    backgroundColor: null,
                    foregroundColor: 'rgba(153, 153, 153, 0.35)'
                }
            }
        }
    },
    lineHighlight: {
        dark: {
            backgroundColor: 'rgba(0, 188, 242, 0.2)',
            overviewRulerColor: 'rgba(0, 188, 242, 0.6)'
        },
        light: {
            backgroundColor: 'rgba(0, 188, 242, 0.2)',
            overviewRulerColor: 'rgba(0, 188, 242, 0.6)'
        }
    }
};

export interface IConfig {
    annotations: {
        file: {
            gutter: {
                format: string;
                dateFormat: string | null;
                compact: boolean;
                heatmap: {
                    enabled: boolean;
                    location: 'left' | 'right';
                };
                hover: {
                    details: boolean;
                    wholeLine: boolean;
                };
            };

            hover: {
                heatmap: {
                    enabled: boolean;
                };
                wholeLine: boolean;
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
                    changes: boolean;
                    details: boolean;
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

    codeLens: {
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
    };

    defaultDateFormat: string | null;

    gitExplorer: IGitExplorerConfig;

    remotes: IRemotesConfig[];

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

    theme: IThemeConfig;

    debug: boolean;
    insiders: boolean;
    outputLevel: OutputLevel;

    advanced: IAdvancedConfig;
}