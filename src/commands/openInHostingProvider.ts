'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './commands';
import { GitRemote, HostingProviderOpenType } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, OpenRemoteCommandQuickPickItem, RemotesQuickPick } from '../quickPicks';

export class OpenInHostingProviderCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.OpenInHostingProvider);
    }

    async execute(editor: TextEditor, uri?: Uri, remotes?: GitRemote[], type?: HostingProviderOpenType, args?: string[], name?: string, goBackCommand?: CommandQuickPickItem) {
        if (!(uri instanceof Uri)) {
            uri = editor && editor.document && editor.document.uri;
        }

        try {
            if (!remotes) return undefined;

            if (remotes.length === 1) {
                const command = new OpenRemoteCommandQuickPickItem(remotes[0], type, ...args, name);
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
                    const shortFileSha = (args[1] && args[1].substring(0, 8)) || '';
                    const shaSuffix = shortFileSha ? ` \u00a0\u2022\u00a0 ${shortFileSha}` : '';

                    placeHolder = `open ${args[0]}${shaSuffix} in\u2026`;
                    break;
            }

            const pick = await RemotesQuickPick.show(remotes, placeHolder, type, args, name, goBackCommand);
            return pick && pick.execute();

        }
        catch (ex) {
            Logger.error('[GitLens.OpenInHostingProviderCommand]', ex);
            return window.showErrorMessage(`Unable to open in hosting provider. See output channel for more details`);
        }
    }
}