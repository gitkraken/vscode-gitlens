'use strict';
import { QuickPickOptions, window } from 'vscode';
import { Commands } from '../commands';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './common';
import { getNameFromRemoteOpenType, GitLogCommit, GitRemote, RemoteOpenType } from '../gitService';
import * as path from 'path';

export class OpenRemoteCommandQuickPickItem extends CommandQuickPickItem {

    private remote: GitRemote;
    private type: RemoteOpenType;

    constructor(remote: GitRemote, type: RemoteOpenType, ...args: string[]) {
        super({
            label: `$(link-external) Open ${getNameFromRemoteOpenType(type)} in ${remote.provider!.name}`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(repo) ${remote.provider!.path}`
        }, undefined, undefined);

        this.remote = remote;
        this.type = type;
        this.args = args;
    }

    async execute(): Promise<{}> {
        return this.remote.provider!.open(this.type, ...this.args!);
    }
}

export class OpenRemotesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(remotes: GitRemote[], type: 'branch', branch: string, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: 'commit', sha: string, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: 'file', fileName: string, branch?: string, commit?: GitLogCommit, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: 'file' | 'working-file', fileName: string, branch?: string, sha?: string, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: RemoteOpenType, branchOrShaOrFileName: string, goBackCommandOrFileBranch?: CommandQuickPickItem | string, fileShaOrCommit?: string | GitLogCommit, goBackCommand?: CommandQuickPickItem) {
        let fileBranch: string | undefined = undefined;
        if (typeof goBackCommandOrFileBranch === 'string') {
            fileBranch = goBackCommandOrFileBranch;
        }
        else if (!goBackCommand) {
            goBackCommand = goBackCommandOrFileBranch;
        }

        const name = getNameFromRemoteOpenType(type);

        let fileSha: string | undefined = undefined;
        let description: string | undefined = undefined;
        let placeHolder: string | undefined = undefined;
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
                if (fileShaOrCommit instanceof GitLogCommit) {
                    if (fileShaOrCommit.status === 'D') {
                        fileSha = fileShaOrCommit.previousSha;

                        description = `$(file-text) ${fileName} in \u00a0$(git-commit) ${fileShaOrCommit.previousShortSha} (deleted in \u00a0$(git-commit) ${fileShaOrCommit.shortSha})`;
                        placeHolder = `open ${branchOrShaOrFileName} \u00a0\u2022\u00a0 ${fileShaOrCommit.previousShortSha} in\u2026`;
                    }
                    else {
                        fileSha = fileShaOrCommit.sha;

                        description = `$(file-text) ${fileName} in \u00a0$(git-commit) ${fileShaOrCommit.shortSha}`;
                        placeHolder = `open ${branchOrShaOrFileName} \u00a0\u2022\u00a0 ${fileShaOrCommit.shortSha} in\u2026`;
                    }
                }
                else {
                    fileSha = fileShaOrCommit;
                    const shortFileSha = (fileSha && fileSha.substring(0, 8)) || '';
                    const shaSuffix = shortFileSha ? ` \u00a0\u2022\u00a0 ${shortFileSha}` : '';

                    description = `$(file-text) ${fileName}${shortFileSha ? ` in \u00a0$(git-commit) ${shortFileSha}` : ''}`;
                    placeHolder = `open ${branchOrShaOrFileName}${shaSuffix} in\u2026`;
                }
                break;
        }

        const remote = remotes[0];
        if (remotes.length === 1) {
            super({
                label: `$(link-external) Open ${name} in ${remote.provider!.name}`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(repo) ${remote.provider!.path} \u00a0\u2022\u00a0 ${description}`
            }, Commands.OpenInRemote, [undefined, remotes, type, [branchOrShaOrFileName, fileBranch, fileSha], goBackCommand]);

            return;
        }

        const provider = remotes.every(_ => _.provider !== undefined && _.provider.name === remote.provider!.name)
            ? remote.provider!.name
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