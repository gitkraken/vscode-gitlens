'use strict';
import { commands } from 'vscode';
import { BuiltInCommands } from './constants';

export { Keyboard } from './commands/keyboard';

export { ActiveEditorCommand, Command, Commands, EditorCommand, openEditor } from './commands/commands';
export { CloseUnchangedFilesCommand } from './commands/closeUnchangedFiles';
export { CopyMessageToClipboardCommand } from './commands/copyMessageToClipboard';
export { CopyShaToClipboardCommand } from './commands/copyShaToClipboard';
export { DiffDirectoryCommand } from './commands/diffDirectory';
export { DiffLineWithPreviousCommand } from './commands/diffLineWithPrevious';
export { DiffLineWithWorkingCommand } from './commands/diffLineWithWorking';
export { DiffWithNextCommand } from './commands/diffWithNext';
export { DiffWithPreviousCommand } from './commands/diffWithPrevious';
export { DiffWithWorkingCommand } from './commands/diffWithWorking';
export { OpenChangedFilesCommand } from './commands/openChangedFiles';
export { ShowBlameCommand } from './commands/showBlame';
export { ShowBlameHistoryCommand } from './commands/showBlameHistory';
export { ShowFileHistoryCommand } from './commands/showFileHistory';
export { ShowQuickCommitDetailsCommand } from './commands/showQuickCommitDetails';
export { ShowQuickCommitFileDetailsCommand } from './commands/showQuickCommitFileDetails';
export { ShowQuickFileHistoryCommand } from './commands/showQuickFileHistory';
export { ShowQuickRepoHistoryCommand } from './commands/showQuickRepoHistory';
export { ShowQuickRepoStatusCommand } from './commands/showQuickRepoStatus';
export { ToggleBlameCommand } from './commands/toggleBlame';
export { ToggleCodeLensCommand } from './commands/toggleCodeLens';

export type CommandContext = 'gitlens:canToggleCodeLens' | 'gitlens:enabled' | 'gitlens:isBlameable' | 'gitlens:key';
export const CommandContext = {
    CanToggleCodeLens: 'gitlens:canToggleCodeLens' as CommandContext,
    Enabled: 'gitlens:enabled' as CommandContext,
    IsBlameable: 'gitlens:isBlameable' as CommandContext,
    Key: 'gitlens:key' as CommandContext
};


export function setCommandContext(key: CommandContext, value: any) {
    return commands.executeCommand(BuiltInCommands.SetContext, key, value);
}