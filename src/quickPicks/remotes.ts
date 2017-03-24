'use strict';
import { QuickPickOptions, window } from 'vscode';
import { GitRemote, HostingProviderOpenType } from '../gitService';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './quickPicks';
import * as path from 'path';

export class OpenRemoteCommandQuickPickItem extends CommandQuickPickItem {

    private type: HostingProviderOpenType;
    private remote: GitRemote;

    constructor(remote: GitRemote, type: HostingProviderOpenType, ...args: string[]);
    constructor(remote: GitRemote, type: HostingProviderOpenType, branchOrShaOrFileName: string, fileSha?: string, name?: string) {
        if (!name) {
            name = `${type[0].toUpperCase()}${type.substring(1)}`;
        }

        super({
            label: `$(link-external) Open ${name} in ${remote.provider.name}`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(repo) ${remote.provider.path}`
        }, undefined, undefined);

        this.type = type;
        this.remote = remote;
        this.args = [branchOrShaOrFileName, fileSha];
    }

    async execute(): Promise<{}> {
        return this.remote.provider.open(this.type, ...this.args);
    }
}

export class OpenRemotesCommandQuickPickItem extends CommandQuickPickItem {

    private goBackCommand: CommandQuickPickItem;
    private name: string;
    private placeHolder: string;
    private remotes: GitRemote[];
    private type: HostingProviderOpenType;

    constructor(remotes: GitRemote[], type: 'branch', branch: string, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: 'commit', sha: string, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: 'file', fileName: string, sha?: string, name?: string, goBackCommand?: CommandQuickPickItem);
    constructor(remotes: GitRemote[], type: HostingProviderOpenType, branchOrShaOrFileName: string, shaOrGoBackCommand?: string | CommandQuickPickItem, name?: string, goBackCommand?: CommandQuickPickItem) {
        let fileSha: string;
        if (typeof shaOrGoBackCommand === 'string') {
            fileSha = shaOrGoBackCommand;
        }
        else if (!goBackCommand) {
            goBackCommand = shaOrGoBackCommand;
        }

        let description: string;
        let placeHolder: string;
        switch (type) {
            case 'branch':
                name = name || 'Branch';
                description = `$(git-branch) ${branchOrShaOrFileName}`;
                placeHolder = `open ${branchOrShaOrFileName} ${name.toLowerCase()} in\u2026`;
                break;
            case 'commit':
                const shortSha = branchOrShaOrFileName.substring(0, 8);

                name = name || 'Commit';
                description = `$(git-commit) ${shortSha}`;
                placeHolder = `open ${name.toLowerCase()} ${shortSha} in\u2026`;
                break;
            case 'file':
                const fileName = path.basename(branchOrShaOrFileName);
                const shortFileSha = (fileSha && fileSha.substring(0, 8)) || '';
                const shaSuffix = shortFileSha ? ` \u00a0\u2022\u00a0 ${shortFileSha}` : '';

                name = name || 'File';
                description = `$(file-text) ${fileName}${shortFileSha ? ` in \u00a0$(git-commit) ${shortFileSha}` : ''}`;
                placeHolder = `open ${branchOrShaOrFileName}${shaSuffix} in\u2026`;
                break;
        }

        const remote = remotes[0];
        if (remotes.length === 1) {
            super({
                label: `$(link-external) Open ${name} in ${remote.provider.name}`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(repo) ${remote.provider.path} \u00a0\u2022\u00a0 ${description}`
            }, undefined, undefined);
        }
        else {
            const provider = remotes.every(_ => _.provider.name === remote.provider.name)
                ? remote.provider.name
                : 'Hosting Provider';

            super({
                label: `$(link-external) Open ${name} in ${provider}\u2026`,
                description: `\u00a0 \u2014 \u00a0\u00a0 ${description}`
            }, undefined, undefined);
        }

        this.goBackCommand = goBackCommand;
        this.name = name;
        this.placeHolder = placeHolder;
        this.remotes = remotes;
        this.type = type;
        this.args = [branchOrShaOrFileName, fileSha];
    }

    async execute(): Promise<{}> {
        if (this.remotes.length === 1) {
            const command = new OpenRemoteCommandQuickPickItem(this.remotes[0], this.type, ...this.args);
            return command.execute();
        }

        const pick = await RemotesQuickPick.show(this.remotes, this.placeHolder, this.type, this.args, this.name, this.goBackCommand);
        return pick && pick.execute();
    }
}

export class RemotesQuickPick {

    static async show(remotes: GitRemote[], placeHolder: string, type: HostingProviderOpenType, args: string[], name: string, goBackCommand?: CommandQuickPickItem): Promise<OpenRemoteCommandQuickPickItem | CommandQuickPickItem | undefined> {

        const items = remotes.map(_ => new OpenRemoteCommandQuickPickItem(_, type, ...args, name)) as (OpenRemoteCommandQuickPickItem | CommandQuickPickItem)[];

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