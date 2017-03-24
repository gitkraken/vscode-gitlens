'use strict';
import { Arrays, Iterables } from '../system';
import { CancellationTokenSource, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard, KeyNoopCommand } from '../commands';
import { GitService, GitUri, IGitLog } from '../gitService';
import { CommandQuickPickItem, CommitQuickPickItem, getQuickPickIgnoreFocusOut, OpenRemotesCommandQuickPickItem, showQuickPickProgress } from '../quickPicks';
import * as path from 'path';

export class FileHistoryQuickPick {

    static showProgress(uri: GitUri) {
        return showQuickPickProgress(`${uri.getFormattedPath()}${uri.sha ? ` \u00a0\u2022\u00a0 ${uri.shortSha}` : ''}`,
            {
                left: KeyNoopCommand,
                ',': KeyNoopCommand,
                '.': KeyNoopCommand
            });
    }

    static async show(git: GitService, log: IGitLog, uri: GitUri, progressCancellation: CancellationTokenSource, goBackCommand?: CommandQuickPickItem, nextPageCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        let previousPageCommand: CommandQuickPickItem;

        let index = 0;
        if (log.truncated || uri.sha) {
            if (log.truncated) {
                index++;
                items.splice(0, 0, new CommandQuickPickItem({
                    label: `$(sync) Show All Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 this may take a while`
                }, Commands.ShowQuickFileHistory, [Uri.file(uri.fsPath), undefined, 0, goBackCommand]));
            }
            else {
                const workingFileName = await git.findWorkingFileName(log.repoPath, path.relative(log.repoPath, uri.fsPath));
                if (workingFileName) {
                    index++;
                    items.splice(0, 0, new CommandQuickPickItem({
                        label: `$(history) Show File History`,
                        description: `\u00a0 \u2014 \u00a0\u00a0 of ${path.basename(workingFileName)}`
                    }, Commands.ShowQuickFileHistory, [
                        Uri.file(path.resolve(log.repoPath, workingFileName)),
                        undefined,
                        undefined,
                        new CommandQuickPickItem({
                            label: `go back \u21A9`,
                            description: `\u00a0 \u2014 \u00a0\u00a0 to history of \u00a0$(file-text) ${path.basename(uri.fsPath)}${uri.sha ? ` from \u00a0$(git-commit) ${uri.shortSha}` : ''}`
                        }, Commands.ShowQuickFileHistory, [uri, log.range, log.maxCount, goBackCommand, log])
                    ]));
                }
            }

            if (nextPageCommand) {
                index++;
                items.splice(0, 0, nextPageCommand);
            }

            if (log.truncated) {
                const npc = new CommandQuickPickItem({
                    label: `$(arrow-right) Show Next Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 shows ${log.maxCount} newer commits`
                }, Commands.ShowQuickFileHistory, [uri, undefined, log.maxCount, goBackCommand, undefined, nextPageCommand]);

                const last = Iterables.last(log.commits.values());

                previousPageCommand = new CommandQuickPickItem({
                    label: `$(arrow-left) Show Previous Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 shows ${log.maxCount} older commits`
                }, Commands.ShowQuickFileHistory, [new GitUri(uri, last), undefined, log.maxCount, goBackCommand, undefined, npc]);

                index++;
                items.splice(0, 0, previousPageCommand);
            }
        }

        const currentCommand = new CommandQuickPickItem({
            label: `go back \u21A9`,
            description: `\u00a0 \u2014 \u00a0\u00a0 to history of \u00a0$(file-text) ${path.basename(uri.fsPath)}${uri.sha ? ` from \u00a0$(git-commit) ${uri.shortSha}` : ''}`
        }, Commands.ShowQuickFileHistory, [uri, log.range, log.maxCount, undefined, log]);

        // Only show the full repo option if we are the root
        if (!goBackCommand) {
            items.splice(index++, 0, new CommandQuickPickItem({
                label: `$(history) Show Branch History`,
                description: `\u00a0 \u2014 \u00a0\u00a0 shows the current branch history`
            }, Commands.ShowQuickCurrentBranchHistory,
                [
                    undefined,
                    currentCommand
                ]));
        }

        const remotes = Arrays.uniqueBy(await git.getRemotes(git.repoPath), _ => _.url, _ => !!_.provider);
        if (remotes.length) {
            items.splice(index++, 0, new OpenRemotesCommandQuickPickItem(remotes, 'file', uri.getRelativePath(), uri.sha, undefined, currentCommand));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        if (progressCancellation.token.isCancellationRequested) return undefined;

        const scope = await Keyboard.instance.beginScope({
            left: goBackCommand,
            ',': previousPageCommand,
            '.': nextPageCommand
        });

        const commit = Iterables.first(log.commits.values());

        progressCancellation.cancel();

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.getFormattedPath()}${uri.sha ? ` \u00a0\u2022\u00a0 ${uri.shortSha}` : ''}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}