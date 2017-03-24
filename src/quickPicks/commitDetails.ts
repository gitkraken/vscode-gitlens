'use strict';
import { Arrays, Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard, KeyNoopCommand } from '../commands';
import { GitLogCommit, GitService, IGitLog } from '../gitService';
import { CommandQuickPickItem, CommitWithFileStatusQuickPickItem, getQuickPickIgnoreFocusOut, KeyCommandQuickPickItem, OpenFilesCommandQuickPickItem, OpenRemotesCommandQuickPickItem } from '../quickPicks';
import * as moment from 'moment';
import * as path from 'path';

export class OpenCommitFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitLogCommit, item?: QuickPickItem) {
        const repoPath = commit.repoPath;
        const uris = commit.fileStatuses.map(_ => GitService.toGitContentUri(commit.sha, _.fileName, repoPath, commit.originalFileName));
        super(uris, item || {
            label: `$(file-symlink-file) Open Changed Files`,
            description: `\u00a0 \u2014 \u00a0\u00a0 in \u00a0$(git-commit) ${commit.shortSha}`
            //detail: `Opens all of the changed files in $(git-commit) ${commit.shortSha}`
        });
    }
}

export class OpenCommitWorkingTreeFilesCommandQuickPickItem extends OpenFilesCommandQuickPickItem {

    constructor(commit: GitLogCommit, versioned: boolean = false, item?: QuickPickItem) {
        const repoPath = commit.repoPath;
        const uris = commit.fileStatuses.map(_ => Uri.file(path.resolve(repoPath, _.fileName)));
        super(uris, item || {
            label: `$(file-symlink-file) Open Changed Working Files`,
            description: undefined
            //detail: `Opens all of the changed file in the working tree`
        });
    }
}

export class CommitDetailsQuickPick {

    static async show(git: GitService, commit: GitLogCommit, uri: Uri, goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem, repoLog?: IGitLog): Promise<CommitWithFileStatusQuickPickItem | CommandQuickPickItem | undefined> {
        const items: (CommitWithFileStatusQuickPickItem | CommandQuickPickItem)[] = commit.fileStatuses.map(fs => new CommitWithFileStatusQuickPickItem(commit, fs.fileName, fs.status));

        let index = 0;

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Sha to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.shortSha}`
        }, Commands.CopyShaToClipboard, [uri, commit.sha]));

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Message to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 ${commit.message}`
        }, Commands.CopyMessageToClipboard, [uri, commit.sha, commit.message]));

        const remotes = Arrays.uniqueBy(await git.getRemotes(git.repoPath), _ => _.url, _ => !!_.provider);
        if (remotes.length) {
            items.splice(index++, 0, new OpenRemotesCommandQuickPickItem(remotes, 'commit', commit.sha, currentCommand));
        }

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(git-compare) Directory Compare with Previous Commit`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.previousShortSha || `${commit.shortSha}^`} \u00a0 $(git-compare) \u00a0 $(git-commit) ${commit.shortSha}`
        }, Commands.DiffDirectory, [commit.uri, commit.previousSha || `${commit.sha}^`, commit.sha]));

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `$(git-compare) Directory Compare with Working Tree`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.shortSha} \u00a0 $(git-compare) \u00a0 $(file-directory) Working Tree`
        }, Commands.DiffDirectory, [uri, commit.sha]));

        const added = commit.fileStatuses.filter(_ => _.status === 'A' || _.status === '?').length;
        const deleted = commit.fileStatuses.filter(_ => _.status === 'D').length;
        const changed = commit.fileStatuses.filter(_ => _.status !== 'A' && _.status !== '?' && _.status !== 'D').length;

        items.splice(index++, 0, new CommandQuickPickItem({
            label: `Changed Files`,
            description: `+${added} ~${changed} -${deleted}`
        }, Commands.ShowQuickCommitDetails, [uri, commit.sha, commit, goBackCommand, repoLog]));

        items.push(new OpenCommitFilesCommandQuickPickItem(commit));
        items.push(new OpenCommitWorkingTreeFilesCommandQuickPickItem(commit));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        let previousCommand: CommandQuickPickItem | (() => Promise<CommandQuickPickItem>);
        let nextCommand: CommandQuickPickItem | (() => Promise<CommandQuickPickItem>);
        // If we have the full history, we are good
        if (repoLog && !repoLog.truncated) {
            previousCommand = commit.previousSha && new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [commit.previousUri, commit.previousSha, undefined, goBackCommand, repoLog]);
            nextCommand = commit.nextSha && new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [commit.nextUri, commit.nextSha, undefined, goBackCommand, repoLog]);
        }
        else {
            previousCommand = async () => {
                let log = repoLog;
                let c = log && log.commits.get(commit.sha);

                // If we can't find the commit or the previous commit isn't available (since it isn't trustworthy)
                if (!c || !c.previousSha) {
                    log = await git.getLogForRepo(commit.repoPath, commit.sha, git.config.advanced.maxQuickHistory);
                    c = log && log.commits.get(commit.sha);

                    if (c) {
                        // Copy over next info, since it is trustworthy at this point
                        c.nextSha = commit.nextSha;
                    }
                }
                if (!c) return KeyNoopCommand;
                return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [c.previousUri, c.previousSha, undefined, goBackCommand, log]);
            };

            nextCommand = async () => {
                let log = repoLog;
                let c = log && log.commits.get(commit.sha);

                // If we can't find the commit or the next commit isn't available (since it isn't trustworthy)
                if (!c || !c.nextSha) {
                    log = undefined;
                    c = undefined;

                    // Try to find the next commit
                    const nextLog = await git.getLogForRepo(commit.repoPath, commit.sha, 1, true);
                    const next = nextLog && Iterables.first(nextLog.commits.values());
                    if (next && next.sha !== commit.sha) {
                        c = commit;
                        c.nextSha = next.sha;
                    }
                }
                if (!c) return KeyNoopCommand;
                return new KeyCommandQuickPickItem(Commands.ShowQuickCommitDetails, [c.nextUri, c.nextSha, undefined, goBackCommand, log]);
            };
        }

        const scope = await Keyboard.instance.beginScope({
            left: goBackCommand,
            ',': previousCommand,
            '.': nextCommand
        });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.shortSha} \u00a0\u2022\u00a0 ${commit.author}, ${moment(commit.date).fromNow()} \u00a0\u2022\u00a0 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                scope.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}