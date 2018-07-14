'use strict';
import { commands, TextDocument, TextEditor, window } from 'vscode';

export const applicationInsightsKey = 'a9c302f8-6483-4d01-b92c-c159c799c679';
export const extensionId = 'gitlens';
export const extensionOutputChannelName = 'GitLens';
export const extensionQualifiedId = `eamodio.${extensionId}`;
export const extensionTerminalName = 'GitLens';

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
    ActiveFileStatus = 'gitlens:activeFileStatus',
    AnnotationStatus = 'gitlens:annotationStatus',
    CanToggleCodeLens = 'gitlens:canToggleCodeLens',
    Enabled = 'gitlens:enabled',
    ExplorersCanCompare = 'gitlens:explorers:canCompare',
    GitExplorer = 'gitlens:gitExplorer',
    GitExplorerAutoRefresh = 'gitlens:gitExplorer:autoRefresh',
    GitExplorerView = 'gitlens:gitExplorer:view',
    HasRemotes = 'gitlens:hasRemotes',
    HistoryExplorer = 'gitlens:historyExplorer',
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

export function getEditorIfActive(document: TextDocument): TextEditor | undefined {
    const editor = window.activeTextEditor;
    return editor != null && editor.document === document ? editor : undefined;
}

export function isActiveDocument(document: TextDocument): boolean {
    const editor = window.activeTextEditor;
    return editor != null && editor.document === document;
}

export function isTextEditor(editor: TextEditor): boolean {
    const scheme = editor.document.uri.scheme;
    return scheme !== DocumentSchemes.Output && scheme !== DocumentSchemes.DebugConsole;
}

export enum GlyphChars {
    AngleBracketLeftHeavy = '\u2770',
    AngleBracketRightHeavy = '\u2771',
    ArrowBack = '\u21a9',
    ArrowDown = '\u2193',
    ArrowDropRight = '\u2937',
    ArrowHeadRight = '\u27A4',
    ArrowLeft = '\u2190',
    ArrowLeftDouble = '\u21d0',
    ArrowLeftRight = '\u2194',
    ArrowLeftRightDouble = '\u21d4',
    ArrowLeftRightDoubleStrike = '\u21ce',
    ArrowLeftRightLong = '\u27f7',
    ArrowRight = '\u2192',
    ArrowRightDouble = '\u21d2',
    ArrowRightHollow = '\u21e8',
    ArrowUp = '\u2191',
    ArrowUpRight = '\u2197',
    ArrowsHalfLeftRight = '\u21cb',
    ArrowsHalfRightLeft = '\u21cc',
    ArrowsLeftRight = '\u21c6',
    ArrowsRightLeft = '\u21c4',
    Asterisk = '\u2217',
    Check = '\u2713',
    Dash = '\u2014',
    Dot = '\u2022',
    Ellipsis = '\u2026',
    MiddleEllipsis = '\u22EF',
    MuchGreaterThan = '\u226A',
    MuchLessThan = '\u22D8',
    Pencil = '\u270E',
    Space = '\u00a0',
    SpaceThin = '\u2009',
    SquareWithBottomShadow = '\u274F',
    SquareWithTopShadow = '\u2750',
    ZeroWidthSpace = '\u200b'
}

export enum GlobalState {
    GitLensVersion = 'gitlensVersion'
}

export const ImageExtensions = ['.png', '.gif', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.bmp'];

export enum WorkspaceState {
    GitExplorerAutoRefresh = 'gitlens:gitExplorer:autoRefresh',
    GitExplorerView = 'gitlens:gitExplorer:view',
    ResultsExplorerKeepResults = 'gitlens:resultsExplorer:keepResults'
}
