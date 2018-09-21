'use strict';
import { CancellationTokenSource, commands, TextEditor, Uri, window } from 'vscode';
import { BuiltInCommands, GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { BranchesAndTagsQuickPick, CommandQuickPickItem } from '../quickpicks';
import { ResultsComparisonNode } from '../views/nodes';
import {
    ActiveEditorCommand,
    CommandContext,
    Commands,
    getCommandUri,
    getRepoPathOrActiveOrPrompt,
    isCommandViewContextWithRef
} from './common';

export interface DiffDirectoryCommandArgs {
    ref1?: string;
    ref2?: string;
}

export class DiffDirectoryCommand extends ActiveEditorCommand {
    constructor() {
        super([
            Commands.DiffDirectory,
            Commands.ExplorersOpenDirectoryDiff,
            Commands.ExplorersOpenDirectoryDiffWithWorking
        ]);
    }

    protected async preExecute(context: CommandContext, args: DiffDirectoryCommandArgs = {}): Promise<any> {
        switch (context.command) {
            case Commands.ExplorersOpenDirectoryDiff:
                if (context.type === 'view' && context.node instanceof ResultsComparisonNode) {
                    args.ref1 = context.node.ref1.ref;
                    args.ref2 = context.node.ref2.ref;
                }
                break;

            case Commands.ExplorersOpenDirectoryDiffWithWorking:
                if (isCommandViewContextWithRef(context)) {
                    args.ref1 = context.node.ref;
                    args.ref2 = undefined;
                }
                break;
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffDirectoryCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);

        let progressCancellation: CancellationTokenSource | undefined;

        try {
            const repoPath = await getRepoPathOrActiveOrPrompt(
                uri,
                editor,
                `Compare directory in which repository${GlyphChars.Ellipsis}`
            );
            if (!repoPath) return undefined;

            if (!args.ref1) {
                args = { ...args };

                const placeHolder = `Compare Working Tree to${GlyphChars.Ellipsis}`;

                progressCancellation = BranchesAndTagsQuickPick.showProgress(placeHolder);

                const [branches, tags] = await Promise.all([
                    Container.git.getBranches(repoPath),
                    Container.git.getTags(repoPath)
                ]);

                if (progressCancellation.token.isCancellationRequested) return undefined;

                const pick = await BranchesAndTagsQuickPick.show(branches, tags, placeHolder, {
                    progressCancellation: progressCancellation
                });
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return pick.execute();

                args.ref1 = pick.name;
                if (args.ref1 === undefined) return undefined;
            }

            await Container.git.openDirectoryDiff(repoPath, args.ref1, args.ref2);
            return undefined;
        }
        catch (ex) {
            const msg = ex && ex.toString();
            if (msg === 'No diff tool found') {
                const result = await window.showWarningMessage(
                    `Unable to open directory compare because there is no Git diff tool configured`,
                    'View Git Docs'
                );
                if (!result) return undefined;

                return commands.executeCommand(
                    BuiltInCommands.Open,
                    Uri.parse('https://git-scm.com/docs/git-config#git-config-difftool')
                );
            }

            Logger.error(ex, 'DiffDirectoryCommand');
            return Messages.showGenericErrorMessage('Unable to open directory compare');
        }
        finally {
            progressCancellation && progressCancellation.cancel();
        }
    }
}
