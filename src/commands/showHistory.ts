'use strict';
import { commands, Position, Range, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { BuiltInCommands, Commands } from '../constants';
import GitProvider from '../gitProvider';
import { Logger } from '../logger';

export default class ShowHistoryCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.ShowHistory);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, position?: Position, sha?: string, line?: number) {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;

            // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
            position = editor.document.validateRange(new Range(0, 0, 0, 1000000)).start;
        }

        try {
            const locations = await this.git.getLogLocations(uri.fsPath, sha, line);
            if (!locations) return window.showWarningMessage(`Unable to show history. File is probably not under source control`);

            return commands.executeCommand(BuiltInCommands.ShowReferences, uri, position, locations);
        }
        catch (ex) {
            Logger.error('[GitLens.ShowHistoryCommand]', 'getLogLocations', ex);
            return window.showErrorMessage(`Unable to show history. See output channel for more details`);
        }
    }
}