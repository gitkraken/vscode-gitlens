'use strict';
import { Commands } from './constants';

export type BlameAnnotationStyle = 'compact' | 'expanded';
export const BlameAnnotationStyle = {
    Compact: 'compact' as BlameAnnotationStyle,
    Expanded: 'expanded' as BlameAnnotationStyle
};

export interface IBlameConfig {
    annotation: {
        style: BlameAnnotationStyle;
        sha: boolean;
        author: boolean;
        date: boolean;
    };
}

export type CodeLensCommand = 'gitlens.toggleBlame' | 'gitlens.showBlameHistory' | 'gitlens.showFileHistory' | 'gitlens.diffWithPrevious' | 'git.viewFileHistory';
export const CodeLensCommand = {
    BlameAnnotate: Commands.ToggleBlame as CodeLensCommand,
    ShowBlameHistory: Commands.ShowBlameHistory as CodeLensCommand,
    ShowFileHistory: Commands.ShowFileHistory as CodeLensCommand,
    DiffWithPrevious: Commands.DiffWithPrevious as CodeLensCommand,
    GitViewHistory: 'git.viewFileHistory' as CodeLensCommand
};

export type CodeLensLocation = 'all' | 'document+containers' | 'document' | 'custom' | 'none';
export const CodeLensLocation = {
    All: 'all' as CodeLensLocation,
    DocumentAndContainers: 'document+containers' as CodeLensLocation,
    Document: 'document' as CodeLensLocation,
    Custom: 'custom' as CodeLensLocation,
    None: 'none' as CodeLensLocation
};

export type CodeLensVisibility = 'auto' | 'ondemand' | 'off';
export const CodeLensVisibility = {
    Auto: 'auto' as CodeLensVisibility,
    OnDemand: 'ondemand' as CodeLensVisibility,
    Off: 'off' as CodeLensVisibility
};

export interface ICodeLensConfig {
    enabled: boolean;
    command: CodeLensCommand;
}

export interface ICodeLensLanguageLocation {
    language: string;
    location: CodeLensLocation;
    customSymbols?: string[];
}

export interface ICodeLensesConfig {
    visibility: CodeLensVisibility;
    location: CodeLensLocation;
    locationCustomSymbols: string[];
    languageLocations: ICodeLensLanguageLocation[];
    recentChange: ICodeLensConfig;
    authors: ICodeLensConfig;
}

export type StatusBarCommand = 'gitlens.toggleBlame' | 'gitlens.showBlameHistory' | 'gitlens.showFileHistory' | 'gitlens.toggleCodeLens' | 'gitlens.diffWithPrevious' | 'git.viewFileHistory';
export const StatusBarCommand = {
    BlameAnnotate: Commands.ToggleBlame as StatusBarCommand,
    ShowBlameHistory: Commands.ShowBlameHistory as StatusBarCommand,
    ShowFileHistory: Commands.ShowFileHistory as CodeLensCommand,
    DiffWithPrevious: Commands.DiffWithPrevious as StatusBarCommand,
    ToggleCodeLens: Commands.ToggleCodeLens as StatusBarCommand,
    GitViewHistory: 'git.viewFileHistory' as StatusBarCommand
};

export interface IStatusBarConfig {
    enabled: boolean;
    command: StatusBarCommand;
}

export type OutputLevel = 'silent' | 'errors' | 'verbose';
export const OutputLevel = {
    Silent: 'silent' as OutputLevel,
    Errors: 'errors' as OutputLevel,
    Verbose: 'verbose' as OutputLevel
};

export interface IAdvancedConfig {
    caching: {
        enabled: boolean;
        statusBar: {
            maxLines: number;
        }
    };
    debug: boolean;
    git: string;
    output: {
        level: OutputLevel;
    };
}

export interface IConfig {
    blame: IBlameConfig;
    codeLens: ICodeLensesConfig;
    statusBar: IStatusBarConfig;
    advanced: IAdvancedConfig;
}