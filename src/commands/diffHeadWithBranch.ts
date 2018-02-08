'use strict';
import { CancellationTokenSource, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { BranchesAndTagsQuickPick, CommandQuickPickItem } from '../quickPicks';

export class DiffHeadWithBranchCommand extends ActiveEditorCommand {

    constructor() {
        super([Commands.DiffHeadWithBranch]);
    }

    async execute(editor?: TextEditor, uri?: Uri): Promise<any> {
        uri = getCommandUri(uri, editor);

        let progressCancellation: CancellationTokenSource | undefined;

        try {
            const repoPath = await Container.git.getRepoPath(uri);
            if (!repoPath) return Messages.showNoRepositoryWarningMessage(`Unable to open directory compare`);

            const placeHolder = `Compare Index (HEAD) to ${GlyphChars.Ellipsis}`;

            progressCancellation = BranchesAndTagsQuickPick.showProgress(placeHolder);

            const [branches, tags] = await Promise.all([
                Container.git.getBranches(repoPath),
                Container.git.getTags(repoPath)
            ]);

            if (progressCancellation.token.isCancellationRequested) return undefined;

            const pick = await BranchesAndTagsQuickPick.show(branches, tags, placeHolder, { progressCancellation: progressCancellation });
            if (pick === undefined) return undefined;

            if (pick instanceof CommandQuickPickItem) return pick.execute();

            const compareWith = pick.name;
            if (compareWith === undefined) return undefined;

            Container.resultsExplorer.showComparisonInResults(repoPath, compareWith, 'HEAD');

            return undefined;
        } catch (ex) {
            Logger.error(ex, 'DiffHeadWithBranchCommand');
            return window.showErrorMessage(`Unable to open directory compare. See output channel for more details`);
        } finally {
            progressCancellation && progressCancellation.dispose();
        }
    }
}