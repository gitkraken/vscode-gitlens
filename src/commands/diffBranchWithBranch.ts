'use strict';
import { CancellationTokenSource, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, CommandContext, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { BranchesAndTagsQuickPick, CommandQuickPickItem } from '../quickPicks/quickPicks';

export interface DiffBranchWithBranchCommandArgs {
    ref1?: string;
    ref2?: string;
}

export class DiffBranchWithBranchCommand extends ActiveEditorCommand {

    constructor() {
        super([Commands.DiffHeadWithBranch, Commands.DiffWorkingWithBranch]);
    }

    protected async preExecute(context: CommandContext, args: DiffBranchWithBranchCommandArgs = {}): Promise<any> {
        switch (context.command) {
            case Commands.DiffHeadWithBranch:
                args.ref2 = 'HEAD';
                break;

            case Commands.DiffWorkingWithBranch:
                args.ref2 = '';
                break;
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffBranchWithBranchCommandArgs = {}): Promise<any> {
        if (args.ref2 === undefined) return;

        uri = getCommandUri(uri, editor);

        let progressCancellation: CancellationTokenSource | undefined;

        try {
            const repoPath = await Container.git.getRepoPath(uri);
            if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to open branch compare`);

            if (!args.ref1) {
                let placeHolder;
                switch (args.ref2) {
                    case '':
                        placeHolder = `Compare Working Tree to ${GlyphChars.Ellipsis}`;
                        break;
                    case 'HEAD':
                        placeHolder = `Compare Index (HEAD) to ${GlyphChars.Ellipsis}`;
                        break;
                    default:
                        placeHolder = `Compare ${args.ref2} to ${GlyphChars.Ellipsis}`;
                        break;
                }

                 progressCancellation = BranchesAndTagsQuickPick.showProgress(placeHolder);

                const [branches, tags] = await Promise.all([
                    Container.git.getBranches(repoPath),
                    Container.git.getTags(repoPath)
                ]);

                if (progressCancellation.token.isCancellationRequested) return undefined;

                const pick = await BranchesAndTagsQuickPick.show(branches, tags, placeHolder, { progressCancellation: progressCancellation });
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return pick.execute();

                args.ref1 = pick.name;
                if (args.ref1 === undefined) return undefined;
            }

            Container.resultsExplorer.showComparisonInResults(repoPath, args.ref1, args.ref2);

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'DiffBranchWithBranchCommand');
            return window.showErrorMessage(`Unable to open branch compare. See output channel for more details`);
        }
        finally {
            progressCancellation && progressCancellation.dispose();
        }
    }
}