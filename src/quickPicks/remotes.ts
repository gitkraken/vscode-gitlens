'use strict';
import { QuickPickOptions, window } from 'vscode';
import { Commands, OpenInRemoteCommandArgs } from '../commands';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './common';
import { getNameFromRemoteResource, GitLogCommit, GitRemote, RemoteResource } from '../gitService';
import * as path from 'path';

export class OpenRemoteCommandQuickPickItem extends CommandQuickPickItem {

    private remote: GitRemote;
    private resource: RemoteResource;

    constructor(remote: GitRemote, resource: RemoteResource) {
        super({
            label: `$(link-external) Open ${getNameFromRemoteResource(resource)} in ${remote.provider!.name}`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(repo) ${remote.provider!.path}`
        }, undefined, undefined);

        this.remote = remote;
        this.resource = resource;
    }

    async execute(): Promise<{}> {
        return this.remote.provider!.open(this.resource);
    }
}

export class OpenRemotesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(remotes: GitRemote[], resource: RemoteResource, goBackCommand?: CommandQuickPickItem) {
        const name = getNameFromRemoteResource(resource);

        let description = '';
        switch (resource.type) {
            case 'branch':
                description = `$(git-branch) ${resource.branch}`;
                break;

            case 'commit':
                const shortSha = resource.sha.substring(0, 8);
                description = `$(git-commit) ${shortSha}`;
                break;

            case 'file':
                if (resource.commit !== undefined && resource.commit instanceof GitLogCommit) {
                    if (resource.commit.status === 'D') {
                        resource.sha = resource.commit.previousSha;
                        description = `$(file-text) ${path.basename(resource.fileName)} in \u00a0$(git-commit) ${resource.commit.previousShortSha} (deleted in \u00a0$(git-commit) ${resource.commit.shortSha})`;
                    }
                    else {
                        resource.sha = resource.commit.sha;
                        description = `$(file-text) ${path.basename(resource.fileName)} in \u00a0$(git-commit) ${resource.commit.shortSha}`;
                    }
                }
                else {
                    const shortFileSha = resource.sha === undefined ? '' : resource.sha.substring(0, 8);
                    description = `$(file-text) ${path.basename(resource.fileName)}${shortFileSha ? ` in \u00a0$(git-commit) ${shortFileSha}` : ''}`;
                }
                break;

            case 'repo':
                description = `$(repo) Repository`;
                break;

            case 'working-file':
                description = `$(file-text) ${path.basename(resource.fileName)}`;
                break;
        }

        const remote = remotes[0];
        if (remotes.length === 1) {
            super({
                label: `$(link-external) Open ${name} in ${remote.provider!.name}`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(repo) ${remote.provider!.path} \u00a0\u2022\u00a0 ${description}`
            }, Commands.OpenInRemote, [
                    undefined,
                    {
                        remotes,
                        resource,
                        goBackCommand
                    } as OpenInRemoteCommandArgs
                ]);

            return;
        }

        const provider = remotes.every(_ => _.provider !== undefined && _.provider.name === remote.provider!.name)
            ? remote.provider!.name
            : 'Remote';

        super({
            label: `$(link-external) Open ${name} in ${provider}\u2026`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${description}`
        }, Commands.OpenInRemote, [
                undefined,
                {
                    remotes,
                    resource,
                    goBackCommand
                } as OpenInRemoteCommandArgs
            ]);
    }
}

export class RemotesQuickPick {

    static async show(remotes: GitRemote[], placeHolder: string, resource: RemoteResource, goBackCommand?: CommandQuickPickItem): Promise<OpenRemoteCommandQuickPickItem | CommandQuickPickItem | undefined> {
        const items = remotes.map(_ => new OpenRemoteCommandQuickPickItem(_, resource)) as (OpenRemoteCommandQuickPickItem | CommandQuickPickItem)[];

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        // const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            placeHolder: placeHolder,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        } as QuickPickOptions);
        if (pick === undefined) return undefined;

        // await scope.dispose();

        return pick;
    }
}