'use strict';

export const ExtensionId = 'gitlens';
export const ExtensionKey = ExtensionId;
export const ExtensionOutputChannelName = 'GitLens';
export const QualifiedExtensionId = `eamodio.${ExtensionId}`;

export const ApplicationInsightsKey = 'a9c302f8-6483-4d01-b92c-c159c799c679';

export type BuiltInCommands = 'cursorMove' | 'editor.action.showReferences' | 'editor.action.toggleRenderWhitespace' | 'editorScroll' | 'revealLine' | 'setContext' | 'vscode.diff' | 'vscode.executeDocumentSymbolProvider' | 'vscode.executeCodeLensProvider' | 'vscode.open' | 'vscode.previewHtml' | 'workbench.action.closeActiveEditor' | 'workbench.action.nextEditor';
export const BuiltInCommands = {
    CloseActiveEditor: 'workbench.action.closeActiveEditor' as BuiltInCommands,
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

export type DocumentSchemes = 'file' | 'git' | 'gitlens-git';
export const DocumentSchemes = {
    File: 'file' as DocumentSchemes,
    Git: 'git' as DocumentSchemes,
    GitLensGit: 'gitlens-git' as DocumentSchemes
};

export type WorkspaceState = 'repoPath' | 'suppressGitVersionWarning' | 'suppressUpdateNotice' | 'suppressWelcomeNotice';
export const WorkspaceState = {
    GitLensVersion: 'gitlensVersion' as WorkspaceState,
    SuppressGitVersionWarning: 'suppressGitVersionWarning' as WorkspaceState,
    SuppressUpdateNotice: 'suppressUpdateNotice' as WorkspaceState,
    SuppressWelcomeNotice: 'suppressWelcomeNotice' as WorkspaceState
};