'use strict';

export const RepoPath = 'repoPath';

export type BuiltInCommands = 'cursorMove' | 'editor.action.showReferences' | 'editor.action.toggleRenderWhitespace' | 'editorScroll' | 'revealLine' | 'setContext' | 'vscode.diff' | 'vscode.executeDocumentSymbolProvider' | 'vscode.executeCodeLensProvider' | 'vscode.open';
export const BuiltInCommands = {
    CursorMove: 'cursorMove' as BuiltInCommands,
    Diff: 'vscode.diff' as BuiltInCommands,
    EditorScroll: 'editorScroll' as BuiltInCommands,
    ExecuteDocumentSymbolProvider: 'vscode.executeDocumentSymbolProvider' as BuiltInCommands,
    ExecuteCodeLensProvider: 'vscode.executeCodeLensProvider' as BuiltInCommands,
    Open: 'vscode.open' as BuiltInCommands,
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

export type WorkspaceState = 'repoPath';
export const WorkspaceState = {
    RepoPath: 'repoPath' as WorkspaceState
};