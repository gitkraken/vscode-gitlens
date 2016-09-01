'use strict'

export type WorkspaceState = 'hasGitHistoryExtension' | 'repoPath';
export const WorkspaceState = {
    HasGitHistoryExtension: 'hasGitHistoryExtension' as WorkspaceState,
    RepoPath: 'repoPath' as WorkspaceState
}

export const RepoPath: string = 'repoPath';

export type Commands = 'git.action.diffWithPrevious' | 'git.action.diffWithWorking' | 'git.action.showBlameHistory';
export const Commands = {
    DiffWithPrevious: 'git.action.diffWithPrevious' as Commands,
    DiffWithWorking: 'git.action.diffWithWorking' as Commands,
    ShowBlameHistory: 'git.action.showBlameHistory' as Commands
}

export type DocumentSchemes = 'file' | 'gitblame';
export const DocumentSchemes = {
    File: 'file' as DocumentSchemes,
    GitBlame: 'gitblame' as DocumentSchemes
}

export type VsCodeCommands = 'vscode.diff' | 'vscode.executeDocumentSymbolProvider' | 'vscode.executeCodeLensProvider' | 'editor.action.showReferences';
export const VsCodeCommands = {
    Diff: 'vscode.diff' as VsCodeCommands,
    ExecuteDocumentSymbolProvider: 'vscode.executeDocumentSymbolProvider' as VsCodeCommands,
    ExecuteCodeLensProvider: 'vscode.executeCodeLensProvider' as VsCodeCommands,
    ShowReferences: 'editor.action.showReferences' as VsCodeCommands
}