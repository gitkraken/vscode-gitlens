'use strict';
import { commands, ExtensionContext } from 'vscode';
import { AnnotationController } from './annotations/annotationController';
import { CurrentLineController } from './currentLineController';
import { CodeLensController } from './codeLensController';
import { GitService } from './gitService';

export * from './commands/common';

export * from './commands/clearFileAnnotations';
export * from './commands/closeUnchangedFiles';
export * from './commands/copyMessageToClipboard';
export * from './commands/copyShaToClipboard';
export * from './commands/diffDirectory';
export * from './commands/diffLineWithPrevious';
export * from './commands/diffLineWithWorking';
export * from './commands/diffWith';
export * from './commands/diffWithBranch';
export * from './commands/diffWithNext';
export * from './commands/diffWithPrevious';
export * from './commands/diffWithRevision';
export * from './commands/diffWithWorking';
export * from './commands/externalDiff';
export * from './commands/openChangedFiles';
export * from './commands/openBranchesInRemote';
export * from './commands/openBranchInRemote';
export * from './commands/openCommitInRemote';
export * from './commands/openFileInRemote';
export * from './commands/openFileRevision';
export * from './commands/openInRemote';
export * from './commands/openRepoInRemote';
export * from './commands/openWorkingFile';
export * from './commands/resetSuppressedWarnings';
export * from './commands/showCommitSearch';
export * from './commands/showFileBlame';
export * from './commands/showLastQuickPick';
export * from './commands/showLineBlame';
export * from './commands/showQuickBranchHistory';
export * from './commands/showQuickCommitDetails';
export * from './commands/showQuickCommitFileDetails';
export * from './commands/showQuickCurrentBranchHistory';
export * from './commands/showQuickFileHistory';
export * from './commands/showQuickRepoStatus';
export * from './commands/showQuickStashList';
export * from './commands/stashApply';
export * from './commands/stashDelete';
export * from './commands/stashSave';
export * from './commands/toggleCodeLens';
export * from './commands/toggleFileBlame';
export * from './commands/toggleFileHeatmap';
export * from './commands/toggleFileRecentChanges';
export * from './commands/toggleLineBlame';

import * as Commands from './commands';

export function configureCommands(
    context: ExtensionContext,
    git: GitService,
    annotationController: AnnotationController,
    currentLineController: CurrentLineController,
    codeLensController: CodeLensController
): void {
    context.subscriptions.push(commands.registerTextEditorCommand('gitlens.computingFileAnnotations', () => { }));

    context.subscriptions.push(new Commands.CloseUnchangedFilesCommand(git));
    context.subscriptions.push(new Commands.OpenChangedFilesCommand(git));
    context.subscriptions.push(new Commands.ExternalDiffCommand(git));
    context.subscriptions.push(new Commands.CopyMessageToClipboardCommand(git));
    context.subscriptions.push(new Commands.CopyShaToClipboardCommand(git));
    context.subscriptions.push(new Commands.DiffDirectoryCommand(git));
    context.subscriptions.push(new Commands.DiffLineWithPreviousCommand(git));
    context.subscriptions.push(new Commands.DiffLineWithWorkingCommand(git));
    context.subscriptions.push(new Commands.DiffWithCommand(git));
    context.subscriptions.push(new Commands.DiffWithBranchCommand(git));
    context.subscriptions.push(new Commands.DiffWithNextCommand(git));
    context.subscriptions.push(new Commands.DiffWithPreviousCommand(git));
    context.subscriptions.push(new Commands.DiffWithRevisionCommand(git));
    context.subscriptions.push(new Commands.DiffWithWorkingCommand(git));
    context.subscriptions.push(new Commands.OpenBranchesInRemoteCommand(git));
    context.subscriptions.push(new Commands.OpenBranchInRemoteCommand(git));
    context.subscriptions.push(new Commands.OpenCommitInRemoteCommand(git));
    context.subscriptions.push(new Commands.OpenFileInRemoteCommand(git));
    context.subscriptions.push(new Commands.OpenFileRevisionCommand(annotationController, git));
    context.subscriptions.push(new Commands.OpenInRemoteCommand());
    context.subscriptions.push(new Commands.OpenRepoInRemoteCommand(git));
    context.subscriptions.push(new Commands.OpenWorkingFileCommand(annotationController, git));
    context.subscriptions.push(new Commands.ClearFileAnnotationsCommand(annotationController));
    context.subscriptions.push(new Commands.ShowFileBlameCommand(annotationController));
    context.subscriptions.push(new Commands.ShowLineBlameCommand(currentLineController));
    context.subscriptions.push(new Commands.ToggleFileBlameCommand(annotationController));
    context.subscriptions.push(new Commands.ToggleFileHeatmapCommand(annotationController));
    context.subscriptions.push(new Commands.ToggleFileRecentChangesCommand(annotationController));
    context.subscriptions.push(new Commands.ToggleLineBlameCommand(currentLineController));
    context.subscriptions.push(new Commands.ResetSuppressedWarningsCommand());
    context.subscriptions.push(new Commands.ShowLastQuickPickCommand());
    context.subscriptions.push(new Commands.ShowQuickBranchHistoryCommand(git));
    context.subscriptions.push(new Commands.ShowQuickCurrentBranchHistoryCommand(git));
    context.subscriptions.push(new Commands.ShowQuickCommitDetailsCommand(git));
    context.subscriptions.push(new Commands.ShowQuickCommitFileDetailsCommand(git));
    context.subscriptions.push(new Commands.ShowCommitSearchCommand(git));
    context.subscriptions.push(new Commands.ShowQuickFileHistoryCommand(git));
    context.subscriptions.push(new Commands.ShowQuickRepoStatusCommand(git));
    context.subscriptions.push(new Commands.ShowQuickStashListCommand(git));
    context.subscriptions.push(new Commands.StashApplyCommand(git));
    context.subscriptions.push(new Commands.StashDeleteCommand(git));
    context.subscriptions.push(new Commands.StashSaveCommand(git));
    context.subscriptions.push(new Commands.ToggleCodeLensCommand(codeLensController));
}