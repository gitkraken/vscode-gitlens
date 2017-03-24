'use strict';
import { QuickPickOptions, window } from 'vscode';
import { Commands } from '../commands';
import { GitRemote, RemoteOpenType } from '../gitService';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './quickPicks';
import * as path from 'path';

function getNameFromRemoteOpenType(type: RemoteOpenType) {
    switch (type) {
        case 'branch': return 'Branch';
        case 'commit': return 'Commit';
        case 'file': return 'File';
        case 'working-file': return 'Working File';
        default: return '';
    }
}

export class OpenRemoteCommandQuickPickItem extends CommandQuickPickItem {

    private remote: GitRemote;
    private type: RemoteOpenType;

    constructor(remote: GitRemote, type: RemoteOpenType, ...args: string[]) {
        super({
            label: `$(link-external) Open ${getNameFromRemoteOpenType(type)} in ${remote.provider.name}`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(repo) ${remote.provider.path}`
        }, undefined, undefined);

        this.remote = remote;
        this.type = type;
        this.args = args;
    }

    async execute(): Promise<{}> {
        return this.remote.provider.open(this.type, ...this.args);
    }
}

export class OpenRemotesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(remotes: GitRemote[], type: 'branch', branch: string, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: 'commit', sha: string, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: 'file' | 'working-file', fileName: string, branch?: string, sha?: string, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: RemoteOpenType, branchOrShaOrFileName: string, goBackCommandOrFileBranch?: CommandQuickPickItem | string, fileSha?: string, goBackCommand?: CommandQuickPickItem) {
        let fileBranch: string;
        if (typeof goBackCommandOrFileBranch === 'string') {
            fileBranch = goBackCommandOrFileBranch;
        }
        else if (!goBackCommand) {
            goBackCommand = goBackCommandOrFileBranch;
        }

        const name = getNameFromRemoteOpenType(type);

        let description: string;
        let placeHolder: string;
        switch (type) {
            case 'branch':
                description = `$(git-branch) ${branchOrShaOrFileName}`;
                placeHolder = `open ${branchOrShaOrFileName} ${name.toLowerCase()} in\u2026`;
                break;
            case 'commit':
                const shortSha = branchOrShaOrFileName.substring(0, 8);

                description = `$(git-commit) ${shortSha}`;
                placeHolder = `open ${name.toLowerCase()} ${shortSha} in\u2026`;
                break;
            case 'file':
            case 'working-file':
                const fileName = path.basename(branchOrShaOrFileName);
                const shortFileSha = (fileSha && fileSha.substring(0, 8)) || '';
                const shaSuffix = shortFileSha ? ` \u00a0\u2022\u00a0 ${shortFileSha}` : '';

                description = `$(file-text) ${fileName}${shortFileSha ? ` in \u00a0$(git-commit) ${shortFileSha}` : ''}`;
                placeHolder = `open ${branchOrShaOrFileName}${shaSuffix} in\u2026`;
                break;
        }

        const remote = remotes[0];
        if (remotes.length === 1) {
            super({
                label: `$(link-external) Open ${name} in ${remote.provider.name}`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(repo) ${remote.provider.path} \u00a0\u2022\u00a0 ${description}`
            }, Commands.OpenInRemote, [undefined, remotes, type, [branchOrShaOrFileName, fileBranch, fileSha], goBackCommand]);

            return;
        }

        const provider = remotes.every(_ => _.provider.name === remote.provider.name)
            ? remote.provider.name
            : 'Remote';

        super({
            label: `$(link-external) Open ${name} in ${provider}\u2026`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${description}`
        }, Commands.OpenInRemote, [undefined, remotes, type, [branchOrShaOrFileName, fileBranch, fileSha], goBackCommand]);
    }
}

export class RemotesQuickPick {

    static async show(remotes: GitRemote[], placeHolder: string, type: RemoteOpenType, args: string[], goBackCommand?: CommandQuickPickItem): Promise<OpenRemoteCommandQuickPickItem | CommandQuickPickItem | undefined> {

        const items = remotes.map(_ => new OpenRemoteCommandQuickPickItem(_, type, ...args)) as (OpenRemoteCommandQuickPickItem | CommandQuickPickItem)[];

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        // const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items,
            {
                placeHolder: placeHolder,
                ignoreFocusOut: getQuickPickIgnoreFocusOut()
            } as QuickPickOptions);
        if (!pick) return undefined;

        // await scope.dispose();

        return pick;
    }
}