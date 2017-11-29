'use strict';
import { commands, TextEditor } from 'vscode';

export const ExtensionId = 'gitlens';
export const ExtensionKey = ExtensionId;
export const ExtensionOutputChannelName = 'GitLens';
export const ExtensionTerminalName = 'GitLens';
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
    ActiveHasRemote = 'gitlens:activeHasRemote',
    ActiveIsBlameable = 'gitlens:activeIsBlameable',
    ActiveFileIsTracked = 'gitlens:activeIsTracked',
    AnnotationStatus = 'gitlens:annotationStatus',
    CanToggleCodeLens = 'gitlens:canToggleCodeLens',
    Enabled = 'gitlens:enabled',
    ExplorersCanCompare = 'gitlens:explorers:canCompare',
    GitExplorer = 'gitlens:gitExplorer',
    GitExplorerAutoRefresh = 'gitlens:gitExplorer:autoRefresh',
    GitExplorerView = 'gitlens:gitExplorer:view',
    HasRemotes = 'gitlens:hasRemotes',
    HasRepository = 'gitlens:hasRepository',
    Key = 'gitlens:key',
    KeyMap = 'gitlens:keymap',
    ResultsExplorer = 'gitlens:resultsExplorer',
    ResultsExplorerKeepResults = 'gitlens:resultsExplorer:keepResults'
}

export function setCommandContext(key: CommandContext | string, value: any) {
    return commands.executeCommand(BuiltInCommands.SetContext, key, value);
}

export enum DocumentSchemes {
    DebugConsole = 'debug',
    File = 'file',
    Git = 'git',
    GitLensGit = 'gitlens-git',
    Output = 'output'
}

export function isTextEditor(editor: TextEditor): boolean {
    const scheme = editor.document.uri.scheme;
    return scheme !== DocumentSchemes.Output && scheme !== DocumentSchemes.DebugConsole;
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
    GitExplorerAutoRefresh = 'gitlens:gitExplorer:autoRefresh',
    GitExplorerView = 'gitlens:gitExplorer:view',
    ResultsExplorerKeepResults = 'gitlens:resultsExplorer:keepResults'
}