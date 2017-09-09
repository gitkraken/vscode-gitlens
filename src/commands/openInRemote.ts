'use strict';
import { Strings } from '../system';
import { TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { GitLogCommit, GitRemote, GitService, RemoteResource } from '../gitService';
import { Logger } from '../logger';
import { CommandQuickPickItem, OpenRemoteCommandQuickPickItem, RemotesQuickPick } from '../quickPicks';

export interface OpenInRemoteCommandArgs {
    remote?: string;
    remotes?: GitRemote[];
    resource?: RemoteResource;

    goBackCommand?: CommandQuickPickItem;
}

export class OpenInRemoteCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.OpenInRemote);
    }

    async execute(editor: TextEditor, uri?: Uri, args: OpenInRemoteCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

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
                const command = new OpenRemoteCommandQuickPickItem(args.remotes[0], args.resource);
                return command.execute();
            }

            let placeHolder = '';
            switch (args.resource.type) {
                case 'branch':
                    this.ensureRemoteBranchName(args);
                    placeHolder = `open ${args.resource.branch} branch in${GlyphChars.Ellipsis}`;
                    break;

                case 'commit':
                    const shortSha = GitService.shortenSha(args.resource.sha);
                    placeHolder = `open commit ${shortSha} in${GlyphChars.Ellipsis}`;
                    break;

                case 'file':
                    placeHolder = `open ${args.resource.fileName} in${GlyphChars.Ellipsis}`;
                    break;

                case 'revision':
                    if (args.resource.commit !== undefined && args.resource.commit instanceof GitLogCommit) {
                        if (args.resource.commit.status === 'D') {
                            args.resource.sha = args.resource.commit.previousSha;
                            placeHolder = `open ${args.resource.fileName} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${args.resource.commit.previousShortSha} in${GlyphChars.Ellipsis}`;
                        }
                        else {
                            args.resource.sha = args.resource.commit.sha;
                            placeHolder = `open ${args.resource.fileName} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${args.resource.commit.shortSha} in${GlyphChars.Ellipsis}`;
                        }
                    }
                    else {
                        const shortFileSha = args.resource.sha === undefined ? '' : GitService.shortenSha(args.resource.sha);
                        const shaSuffix = shortFileSha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${shortFileSha}` : '';

                        placeHolder = `open ${args.resource.fileName}${shaSuffix} in${GlyphChars.Ellipsis}`;
                    }
                    break;
            }

            if (args.remotes.length === 1) {
                const command = new OpenRemoteCommandQuickPickItem(args.remotes[0], args.resource);
                return command.execute();
            }

            const pick = await RemotesQuickPick.show(args.remotes, placeHolder, args.resource, args.goBackCommand);
            if (pick === undefined) return undefined;

            return pick.execute();

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