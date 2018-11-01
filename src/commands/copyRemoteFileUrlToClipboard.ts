'use strict';
import { commands, TextEditor, Uri } from 'vscode';
import {
    ActiveEditorCommand,
    command,
    CommandContext,
    Commands,
    isCommandViewContextWithBranch,
    isCommandViewContextWithCommit
} from './common';

export interface CopyRemoteFileUrlToClipboardCommandArgs {
    branch?: string;
    range?: boolean;
}

@command()
export class CopyRemoteFileUrlToClipboardCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.CopyRemoteFileUrlToClipboard);
    }

    protected async preExecute(
        context: CommandContext,
        args: CopyRemoteFileUrlToClipboardCommandArgs = { range: true }
    ): Promise<any> {
        if (isCommandViewContextWithCommit(context)) {
            args = { ...args };
            args.range = false;
            if (isCommandViewContextWithBranch(context)) {
                args.branch = context.node.branch !== undefined ? context.node.branch.name : undefined;
            }
            return this.execute(context.editor, context.node.commit.uri, args);
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: CopyRemoteFileUrlToClipboardCommandArgs = { range: true }) {
        return commands.executeCommand(Commands.OpenFileInRemote, uri, { ...args, clipboard: true });
    }
}
