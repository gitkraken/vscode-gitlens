'use strict'

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
        useCodeActions: boolean;
    };
}

export type CodeLensCommand = 'blame.annotate' | 'blame.explorer' | 'git.history';
export const CodeLensCommand = {
    BlameAnnotate: 'blame.annotate' as CodeLensCommand,
    BlameExplorer: 'blame.explorer' as CodeLensCommand,
    GitHistory: 'git.history' as CodeLensCommand
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

export interface IAdvancedConfig {
    caching: {
        enabled: boolean
    }
}

export interface IConfig {
    blame: IBlameConfig,
    codeLens: ICodeLensesConfig,
    advanced: IAdvancedConfig
}