'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri, getRepoPathOrActiveOrPrompt, isCommandViewContextWithBranch } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../gitService';
import { Logger } from '../logger';
import { BranchesQuickPick, CommandQuickPickItem } from '../quickPicks/quickPicks';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenBranchInRemoteCommandArgs {
    branch?: string;
    remote?: string;
}

export class OpenBranchInRemoteCommand extends ActiveEditorCommand {

    constructor() {
        super(Commands.OpenBranchInRemote);
    }

    protected async preExecute(context: CommandContext, args: OpenBranchInRemoteCommandArgs = {}): Promise<any> {
        if (isCommandViewContextWithBranch(context)) {
            args = { ...args };
            args.branch = context.node.branch.name;
            args.remote = context.node.branch.getRemote();
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenBranchInRemoteCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && await GitUri.fromUri(uri);

        const repoPath = await getRepoPathOrActiveOrPrompt(gitUri, editor, `Open branch in remote for which repository${GlyphChars.Ellipsis}`);
        if (!repoPath) return undefined;

        try {
            if (args.branch === undefined) {
                args = { ...args };

                const branches = await Container.git.getBranches(repoPath);

                const pick = await BranchesQuickPick.show(branches, `Open which branch in remote${GlyphChars.Ellipsis}`);
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return undefined;

                args.branch = pick.branch.name;
                if (args.branch === undefined) return undefined;
            }

            const remotes = await Container.git.getRemotes(repoPath);

            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: 'branch',
                    branch: args.branch
                },
                remote: args.remote,
                remotes
            } as OpenInRemoteCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'OpenBranchInRemoteCommandArgs');
            return window.showErrorMessage(`Unable to open branch in remote provider. See output channel for more details`);
        }
    }
}