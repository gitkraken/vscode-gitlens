'use strict'
import {commands, Position, Range, TextEditor, TextEditorEdit, Uri} from 'vscode';
import {EditorCommand} from './commands';
import {BuiltInCommands, Commands} from '../constants';
import GitProvider from '../gitProvider';

export default class ShowBlameHistoryCommand extends EditorCommand {
    constructor(private git: GitProvider) {
        super(Commands.ShowBlameHistory);
    }

    execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, range?: Range, position?: Position) {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return;
            uri = editor.document.uri;

            // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
            range = editor.document.validateRange(new Range(0, 0, 1000000, 1000000));
            position = editor.document.validateRange(new Range(0, 0, 0, 1000000)).start;
        }

        return this.git.getBlameLocations(uri.fsPath, range)
            .catch(ex => console.error('[GitLens.ShowBlameHistoryCommand]', 'getBlameLocations', ex))
            .then(locations => commands.executeCommand(BuiltInCommands.ShowReferences, uri, position, locations));
    }
}