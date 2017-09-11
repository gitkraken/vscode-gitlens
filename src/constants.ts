'use strict';
import { commands } from 'vscode';

export const ExtensionId = 'gitlens';
export const ExtensionKey = ExtensionId;
export const ExtensionOutputChannelName = 'GitLens';
export const QualifiedExtensionId = `eamodio.${ExtensionId}`;

export const ApplicationInsightsKey = 'a9c302f8-6483-4d01-b92c-c159c799c679';

export type BuiltInCommands = 'cursorMove' |
    'editor.action.showReferences' |
    'editor.action.toggleRenderWhitespace' |
    'editorScroll' |
    'revealLine' |
    'setContext' |
    'vscode.diff' |
    'vscode.executeDocumentSymbolProvider' |
    'vscode.executeCodeLensProvider' |
    'vscode.open' |
    'vscode.previewHtml' |
    'workbench.action.closeActiveEditor' |
    'workbench.action.closeAllEditors' |
    'workbench.action.nextEditor';
export const BuiltInCommands = {
    CloseActiveEditor: 'workbench.action.closeActiveEditor' as BuiltInCommands,
    CloseAllEditors: 'workbench.action.closeAllEditors' as BuiltInCommands,
    CursorMove: 'cursorMove' as BuiltInCommands,
    Diff: 'vscode.diff' as BuiltInCommands,
    EditorScroll: 'editorScroll' as BuiltInCommands,
    ExecuteDocumentSymbolProvider: 'vscode.executeDocumentSymbolProvider' as BuiltInCommands,
    ExecuteCodeLensProvider: 'vscode.executeCodeLensProvider' as BuiltInCommands,
    Open: 'vscode.open' as BuiltInCommands,
    NextEditor: 'workbench.action.nextEditor' as BuiltInCommands,
    PreviewHtml: 'vscode.previewHtml' as BuiltInCommands,
    RevealLine: 'revealLine' as BuiltInCommands,
    SetContext: 'setContext' as BuiltInCommands,
    ShowReferences: 'editor.action.showReferences' as BuiltInCommands,
    ToggleRenderWhitespace: 'editor.action.toggleRenderWhitespace' as BuiltInCommands
};

export type CommandContext =
    'gitlens:annotationStatus' |
    'gitlens:canToggleCodeLens' |
    'gitlens:enabled' |
    'gitlens:hasRemotes' |
    'gitlens:gitExplorer:view' |
    'gitlens:isBlameable' |
    'gitlens:isRepository' |
    'gitlens:isTracked' |
    'gitlens:key';
export const CommandContext = {
    AnnotationStatus: 'gitlens:annotationStatus' as CommandContext,
    CanToggleCodeLens: 'gitlens:canToggleCodeLens' as CommandContext,
    Enabled: 'gitlens:enabled' as CommandContext,
    GitExplorerView: 'gitlens:gitExplorer:view' as CommandContext,
    HasRemotes: 'gitlens:hasRemotes' as CommandContext,
    IsBlameable: 'gitlens:isBlameable' as CommandContext,
    IsRepository: 'gitlens:isRepository' as CommandContext,
    IsTracked: 'gitlens:isTracked' as CommandContext,
    Key: 'gitlens:key' as CommandContext
};

export function setCommandContext(key: CommandContext | string, value: any) {
    return commands.executeCommand(BuiltInCommands.SetContext, key, value);
}

export type DocumentSchemes = 'file' | 'git' | 'gitlens-git';
export const DocumentSchemes = {
    File: 'file' as DocumentSchemes,
    Git: 'git' as DocumentSchemes,
    GitLensGit: 'gitlens-git' as DocumentSchemes
};

export type GlyphChars = '\u21a9' |
    '\u2193' |
    '\u2937' |
    '\u2190' |
    '\u2194' |
    '\u21e8' |
    '\u2191' |
    '\u2713' |
    '\u2014' |
    '\u2022' |
    '\u2026' |
    '\u00a0' |
    '\u200b';
export const GlyphChars = {
    ArrowBack: '\u21a9' as GlyphChars,
    ArrowDown: '\u2193' as GlyphChars,
    ArrowDropRight: '\u2937' as GlyphChars,
    ArrowLeft: '\u2190' as GlyphChars,
    ArrowLeftRight: '\u2194' as GlyphChars,
    ArrowRightHollow: '\u21e8' as GlyphChars,
    ArrowUp: '\u2191' as GlyphChars,
    Check: '\u2713' as GlyphChars,
    Dash: '\u2014' as GlyphChars,
    Dot: '\u2022' as GlyphChars,
    Ellipsis: '\u2026' as GlyphChars,
    Space: '\u00a0' as GlyphChars,
    ZeroWidthSpace: '\u200b' as GlyphChars
};

export type WorkspaceState = 'gitlensVersion';
export const WorkspaceState = {
    GitLensVersion: 'gitlensVersion' as WorkspaceState
};