'use strict'

export const DiagnosticCollectionName = 'gitlens';
export const DiagnosticSource = 'GitLens';
export const RepoPath = 'repoPath';

export type Commands = 'gitlens.diffWithPrevious' | 'gitlens.diffWithWorking' | 'gitlens.showBlame' | 'gitlens.showHistory' | 'gitlens.toggleBlame';
export const Commands = {
    DiffWithPrevious: 'gitlens.diffWithPrevious' as Commands,
    DiffWithWorking: 'gitlens.diffWithWorking' as Commands,
    ShowBlame: 'gitlens.showBlame' as Commands,
    ShowHistory: 'gitlens.showHistory' as Commands,
    ToggleBlame: 'gitlens.toggleBlame' as Commands,
}

export type DocumentSchemes = 'file' | 'git' | 'gitblame';
export const DocumentSchemes = {
    File: 'file' as DocumentSchemes,
    Git: 'git' as DocumentSchemes,
    GitBlame: 'gitblame' as DocumentSchemes
}

export type VsCodeCommands = 'vscode.diff' | 'vscode.executeDocumentSymbolProvider' | 'vscode.executeCodeLensProvider' | 'editor.action.showReferences';
export const VsCodeCommands = {
    Diff: 'vscode.diff' as VsCodeCommands,
    ExecuteDocumentSymbolProvider: 'vscode.executeDocumentSymbolProvider' as VsCodeCommands,
    ExecuteCodeLensProvider: 'vscode.executeCodeLensProvider' as VsCodeCommands,
    ShowReferences: 'editor.action.showReferences' as VsCodeCommands
}

export type WorkspaceState = 'hasGitHistoryExtension' | 'repoPath';
export const WorkspaceState = {
    HasGitHistoryExtension: 'hasGitHistoryExtension' as WorkspaceState,
    RepoPath: 'repoPath' as WorkspaceState
}