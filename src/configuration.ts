'use strict'
import {Commands} from './constants';

export type BlameAnnotationStyle = 'compact' | 'expanded';
export const BlameAnnotationStyle = {
    Compact: 'compact' as BlameAnnotationStyle,
    Expanded: 'expanded' as BlameAnnotationStyle
}

export interface IBlameConfig {
    annotation: {
        style: BlameAnnotationStyle;
        sha: boolean;
        author: boolean;
        date: boolean;
    };
}

export type CodeLensCommand = 'gitlens.toggleBlame' | 'gitlens.showBlameHistory' | 'gitlens.diffWithPrevious' | 'git.viewFileHistory';
export const CodeLensCommand = {
    BlameAnnotate: Commands.ToggleBlame as CodeLensCommand,
    BlameExplorer: Commands.ShowBlameHistory as CodeLensCommand,
    DiffWithPrevious: Commands.DiffWithPrevious as CodeLensCommand,
    GitViewHistory: 'git.viewFileHistory' as CodeLensCommand
}

export type CodeLensLocation = 'all' | 'document+containers' | 'document' | 'custom';
export const CodeLensLocation = {
    All: 'all' as CodeLensLocation,
    DocumentAndContainers: 'document+containers' as CodeLensLocation,
    Document: 'document' as CodeLensLocation,
    Custom: 'custom' as CodeLensLocation,
}

export type CodeLensVisibility = 'auto' | 'ondemand' | 'off';
export const CodeLensVisibility = {
    Auto: 'auto' as CodeLensVisibility,
    OnDemand: 'ondemand' as CodeLensVisibility,
    Off: 'off' as CodeLensVisibility
}

export interface ICodeLensConfig {
    enabled: boolean;
    command: CodeLensCommand;
}

export interface ICodeLensesConfig {
    visibility: CodeLensVisibility;
    location: CodeLensLocation;
    locationCustomSymbols: string[];
    recentChange: ICodeLensConfig;
    authors: ICodeLensConfig;
}

export type StatusBarCommand = 'gitlens.toggleBlame' | 'gitlens.showBlameHistory' | 'gitlens.toggleCodeLens' | 'gitlens.diffWithPrevious' | 'git.viewFileHistory';
export const StatusBarCommand = {
    BlameAnnotate: Commands.ToggleBlame as StatusBarCommand,
    BlameExplorer: Commands.ShowBlameHistory as StatusBarCommand,
    DiffWithPrevious: Commands.DiffWithPrevious as StatusBarCommand,
    ToggleCodeLens: Commands.ToggleCodeLens as StatusBarCommand,
    GitViewHistory: 'git.viewFileHistory' as StatusBarCommand
}

export interface IStatusBarConfig {
    enabled: boolean;
    command: StatusBarCommand;
}

export interface IAdvancedConfig {
    caching: {
        enabled: boolean
    }
}

export interface IConfig {
    blame: IBlameConfig,
    codeLens: ICodeLensesConfig,
    statusBar: IStatusBarConfig,
    advanced: IAdvancedConfig
}