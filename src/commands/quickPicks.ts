'use strict';
import { Iterables } from '../system';
import { QuickPickOptions, Uri, window, workspace } from 'vscode';
import { IAdvancedConfig } from '../configuration';
import { Commands } from '../commands';
import GitProvider, { GitCommit, GitFileStatus, GitFileStatusItem, GitUri, IGitLog } from '../gitProvider';
import { CommandQuickPickItem, CommitQuickPickItem, FileQuickPickItem, OpenCommitFileCommandQuickPickItem, OpenStatusFileCommandQuickPickItem, OpenCommitFilesCommandQuickPickItem, OpenStatusFilesCommandQuickPickItem } from './quickPickItems';
import * as moment from 'moment';
import * as path from 'path';

function getQuickPickIgnoreFocusOut() {
    return !workspace.getConfiguration('gitlens').get<IAdvancedConfig>('advanced').quickPick.closeOnFocusOut;
}

export class CommitQuickPick {

    static async show(git: GitProvider, commit: GitCommit, workingFileName: string, uri: Uri, currentCommand?: CommandQuickPickItem, goBackCommand?: CommandQuickPickItem, options: { showFileHistory?: boolean } = {}): Promise<CommandQuickPickItem | undefined> {
        const items: CommandQuickPickItem[] = [];

        const workingName = (workingFileName && path.basename(workingFileName)) || path.basename(commit.fileName);

        const isUncommitted = commit.isUncommitted;
        if (isUncommitted) {
            // Since we can't trust the previous sha on an uncommitted commit, find the last commit for this file
            const log = await git.getLogForFile(commit.uri.fsPath, undefined, undefined, undefined, 2);
            if (!log) return undefined;

            commit = Iterables.first(log.commits.values());
        }

        if (commit.previousSha) {
            items.push(new CommandQuickPickItem({
                label: `$(git-compare) Compare with Previous Commit`,
                description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.previousSha} \u00a0 $(git-compare) \u00a0 $(git-commit) ${commit.sha}`
            }, Commands.DiffWithPrevious, [commit.uri, commit]));
        }

        items.push(new CommandQuickPickItem({
            label: `$(git-compare) Compare with Working Tree`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha} \u00a0 $(git-compare) \u00a0 $(file-text) ${workingName}`
        }, Commands.DiffWithWorking, [uri, commit]));

        items.push(new OpenCommitFileCommandQuickPickItem(commit));

        items.push(new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Sha to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha}`
        }, Commands.CopyShaToClipboard, [uri, commit.sha]));

        items.push(new CommandQuickPickItem({
            label: `$(clippy) Copy Commit Message to Clipboard`,
            description: `\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.message}`
        }, Commands.CopyMessageToClipboard, [uri, commit.sha, commit.message]));

        items.push(new CommandQuickPickItem({
            label: `$(diff) Show Changed Files`,
            description: undefined, //`\u00a0 \u2014 \u00a0\u00a0 $(git-commit) ${commit.sha}`,
            detail: `Shows all of the changed files in commit $(git-commit) ${commit.sha}`
        }, Commands.ShowQuickCommitDetails, [new GitUri(commit.uri, commit), commit.sha, undefined, currentCommand]));

        if (options.showFileHistory) {
            if (workingFileName) {
                items.push(new CommandQuickPickItem({
                    label: `$(versions) Show Commit History`,
                    description: undefined, //`\u00a0 \u2014 \u00a0\u00a0 ${path.basename(commit.fileName)}`,
                    detail: `Shows the commit history of the file, starting at the most recent commit`
                }, Commands.ShowQuickFileHistory, [commit.uri, undefined, undefined, currentCommand]));
            }

            items.push(new CommandQuickPickItem({
                label: `$(versions) Show Previous Commit History`,
                description: undefined, //`\u00a0 \u2014 \u00a0\u00a0 ${path.basename(commit.fileName)}`,
                detail: `Shows the previous commit history of the file, starting at $(git-commit) ${commit.sha}`
            }, Commands.ShowQuickFileHistory, [new GitUri(commit.uri, commit), undefined, undefined, currentCommand]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        return await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: `${path.basename(commit.fileName)} \u00a0\u2022\u00a0 ${path.dirname(commit.fileName)} \u2022 ${isUncommitted ? 'Uncommitted \u21E8 ' : '' }${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()} \u2022 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        } as QuickPickOptions);
    }
}

