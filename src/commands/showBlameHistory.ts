'use strict';
import { commands, Position, Range, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { Commands, EditorCommand, getCommandUri } from './common';
import { BuiltInCommands } from '../constants';
import { GitService, GitUri } from '../gitService';
import { Messages } from '../messages';
import { Logger } from '../logger';

export interface ShowBlameHistoryCommandArgs {
    line?: number;
    position?: Position;
    range?: Range;
    sha?: string;
}

export class ShowBlameHistoryCommand extends EditorCommand {

    constructor(private git: GitService) {
        super(Commands.ShowBlameHistory);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, args: ShowBlameHistoryCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri === undefined) return undefined;

        if (args.range == null || args.position == null) {
            // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
            args.range = editor.document.validateRange(new Range(0, 0, 1000000, 1000000));
            args.position = editor.document.validateRange(new Range(0, 0, 0, 1000000)).start;
        }

        const gitUri = await GitUri.fromUri(uri, this.git);

        try {
            const locations = await this.git.getBlameLocations(gitUri, args.range, args.sha, args.line);
            if (locations === undefined) return Messages.showFileNotUnderSourceControlWarningMessage('Unable to show blame history');

            return commands.executeCommand(BuiltInCommands.ShowReferences, uri, args.position, locations);
        }
        catch (ex) {
            Logger.error(ex, 'ShowBlameHistoryCommand', 'getBlameLocations');
            return window.showErrorMessage(`Unable to show blame history. See output channel for more details`);
        }
    }
}