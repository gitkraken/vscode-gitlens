'use strict'

export const DiagnosticCollectionName = 'gitlens';
export const DiagnosticSource = 'GitLens';
export const RepoPath = 'repoPath';

export type BuiltInCommands = 'cursorMove' | 'vscode.diff' | 'vscode.executeDocumentSymbolProvider' | 'vscode.executeCodeLensProvider' | 'editor.action.showReferences' | 'editor.action.toggleRenderWhitespace';
export const BuiltInCommands = {
    CursorMove: 'cursorMove' as BuiltInCommands,
    Diff: 'vscode.diff' as BuiltInCommands,
    ExecuteDocumentSymbolProvider: 'vscode.executeDocumentSymbolProvider' as BuiltInCommands,
    ExecuteCodeLensProvider: 'vscode.executeCodeLensProvider' as BuiltInCommands,
    ShowReferences: 'editor.action.showReferences' as BuiltInCommands,
    ToggleRenderWhitespace: 'editor.action.toggleRenderWhitespace' as BuiltInCommands
}

export type Commands = 'gitlens.diffWithPrevious' | 'gitlens.diffWithWorking' | 'gitlens.showBlame' | 'gitlens.showHistory' | 'gitlens.toggleBlame';
export const Commands = {
    DiffWithPrevious: 'gitlens.diffWithPrevious' as Commands,
    DiffWithWorking: 'gitlens.diffWithWorking' as Commands,
    ShowBlame: 'gitlens.showBlame' as Commands,
    ShowBlameHistory: 'gitlens.showHistory' as Commands,
    ToggleBlame: 'gitlens.toggleBlame' as Commands,
}

export type DocumentSchemes = 'file' | 'git' | 'gitblame';
export const DocumentSchemes = {
    File: 'file' as DocumentSchemes,
    Git: 'git' as DocumentSchemes,
    GitBlame: 'gitblame' as DocumentSchemes
}

export type WorkspaceState = 'hasGitHistoryExtension' | 'repoPath';
export const WorkspaceState = {
    HasGitHistoryExtension: 'hasGitHistoryExtension' as WorkspaceState,
    RepoPath: 'repoPath' as WorkspaceState
}