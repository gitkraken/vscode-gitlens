'use strict';
import { FileAnnotationType } from './annotations/annotationController';
import { LineAnnotationType } from './currentLineController';
import { GitExplorerView } from './views/gitExplorer';
import { OutputLevel } from './logger';

export { ExtensionKey } from './constants';

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
    Blocks = 'blocks',
    Custom = 'custom'
}

export enum LineHighlightLocations {
    Gutter = 'gutter',
    Line = 'line',
    OverviewRuler = 'overviewRuler'
}

export enum CustomRemoteType {
    Bitbucket = 'Bitbucket',
    BitbucketServer = 'BitbucketServer',
    Custom = 'Custom',
    GitHub = 'GitHub',
    GitLab = 'GitLab'
}

export enum GitExplorerFilesLayout {
    Auto = 'auto',
    List = 'list',
    Tree = 'tree'
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
    name?: string;
    urls?: {
        repository: string;
        branches: string;
        branch: string;
        commit: string;
        file: string;
        fileInBranch: string;
        fileInCommit: string;
        fileLine: string;
        fileRange: string;
    };
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