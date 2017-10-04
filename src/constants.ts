'use strict';
import { commands } from 'vscode';

export const ExtensionId = 'gitlens';
export const ExtensionKey = ExtensionId;
export const ExtensionOutputChannelName = 'GitLens';
export const QualifiedExtensionId = `eamodio.${ExtensionId}`;

export const ApplicationInsightsKey = 'a9c302f8-6483-4d01-b92c-c159c799c679';

export enum BuiltInCommands {
    CloseActiveEditor = 'workbench.action.closeActiveEditor',
    CloseAllEditors = 'workbench.action.closeAllEditors',
    CursorMove = 'cursorMove',
    Diff = 'vscode.diff',
    EditorScroll = 'editorScroll',
    ExecuteDocumentSymbolProvider = 'vscode.executeDocumentSymbolProvider',
    ExecuteCodeLensProvider = 'vscode.executeCodeLensProvider',
    Open = 'vscode.open',
    NextEditor = 'workbench.action.nextEditor',
    PreviewHtml = 'vscode.previewHtml',
    RevealLine = 'revealLine',
    SetContext = 'setContext',
    ShowReferences = 'editor.action.showReferences'
}

export enum CommandContext {
    AnnotationStatus = 'gitlens:annotationStatus',
    CanToggleCodeLens = 'gitlens:canToggleCodeLens',
    Enabled = 'gitlens:enabled',
    GitExplorerView = 'gitlens:gitExplorer:view',
    HasRemotes = 'gitlens:hasRemotes',
    IsBlameable = 'gitlens:isBlameable',
    IsRepository = 'gitlens:isRepository',
    IsTracked = 'gitlens:isTracked',
    Key = 'gitlens:key'
}

export function setCommandContext(key: CommandContext | string, value: any) {
    return commands.executeCommand(BuiltInCommands.SetContext, key, value);
}

export enum DocumentSchemes {
    File = 'file',
    Git = 'git',
    GitLensGit = 'gitlens-git'
}

export enum GlyphChars {
    ArrowBack = '\u21a9',
    ArrowDown = '\u2193',
    ArrowDropRight = '\u2937',
    ArrowLeft = '\u2190',
    ArrowLeftRight = '\u2194',
    ArrowRight = '\u2192',
    ArrowRightHollow = '\u21e8',
    ArrowUp = '\u2191',
    ArrowUpRight = '\u2197',
    Asterisk = '\u2217',
    Check = '\u2713',
    Dash = '\u2014',
    Dot = '\u2022',
    DoubleArrowLeft = '\u226A',
    DoubleArrowRight = '\u22D8',
    Ellipsis = '\u2026',
    MiddleEllipsis = '\u22EF',
    Pensil = '\u270E',
    Space = '\u00a0',
    SquareWithBottomShadow = '\u274F',
    SquareWithTopShadow = '\u2750',
    ZeroWidthSpace = '\u200b'
}

export enum GlobalState {
    GitLensVersion = 'gitlensVersion'
}

export enum WorkspaceState {
    GitExplorerView = 'gitlens:gitExplorer:view'
}