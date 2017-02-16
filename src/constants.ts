'use strict';

export const RepoPath = 'repoPath';

export type BuiltInCommands = 'cursorMove' | 'editor.action.showReferences' | 'editor.action.toggleRenderWhitespace' | 'editorScroll' | 'revealLine' | 'vscode.diff' | 'vscode.executeDocumentSymbolProvider' | 'vscode.executeCodeLensProvider' | 'setContext';
export const BuiltInCommands = {
    CursorMove: 'cursorMove' as BuiltInCommands,
    Diff: 'vscode.diff' as BuiltInCommands,
    EditorScroll: 'editorScroll' as BuiltInCommands,
    ExecuteDocumentSymbolProvider: 'vscode.executeDocumentSymbolProvider' as BuiltInCommands,
    ExecuteCodeLensProvider: 'vscode.executeCodeLensProvider' as BuiltInCommands,
    RevealLine: 'revealLine' as BuiltInCommands,
    SetContext: 'setContext' as BuiltInCommands,
    ShowReferences: 'editor.action.showReferences' as BuiltInCommands,
    ToggleRenderWhitespace: 'editor.action.toggleRenderWhitespace' as BuiltInCommands
};

export type Commands = 'gitlens.copyShaToClipboard' | 'gitlens.diffWithPrevious' | 'gitlens.diffLineWithPrevious' | 'gitlens.diffWithWorking' | 'gitlens.diffLineWithWorking' | 'gitlens.showBlame' | 'gitlens.showBlameHistory' | 'gitlens.showFileHistory' | 'gitlens.showQuickCommitDetails' | 'gitlens.showQuickFileHistory' | 'gitlens.showQuickRepoHistory' | 'gitlens.toggleBlame' | 'gitlens.toggleCodeLens';
export const Commands = {
    CopyShaToClipboard: 'gitlens.copyShaToClipboard' as Commands,
    DiffWithPrevious: 'gitlens.diffWithPrevious' as Commands,
    DiffLineWithPrevious: 'gitlens.diffLineWithPrevious' as Commands,
    DiffWithWorking: 'gitlens.diffWithWorking' as Commands,
    DiffLineWithWorking: 'gitlens.diffLineWithWorking' as Commands,
    ShowBlame: 'gitlens.showBlame' as Commands,
    ShowBlameHistory: 'gitlens.showBlameHistory' as Commands,
    ShowFileHistory: 'gitlens.showFileHistory' as Commands,
    ShowQuickCommitDetails: 'gitlens.showQuickCommitDetails' as Commands,
    ShowQuickFileHistory: 'gitlens.showQuickFileHistory' as Commands,
    ShowQuickRepoHistory: 'gitlens.showQuickRepoHistory' as Commands,
    ToggleBlame: 'gitlens.toggleBlame' as Commands,
    ToggleCodeLens: 'gitlens.toggleCodeLens' as Commands
};

export type DocumentSchemes = 'file' | 'gitlens-git';
export const DocumentSchemes = {
    File: 'file' as DocumentSchemes,
    Git: 'gitlens-git' as DocumentSchemes
};

export type WorkspaceState = 'repoPath';
export const WorkspaceState = {
    RepoPath: 'repoPath' as WorkspaceState
};