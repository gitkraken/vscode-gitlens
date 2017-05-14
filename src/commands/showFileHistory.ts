'use strict';
import { commands, Position, Range, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand, getCommandUri } from './common';
import { BuiltInCommands } from '../constants';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';

export interface ShowFileHistoryCommandArgs {
    line?: number;
    position?: Position;
    sha?: string;
}

export class ShowFileHistoryCommand extends EditorCommand {

    constructor(private git: GitService) {
        super(Commands.ShowFileHistory);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ShowFileHistoryCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        if (args.position == null) {
            // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
            args.position = editor.document.validateRange(new Range(0, 0, 0, 1000000)).start;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        try {
            const locations = await this.git.getLogLocations(gitUri, args.sha, args.line);
            if (locations === undefined) return window.showWarningMessage(`Unable to show file history. File is probably not under source control`);

            return commands.executeCommand(BuiltInCommands.ShowReferences, uri, args.position, locations);
        }
        catch (ex) {
            Logger.error(ex, 'ShowFileHistoryCommand', 'getLogLocations');
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
    }
}