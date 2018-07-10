'use strict';
import { commands, TextEditor, Uri } from 'vscode';
import { ToggleFileBlameCommandArgs } from '../commands';
import { ActiveEditorCommand, Commands } from './common';
import { FileAnnotationType } from '../configuration';

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
