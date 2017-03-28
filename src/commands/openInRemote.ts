'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { GitRemote, RemoteOpenType } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, OpenRemoteCommandQuickPickItem, RemotesQuickPick } from '../quickPicks';

export class OpenInRemoteCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.OpenInRemote);
    }

    async execute(editor: TextEditor, uri?: Uri, remotes?: GitRemote[], type?: RemoteOpenType, args?: string[], goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            if (!remotes) return undefined;

            if (remotes.length === 1) {
                const command = new OpenRemoteCommandQuickPickItem(remotes[0], type, ...args);
                return command.execute();
            }

            let placeHolder: string;
            switch (type) {
                case 'branch':
                    placeHolder = `open ${args[0]} branch in\u2026`;
                    break;
                case 'commit':
                    const shortSha = args[0].substring(0, 8);
                    placeHolder = `open commit ${shortSha} in\u2026`;
                    break;
                case 'file':
                case 'working-file':
                    const shortFileSha = (args[2] && args[2].substring(0, 8)) || '';
                    const shaSuffix = shortFileSha ? ` \u00a0\u2022\u00a0 ${shortFileSha}` : '';

                    placeHolder = `open ${args[0]}${shaSuffix} in\u2026`;
                    break;
            }

            const pick = await RemotesQuickPick.show(remotes, placeHolder, type, args, goBackCommand);
            return pick && pick.execute();

        }
        catch (ex) {
            Logger.error(ex, 'OpenInRemoteCommand');
            return window.showErrorMessage(`Unable to open in remote provider. See output channel for more details`);
        }
    }
}