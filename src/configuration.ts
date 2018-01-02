'use strict';
import { Functions } from './system';
import { ConfigurationChangeEvent, ConfigurationTarget, Event, EventEmitter, ExtensionContext, Uri, workspace } from 'vscode';
import { FileAnnotationType } from './annotations/annotationController';
import { ExtensionKey } from './constants';
import { LineAnnotationType } from './currentLineController';
import { GitExplorerView } from './views/gitExplorer';
import { OutputLevel } from './logger';

export { ExtensionKey };

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

export enum DateStyle {
    Absolute = 'absolute',
    Relative = 'relative'
}

export enum ExplorerFilesLayout {
    Auto = 'auto',
    List = 'list',
    Tree = 'tree'
}

export enum GravatarDefault {
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
    messages: {
        suppressCommitHasNoPreviousCommitWarning: boolean,
        suppressCommitNotFoundWarning: boolean,
        suppressFileNotUnderSourceControlWarning: boolean,
        suppressGitVersionWarning: boolean,
        suppressLineUncommittedWarning: boolean,
        suppressNoRepositoryWarning: boolean,
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
    gravatarsDefault: GravatarDefault;
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

const emptyConfig: IConfig = {
    annotations: {
        file: {
            gutter: {
                format: '',
                dateFormat: null,
                compact: false,
                heatmap: {
                    enabled: false,
                    location: 'left'
                },
                hover: {
                    details: false,
                    changes: false,
                    wholeLine: false
                },
                separateLines: false
            },
            hover: {
                details: false,
                changes: false,
                heatmap: {
                    enabled: false
                }
            },
            recentChanges: {
                hover: {
                    details: false,
                    changes: false
                }
            }
        },
        line: {
            hover: {
                details: false,
                changes: false
            },
            trailing: {
                format: '',
                dateFormat: null,
                hover: {
                    details: false,
                    changes: false,
                    wholeLine: false
                }
            }
        }
    },
    blame: {
        ignoreWhitespace: false,
        file: {
            annotationType: 'gutter' as FileAnnotationType,
            lineHighlight: {
                enabled: false,
                locations: []
            }
        },
        line: {
            enabled: false,
            annotationType: 'trailing' as LineAnnotationType
        }
    },
    recentChanges: {
        file: {
            lineHighlight: {
                locations: []
            }
        }
    },
    codeLens: {
        enabled: false,
        recentChange: {
            enabled: false,
            command: CodeLensCommand.DiffWithPrevious
        },
        authors: {
            enabled: false,
            command: CodeLensCommand.DiffWithPrevious
        },
        locations: [],
        customLocationSymbols: [],
        perLanguageLocations: [],
        debug: false
    },
    defaultDateFormat: null,
    defaultDateStyle: 'relative' as DateStyle,
    gitExplorer: {
        autoRefresh: false,
        enabled: false,
        files: {
            layout: ExplorerFilesLayout.Auto,
            compact: false,
            threshold: 0
        },
        commitFormat: '',
        commitFileFormat: '',
        // dateFormat: string | null;
        gravatars: false,
        gravatarsDefault: 'robohash' as GravatarDefault,
        includeWorkingTree: false,
        showTrackingBranch: false,
        stashFormat: '',
        stashFileFormat: '',
        statusFileFormat: '',
        view: GitExplorerView.Auto
    },
    keymap: 'standard' as KeyMap,
    remotes: [],
    resultsExplorer: {
        files: {
            layout: ExplorerFilesLayout.Auto,
            compact: false,
            threshold: 0
        },
        commitFormat: '',
        commitFileFormat: '',
        // dateFormat: string | null;
        gravatars: false,
        gravatarsDefault: 'robohash' as GravatarDefault,
        showTrackingBranch: false,
        stashFormat: '',
        stashFileFormat: '',
        statusFileFormat: ''
    },
    statusBar: {
        enabled: false,
        alignment: 'left',
        command: StatusBarCommand.DiffWithPrevious,
        format: '',
        dateFormat: null
    },
    strings: {
        codeLens: {
            unsavedChanges: {
                recentChangeAndAuthors: '',
                recentChangeOnly: '',
                authorsOnly: ''
            }
        }
    },
    debug: false,
    insiders: false,
    outputLevel: 'verbose' as OutputLevel,
    advanced: {
        caching: {
            enabled: false,
            maxLines: 0
        },
        git: '',
        maxQuickHistory: 0,
        menus: {
            explorerContext: {
                fileDiff: false,
                history: false,
                remote: false
            },
            editorContext: {
                blame: false,
                copy: false,
                details: false,
                fileDiff: false,
                history: false,
                lineDiff: false,
                remote: false
            },
            editorTitle: {
                blame: false,
                fileDiff: false,
                history: false,
                status: false
            },
            editorTitleContext: {
                blame: false,
                fileDiff: false,
                history: false,
                remote: false
            }
        },
        messages: {
            suppressCommitHasNoPreviousCommitWarning: false,
            suppressCommitNotFoundWarning: false,
            suppressFileNotUnderSourceControlWarning: false,
            suppressGitVersionWarning: false,
            suppressLineUncommittedWarning: false,
            suppressNoRepositoryWarning: false,
            suppressUpdateNotice: false,
            suppressWelcomeNotice: false
        },
        quickPick: {
            closeOnFocusOut: false
        },
        repositorySearchDepth: 0,
        telemetry: {
            enabled: false
        }
    }
};

export class Configuration {

    static configure(context: ExtensionContext) {
        context.subscriptions.push(workspace.onDidChangeConfiguration(configuration.onConfigurationChanged, configuration));
    }

    private _onDidChange = new EventEmitter<ConfigurationChangeEvent>();
    get onDidChange(): Event<ConfigurationChangeEvent> {
        return this._onDidChange.event;
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        if (!e.affectsConfiguration(ExtensionKey, null!)) return;

        this._onDidChange.fire(e);
    }

    readonly initializingChangeEvent: ConfigurationChangeEvent = {
        affectsConfiguration: (section: string, resource?: Uri) => false
    };

    get<T>(section?: string, resource?: Uri | null, defaultValue?: T) {
        return defaultValue === undefined
            ? workspace.getConfiguration(section === undefined ? undefined : ExtensionKey, resource!).get<T>(section === undefined ? ExtensionKey : section)!
            : workspace.getConfiguration(section === undefined ? undefined : ExtensionKey, resource!).get<T>(section === undefined ? ExtensionKey : section, defaultValue)!;
    }

    changed(e: ConfigurationChangeEvent, section: string, resource?: Uri | null) {
        return e.affectsConfiguration(`${ExtensionKey}.${section}`, resource!);
    }

    initializing(e: ConfigurationChangeEvent) {
        return e === this.initializingChangeEvent;
    }

    inspect(section?: string, resource?: Uri | null) {
        return workspace.getConfiguration(section === undefined ? undefined : ExtensionKey, resource!).inspect(section === undefined ? ExtensionKey : section);
    }

    name<K extends keyof IConfig>(name: K) {
        return Functions.propOf(emptyConfig, name);
    }

    update(section: string, value: any, target: ConfigurationTarget) {
        return workspace.getConfiguration(ExtensionKey).update(section, value, target);
    }
}

export const configuration = new Configuration();