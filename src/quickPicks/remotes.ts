'use strict';
import { Strings } from '../system';
import { QuickPickOptions, window } from 'vscode';
import { Commands, OpenInRemoteCommandArgs } from '../commands';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './common';
import { GlyphChars } from '../constants';
import { getNameFromRemoteResource, GitLogCommit, GitRemote, GitService, RemoteResource, RemoteResourceType } from '../gitService';
import * as path from 'path';

export class OpenRemoteCommandQuickPickItem extends CommandQuickPickItem {

    private remote: GitRemote;
    private resource: RemoteResource;

    constructor(remote: GitRemote, resource: RemoteResource) {
        super({
            label: `$(link-external) Open ${getNameFromRemoteResource(resource)} in ${remote.provider!.name}`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(repo) ${remote.provider!.path}`
        }, undefined, undefined);

        this.remote = remote;
        this.resource = resource;
    }

    async execute(): Promise<{} | undefined> {
        return this.remote.provider!.open(this.resource);
    }
}

export class OpenRemotesCommandQuickPickItem extends CommandQuickPickItem {

    constructor(remotes: GitRemote[], resource: RemoteResource, goBackCommand?: CommandQuickPickItem) {
        const name = getNameFromRemoteResource(resource);

        let description = '';
        switch (resource.type) {
            case RemoteResourceType.Branch:
                description = `$(git-branch) ${resource.branch}`;
                break;

            case RemoteResourceType.Branches:
                description = `$(git-branch) Branches`;
                break;

            case RemoteResourceType.Commit:
                const shortSha = GitService.shortenSha(resource.sha);
                description = `$(git-commit) ${shortSha}`;
                break;

            case RemoteResourceType.File:
                description = `$(file-text) ${path.basename(resource.fileName)}`;
                break;

            case RemoteResourceType.Repo:
                description = `$(repo) Repository`;
                break;

            case RemoteResourceType.Revision:
                if (resource.commit !== undefined && resource.commit instanceof GitLogCommit) {
                    if (resource.commit.status === 'D') {
                        resource.sha = resource.commit.previousSha;
                        description = `$(file-text) ${path.basename(resource.fileName)} in ${GlyphChars.Space}$(git-commit) ${resource.commit.previousShortSha} (deleted in ${GlyphChars.Space}$(git-commit) ${resource.commit.shortSha})`;
                    }
                    else {
                        resource.sha = resource.commit.sha;
                        description = `$(file-text) ${path.basename(resource.fileName)} in ${GlyphChars.Space}$(git-commit) ${resource.commit.shortSha}`;
                    }
                }
                else {
                    const shortFileSha = resource.sha === undefined ? '' : GitService.shortenSha(resource.sha);
                    description = `$(file-text) ${path.basename(resource.fileName)}${shortFileSha ? ` in ${GlyphChars.Space}$(git-commit) ${shortFileSha}` : ''}`;
                }
                break;
        }

        const remote = remotes[0];
        if (remotes.length === 1) {
            super({
                label: `$(link-external) Open ${name} in ${remote.provider!.name}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} $(repo) ${remote.provider!.path} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${description}`
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

        const provider = remotes.every(r => r.provider !== undefined && r.provider.name === remote.provider!.name)
            ? remote.provider!.name
            : 'Remote';

        super({
            label: `$(link-external) Open ${name} in ${provider}${GlyphChars.Ellipsis}`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} ${description}`
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
        const items = remotes.map(r => new OpenRemoteCommandQuickPickItem(r, resource)) as (OpenRemoteCommandQuickPickItem | CommandQuickPickItem)[];

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