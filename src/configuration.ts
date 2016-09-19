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

export interface ICodeLensConfig {
    enabled: boolean;
    command: CodeLensCommand;
}

export interface ICodeLensesConfig {
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