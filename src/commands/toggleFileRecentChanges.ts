'use strict';
import { commands, TextEditor, Uri } from 'vscode';
import { ToggleFileBlameCommandArgs } from '../commands';
import { ActiveEditorCommand, Commands } from './common';
import { FileAnnotationType } from '../configuration';

export class ToggleFileRecentChangesCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.ToggleFileRecentChanges);
    }

    async execute(editor: TextEditor, uri?: Uri): Promise<any> {
        commands.executeCommand(Commands.ToggleFileBlame, uri, {
            type: FileAnnotationType.RecentChanges
        } as ToggleFileBlameCommandArgs);
    }
}
