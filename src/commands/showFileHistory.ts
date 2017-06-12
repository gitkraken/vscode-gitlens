'use strict';
import { commands, Position, Range, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand, getCommandUri } from './common';
import { BuiltInCommands } from '../constants';
import { GitExplorer } from '../views/gitExplorer';
import { GitService, GitUri } from '../gitService';
import { Messages } from '../messages';
import { Logger } from '../logger';

export interface ShowFileHistoryCommandArgs {
    line?: number;
    position?: Position;
    sha?: string;
}

export class ShowFileHistoryCommand extends EditorCommand {

    constructor(private git: GitService, private explorer?: GitExplorer) {
        super(Commands.ShowFileHistory);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ShowFileHistoryCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        if (args.position == null) {
            args = { ...args };

            // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
            args.position = editor.document.validateRange(new Range(0, 0, 0, 1000000)).start;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        try {
            if (this.explorer !== undefined) {
                this.explorer.addHistory(gitUri);
                return undefined;
            }

            const locations = await this.git.getLogLocations(gitUri, args.sha, args.line);
            if (locations === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to show file history');

            return commands.executeCommand(BuiltInCommands.ShowReferences, uri, args.position, locations);
        }
        catch (ex) {
            Logger.error(ex, 'ShowFileHistoryCommand', 'getLogLocations');
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
    }
}