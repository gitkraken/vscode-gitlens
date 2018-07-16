'use strict';
import { commands, TextEditor, Uri } from 'vscode';
import { FileAnnotationType } from '../configuration';
import { ActiveEditorCommand, Commands } from './common';
import { ToggleFileBlameCommandArgs } from './toggleFileBlame';

export class ToggleFileHeatmapCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.ToggleFileHeatmap);
    }

    async execute(editor: TextEditor, uri?: Uri): Promise<any> {
        commands.executeCommand(Commands.ToggleFileBlame, uri, {
            type: FileAnnotationType.Heatmap
        } as ToggleFileBlameCommandArgs);
    }
}
