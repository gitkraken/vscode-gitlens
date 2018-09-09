'use strict';
import { TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { GitLogCommit, GitRemote, GitService, RemoteResource, RemoteResourceType } from '../git/gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, OpenRemoteCommandQuickPickItem, RemotesQuickPick } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, Commands } from './common';

export interface OpenInRemoteCommandArgs {
    remote?: string;
    remotes?: GitRemote[];
    resource?: RemoteResource;
    clipboard?: boolean;

    goBackCommand?: CommandQuickPickItem;
}

export class OpenInRemoteCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.OpenInRemote);
    }

    async execute(editor: TextEditor, uri?: Uri, args: OpenInRemoteCommandArgs = {}) {
        args = { ...args };
        if (args.remotes === undefined || args.resource === undefined) return undefined;

        if (args.remote !== undefined) {
            const remotes = args.remotes.filter(r => r.name === args.remote);
            // Only filter if we get some results
            if (remotes.length > 0) {
                args.remotes = remotes;
            }
        }

        try {
            if (args.remotes.length === 1) {
                this.ensureRemoteBranchName(args);
                const command = new OpenRemoteCommandQuickPickItem(args.remotes[0], args.resource, args.clipboard);
                return await command.execute();
            }

            const verb = args.clipboard ? 'Copy url for' : 'Open';
            const suffix = args.clipboard ? `to clipboard from${GlyphChars.Ellipsis}` : `in${GlyphChars.Ellipsis}`;
            let placeHolder = '';
            switch (args.resource.type) {
                case RemoteResourceType.Branch:
                    this.ensureRemoteBranchName(args);
                    placeHolder = `${verb} ${args.resource.branch} branch ${suffix}`;
                    break;

                case RemoteResourceType.Commit:
                    const shortSha = GitService.shortenSha(args.resource.sha);
                    placeHolder = `${verb} commit ${shortSha} ${suffix}`;
                    break;

                case RemoteResourceType.File:
                    placeHolder = `${verb} ${args.resource.fileName} ${suffix}`;
                    break;

                case RemoteResourceType.Revision:
                    if (args.resource.commit !== undefined && args.resource.commit instanceof GitLogCommit) {
                        if (args.resource.commit.status === 'D') {
                            args.resource.sha = args.resource.commit.previousSha;
                            placeHolder = `${verb} ${args.resource.fileName} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${
                                args.resource.commit.previousShortSha
                            } ${suffix}`;
                        }
                        else {
                            args.resource.sha = args.resource.commit.sha;
                            placeHolder = `${verb} ${args.resource.fileName} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${
                                args.resource.commit.shortSha
                            } ${suffix}`;
                        }
                    }
                    else {
                        const shortFileSha =
                            args.resource.sha === undefined ? '' : GitService.shortenSha(args.resource.sha);
                        const shaSuffix = shortFileSha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${shortFileSha}` : '';

                        placeHolder = `${verb} ${args.resource.fileName}${shaSuffix} ${suffix}`;
                    }
                    break;
            }

            const pick = await RemotesQuickPick.show(
                args.remotes,
                placeHolder,
                args.resource,
                args.clipboard,
                args.goBackCommand
            );
            if (pick === undefined) return undefined;

            return await pick.execute();
        }
        catch (ex) {
            Logger.error(ex, 'OpenInRemoteCommand');
            return window.showErrorMessage(`Unable to open in remote provider. See output channel for more details`);
        }
    }

    private ensureRemoteBranchName(args: OpenInRemoteCommandArgs) {
        if (args.remotes === undefined || args.resource === undefined || args.resource.type !== 'branch') return;

        // Check to see if the remote is in the branch
        const index = args.resource.branch.indexOf('/');
        if (index >= 0) {
            const remoteName = args.resource.branch.substring(0, index);
            const remote = args.remotes.find(r => r.name === remoteName);
            if (remote !== undefined) {
                args.resource.branch = args.resource.branch.substring(index + 1);
                args.remotes = [remote];
            }
        }
    }
}
