export type WorkspaceState = 'repoPath';
export const WorkspaceState = {
    RepoPath: 'repoPath' as WorkspaceState
}

export const RepoPath: string = 'repoPath';

export type Commands = 'git.action.showBlameHistory';
export const Commands = {
    ShowBlameHistory: 'git.action.showBlameHistory' as Commands
}

export type DocumentSchemes = 'gitblame';
export const DocumentSchemes = {
    GitBlame: 'gitblame' as DocumentSchemes
}

export type VsCodeCommands = 'vscode.executeDocumentSymbolProvider' | 'vscode.executeCodeLensProvider' | 'editor.action.showReferences';
export const VsCodeCommands = {
    ExecuteDocumentSymbolProvider: 'vscode.executeDocumentSymbolProvider' as VsCodeCommands,
    ExecuteCodeLensProvider: 'vscode.executeCodeLensProvider' as VsCodeCommands,
    ShowReferences: 'editor.action.showReferences' as VsCodeCommands
}