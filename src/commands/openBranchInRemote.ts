'use strict';
import { Arrays } from '../system';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';
import { BranchesQuickPick, CommandQuickPickItem } from '../quickPicks';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenBranchInRemoteCommandArgs {
    branch?: string;
}

export class OpenBranchInRemoteCommand extends ActiveEditorCommand {

    constructor(private git: GitService) {
        super(Commands.OpenBranchInRemote);
    }

    async execute(editor: TextEditor, uri?: Uri, args: OpenBranchInRemoteCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && await GitUri.fromUri(uri, this.git);

        const repoPath = gitUri === undefined ? this.git.repoPath : gitUri.repoPath;
        if (!repoPath) return undefined;

        try {
            if (args.branch === undefined) {
                const branches = await this.git.getBranches(repoPath);

                const pick = await BranchesQuickPick.show(branches, `Show history for branch\u2026`);
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return undefined;

                args.branch = pick.branch.name;
                if (args.branch === undefined) return undefined;
            }

            const remotes = Arrays.uniqueBy(await this.git.getRemotes(repoPath), _ => _.url, _ => !!_.provider);
            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: 'branch',
                    branch: args.branch
                },
                remotes
            } as OpenInRemoteCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'OpenBranchInRemoteCommandArgs');
            return window.showErrorMessage(`Unable to open branch in remote provider. See output channel for more details`);
        }
    }
}