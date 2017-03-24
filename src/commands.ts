'use strict';
import { commands } from 'vscode';
import { BuiltInCommands } from './constants';

export * from './commands/keyboard';

export * from './commands/commands';
export * from './commands/closeUnchangedFiles';
export * from './commands/copyMessageToClipboard';
export * from './commands/copyShaToClipboard';
export * from './commands/diffDirectory';
export * from './commands/diffLineWithPrevious';
export * from './commands/diffLineWithWorking';
export * from './commands/diffWithBranch';
export * from './commands/diffWithNext';
export * from './commands/diffWithPrevious';
export * from './commands/diffWithWorking';
export * from './commands/openChangedFiles';
export * from './commands/openCommitInRemote';
export * from './commands/openFileInRemote';
export * from './commands/openInRemote';
export * from './commands/showBlame';
export * from './commands/showBlameHistory';
export * from './commands/showFileHistory';
export * from './commands/showLastQuickPick';
export * from './commands/showQuickCommitDetails';
export * from './commands/showQuickCommitFileDetails';
export * from './commands/showQuickFileHistory';
export * from './commands/showQuickBranchHistory';
export * from './commands/showQuickCurrentBranchHistory';
export * from './commands/showQuickRepoStatus';
export * from './commands/toggleBlame';
export * from './commands/toggleCodeLens';

export type CommandContext = 'gitlens:canToggleCodeLens' | 'gitlens:enabled' | 'gitlens:isBlameable' | 'gitlens:key';
export const CommandContext = {
    CanToggleCodeLens: 'gitlens:canToggleCodeLens' as CommandContext,
    Enabled: 'gitlens:enabled' as CommandContext,
    IsBlameable: 'gitlens:isBlameable' as CommandContext,
    Key: 'gitlens:key' as CommandContext
};


export function setCommandContext(key: CommandContext | string, value: any) {
    return commands.executeCommand(BuiltInCommands.SetContext, key, value);
}