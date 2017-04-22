'use strict';
import { Commands } from './commands';
import { OutputLevel } from './logger';

export type BlameAnnotationStyle = 'compact' | 'expanded' | 'trailing';
export const BlameAnnotationStyle = {
    Compact: 'compact' as BlameAnnotationStyle,
    Expanded: 'expanded' as BlameAnnotationStyle,
    Trailing: 'trailing' as BlameAnnotationStyle
};

export interface IBlameConfig {
    annotation: {
        style: BlameAnnotationStyle;
        highlight: 'none' | 'gutter' | 'line' | 'both';
        sha: boolean;
        author: boolean;
        date: 'off' | 'relative' | 'absolute';
        dateFormat: string;
        message: boolean;
        activeLine: 'off' | 'inline' | 'hover' | 'both';
        activeLineDarkColor: string;
        activeLineLightColor: string;
    };
}

export type CodeLensCommand = 'gitlens.toggleBlame' | 'gitlens.showBlameHistory' | 'gitlens.showFileHistory' | 'gitlens.diffWithPrevious' | 'gitlens.showQuickCommitDetails' | 'gitlens.showQuickCommitFileDetails' | 'gitlens.showQuickFileHistory' | 'gitlens.showQuickRepoHistory';
export const CodeLensCommand = {
    BlameAnnotate: Commands.ToggleBlame as CodeLensCommand,
    ShowBlameHistory: Commands.ShowBlameHistory as CodeLensCommand,
    ShowFileHistory: Commands.ShowFileHistory as CodeLensCommand,
    DiffWithPrevious: Commands.DiffWithPrevious as CodeLensCommand,
    ShowQuickCommitDetails: Commands.ShowQuickCommitDetails as CodeLensCommand,
    ShowQuickCommitFileDetails: Commands.ShowQuickCommitFileDetails as CodeLensCommand,
    ShowQuickFileHistory: Commands.ShowQuickFileHistory as CodeLensCommand,
    ShowQuickCurrentBranchHistory: Commands.ShowQuickCurrentBranchHistory as CodeLensCommand
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
    debug: boolean;
    visibility: CodeLensVisibility;
    location: CodeLensLocation;
    locationCustomSymbols: string[];
    languageLocations: ICodeLensLanguageLocation[];
    recentChange: ICodeLensConfig;
    authors: ICodeLensConfig;
}

export type StatusBarCommand = 'gitlens.toggleBlame' | 'gitlens.showBlameHistory' | 'gitlens.showFileHistory' | 'gitlens.toggleCodeLens' | 'gitlens.diffWithPrevious' | 'gitlens.showQuickCommitDetails' | 'gitlens.showQuickCommitFileDetails' | 'gitlens.showQuickFileHistory' | 'gitlens.showQuickRepoHistory';
export const StatusBarCommand = {
    BlameAnnotate: Commands.ToggleBlame as StatusBarCommand,
    ShowBlameHistory: Commands.ShowBlameHistory as StatusBarCommand,
    ShowFileHistory: Commands.ShowFileHistory as CodeLensCommand,
    DiffWithPrevious: Commands.DiffWithPrevious as StatusBarCommand,
    ToggleCodeLens: Commands.ToggleCodeLens as StatusBarCommand,
    ShowQuickCommitDetails: Commands.ShowQuickCommitDetails as StatusBarCommand,
    ShowQuickCommitFileDetails: Commands.ShowQuickCommitFileDetails as StatusBarCommand,
    ShowQuickFileHistory: Commands.ShowQuickFileHistory as StatusBarCommand,
    ShowQuickCurrentBranchHistory: Commands.ShowQuickCurrentBranchHistory as StatusBarCommand
};

export interface IStatusBarConfig {
    enabled: boolean;
    command: StatusBarCommand;
    date: 'off' | 'relative' | 'absolute';
    dateFormat: string;
}

export interface IAdvancedConfig {
    caching: {
        enabled: boolean;
        statusBar: {
            maxLines: number;
        }
    };
    git: string;
    gitignore: {
        enabled: boolean;
    };
    maxQuickHistory: number;
    quickPick: {
        closeOnFocusOut: boolean;
    };
    toggleWhitespace: {
        enabled: boolean;
    };
}

export interface IConfig {
    debug: boolean;
    outputLevel: OutputLevel;
    blame: IBlameConfig;
    codeLens: ICodeLensesConfig;
    statusBar: IStatusBarConfig;
    advanced: IAdvancedConfig;
    insiders: boolean;
}