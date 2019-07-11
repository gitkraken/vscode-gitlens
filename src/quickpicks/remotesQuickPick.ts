'use strict';
import { window } from 'vscode';
import { Commands, OpenInRemoteCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import {
    getNameFromRemoteResource,
    GitRemote,
    GitService,
    GitUri,
    RemoteResource,
    RemoteResourceType
} from '../git/gitService';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './commonQuickPicks';

export class OpenRemoteCommandQuickPickItem extends CommandQuickPickItem {
    private remote: GitRemote;
    private resource: RemoteResource;

    constructor(remote: GitRemote, resource: RemoteResource, public readonly clipboard?: boolean) {
        super(
            {
                label: clipboard
                    ? `$(link-external) Copy ${getNameFromRemoteResource(resource)} Url to Clipboard from ${
                          remote.provider!.name
                      }`
                    : `$(link-external) Open ${getNameFromRemoteResource(resource)} on ${remote.provider!.name}`,
                description: `$(repo) ${remote.provider!.path}`
            },
            undefined,
            undefined
        );

        this.remote = remote;
        this.resource = resource;
    }

    execute(): Thenable<{} | undefined> {
        if (this.clipboard) return this.remote.provider!.copy(this.resource);

        return this.remote.provider!.open(this.resource);
    }
}

export class OpenRemotesCommandQuickPickItem extends CommandQuickPickItem {
    constructor(remotes: GitRemote[], resource: RemoteResource, goBackCommand?: CommandQuickPickItem) {
        const name = getNameFromRemoteResource(resource);

        let description;
        switch (resource.type) {
            case RemoteResourceType.Branch:
                description = `$(git-branch) ${resource.branch}`;
                break;

            case RemoteResourceType.Branches:
                description = '$(git-branch) Branches';
                break;

            case RemoteResourceType.Commit:
                description = `$(git-commit) ${GitService.shortenSha(resource.sha)}`;
                break;

            case RemoteResourceType.File:
                description = GitUri.getFormattedPath(resource.fileName);
                break;

            case RemoteResourceType.Repo:
                description = '$(repo) Repository';
                break;

            case RemoteResourceType.Revision:
                if (resource.commit !== undefined && resource.commit.isFile) {
                    if (resource.commit.status === 'D') {
                        resource.sha = resource.commit.previousSha;
                        description = `${GitUri.getFormattedPath(resource.fileName)} from ${
                            GlyphChars.Space
                        }$(git-commit) ${resource.commit.previousShortSha} (deleted in ${
                            GlyphChars.Space
                        }$(git-commit) ${resource.commit.shortSha})`;
                    }
                    else {
                        resource.sha = resource.commit.sha;
                        description = `${GitUri.getFormattedPath(resource.fileName)} from ${
                            GlyphChars.Space
                        }$(git-commit) ${resource.commit.shortSha}`;
                    }
                }
                else {
                    const shortFileSha = resource.sha === undefined ? '' : GitService.shortenSha(resource.sha);
                    description = `${GitUri.getFormattedPath(resource.fileName)}${
                        shortFileSha ? ` from ${GlyphChars.Space}$(git-commit) ${shortFileSha}` : ''
                    }`;
                }
                break;

            default:
                description = '';
                break;
        }

        let remote: GitRemote | undefined;
        if (remotes.length > 1) {
            remote = remotes.find(r => r.default);
        }
        else if (remotes.length === 1) {
            remote = remotes[0];
        }

        if (remote != null) {
            const commandArgs: OpenInRemoteCommandArgs = {
                remotes: remotes,
                resource: resource,
                goBackCommand: goBackCommand
            };
            super(
                {
                    label: `$(link-external) Open ${name} on ${remote.provider!.name}`,
                    description: `${description} in ${GlyphChars.Space}$(repo) ${remote.provider!.path}`
                },
                Commands.OpenInRemote,
                [undefined, commandArgs]
            );

            return;
        }

        remote = remotes[0];
        // Use the real provider name if there is only 1 provider
        const provider = remotes.every(r => r.provider !== undefined && r.provider.name === remote!.provider!.name)
            ? remote.provider!.name
            : 'Remote';

        const commandArgs: OpenInRemoteCommandArgs = {
            remotes: remotes,
            resource: resource,
            goBackCommand: goBackCommand
        };
        super(
            {
                label: `$(link-external) Open ${name} on ${provider}${GlyphChars.Ellipsis}`,
                description: `${description}`
            },
            Commands.OpenInRemote,
            [undefined, commandArgs]
        );
    }
}

export class RemotesQuickPick {
    static async show(
        remotes: GitRemote[],
        placeHolder: string,
        resource: RemoteResource,
        clipboard?: boolean,
        goBackCommand?: CommandQuickPickItem
    ): Promise<OpenRemoteCommandQuickPickItem | CommandQuickPickItem | undefined> {
        const items = remotes.map(r => new OpenRemoteCommandQuickPickItem(r, resource, clipboard)) as (
            | OpenRemoteCommandQuickPickItem
            | CommandQuickPickItem)[];

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        // const scope = await Container.keyboard.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            placeHolder: placeHolder,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        });
        if (pick === undefined) return undefined;

        // await scope.dispose();

        return pick;
    }
}