export class CommitFilesQuickPick {

    static async show(commit: GitCommit, uri: Uri, goBackCommand?: CommandQuickPickItem): Promise<FileQuickPickItem | CommandQuickPickItem | undefined> {
        const fileNames = commit.fileName.split(', ').filter(_ => !!_);
        const items: (FileQuickPickItem | CommandQuickPickItem)[] = fileNames.map(f => new FileQuickPickItem(commit, f));

        items.splice(0, 0, new OpenCommitFilesCommandQuickPickItem(commit, fileNames));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const result = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()} \u2022 ${commit.message}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     if (item instanceof FileQuickPickItem) {
            //         item.preview();
            //     }
            // }
        } as QuickPickOptions);

        return result;
    }
}

export class FileCommitsQuickPick {

    static async show(log: IGitLog, uri: Uri, maxCount: number, defaultMaxCount: number, goBackCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (maxCount !== 0 && items.length >= defaultMaxCount) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(sync) Show All Commits`,
                description: `\u00a0 \u2014 \u00a0\u00a0 Currently only showing the first ${defaultMaxCount} commits`,
                detail: `This may take a while`
            }, Commands.ShowQuickFileHistory, [uri, 0, undefined, goBackCommand]));
        }

        // Only show the full repo option if we are the root
        if (!goBackCommand) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(repo) Show Repository History`,
                description: null,
                detail: 'Shows the commit history of the repository'
            }, Commands.ShowQuickRepoHistory, [undefined, undefined, undefined, new CommandQuickPickItem({
                label: `go back \u21A9`,
                description: null
            }, Commands.ShowQuickFileHistory, [uri, maxCount])]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const fileName = Iterables.first(log.commits.values()).fileName;

        return await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${path.basename(fileName)} \u00a0\u2022\u00a0 ${path.dirname(fileName)}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        } as QuickPickOptions);
    }
}

export class RepoCommitsQuickPick {

    static async show(log: IGitLog, uri: Uri, maxCount: number, defaultMaxCount: number, goBackCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c, ` \u2014 ${c.fileName}`))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (maxCount !== 0 && items.length >= defaultMaxCount) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(sync) Show All Commits`,
                description: `\u00a0 \u2014 \u00a0\u00a0 Currently only showing the first ${defaultMaxCount} commits`,
                detail: `This may take a while`
            }, Commands.ShowQuickRepoHistory, [uri, 0, undefined, goBackCommand]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        return await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: 'Search by commit message, filename, or sha',
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        } as QuickPickOptions);
    }
}

export class RepoStatusesQuickPick {

    static async show(statuses: GitFileStatusItem[], goBackCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        // Sort the status by staged and then filename
        statuses.sort((a, b) => (a.staged ? -1 : 1) - (b.staged ? -1 : 1) || a.fileName.localeCompare(b.fileName));

        const items = Array.from(Iterables.map(statuses, s => new OpenStatusFileCommandQuickPickItem(s))) as (OpenStatusFileCommandQuickPickItem | CommandQuickPickItem)[];

        if (statuses.some(_ => _.staged)) {
            const index = statuses.findIndex(_ => !_.staged);
            if (index > -1) {
                items.splice(index, 0, new OpenStatusFilesCommandQuickPickItem(statuses.filter(_ => _.status !== GitFileStatus.Deleted && !_.staged), {
                    label: `$(file-symlink-file) Open Unstaged Files`,
                    description: undefined,
                    detail: `Opens all of the unstaged files in the repository`
                }));

                items.splice(0, 0, new OpenStatusFilesCommandQuickPickItem(statuses.filter(_ => _.status !== GitFileStatus.Deleted && _.staged), {
                    label: `$(file-symlink-file) Open Staged Files`,
                    description: undefined,
                    detail: `Opens all of the staged files in the repository`
                }));
            }
        }
        items.splice(0, 0, new OpenStatusFilesCommandQuickPickItem(statuses.filter(_ => _.status !== GitFileStatus.Deleted)));

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        return await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: 'Showing the repository status',
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        } as QuickPickOptions);
    }
}