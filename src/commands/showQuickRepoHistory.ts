'use strict';
import { Iterables } from '../system';
import { commands, QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Command } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitCommit, GitUri } from '../gitProvider';
import { Logger } from '../logger';
import * as moment from 'moment';
import * as path from 'path';

class CommitQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string;

    constructor(public commit: GitCommit) {
        this.label = `${commit.author}, ${moment(commit.date).fromNow()}`;
        this.description = `\u2022 ${commit.sha} \u2014 ${commit.fileName}`;
        this.detail = commit.message;
    }
}

class FileQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string;
    uri: GitUri;

    constructor(commit: GitCommit, public fileName: string) {
        this.label = fileName;
        this.uri = GitUri.fromUri(Uri.file(path.resolve(commit.repoPath, fileName)));
    }
}

export default class ShowQuickRepoHistoryCommand extends Command {
    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.ShowQuickRepoHistory);
    }

    async execute(uri?: Uri) {
        if (!(uri instanceof Uri)) {
            const document = window.activeTextEditor && window.activeTextEditor.document;
            if (document)  {
                uri = document.uri;
            }
        }

        try {
            let repoPath: string;
            if (uri instanceof Uri) {
                const gitUri = GitUri.fromUri(uri);
                repoPath = gitUri.repoPath;

                if (!repoPath) {
                    repoPath = await this.git.getRepoPathFromFile(gitUri.fsPath);
                }
            }

            if (!repoPath) {
                repoPath = this.repoPath;
            }

            if (!repoPath) return window.showWarningMessage(`Unable to show repository history`);

            const log = await this.git.getLogForRepo(repoPath);
            if (!log) return window.showWarningMessage(`Unable to show repository history`);

            const items = Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c));
            const commitPick = await window.showQuickPick(Array.from(items), <QuickPickOptions>{
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (commitPick) {
                const items = commitPick.commit.fileName.split(', ').map(f => new FileQuickPickItem(commitPick.commit, f));
                const filePick = await window.showQuickPick(items, <QuickPickOptions>{
                    matchOnDescription: true,
                    matchOnDetail: true,
                    placeHolder: `${commitPick.commit.author}, ${moment(commitPick.commit.date).fromNow()} \u2022 ${commitPick.commit.sha}`
                });

                if (filePick) {
                    const commit = new GitCommit(commitPick.commit.repoPath, commitPick.commit.sha, filePick.fileName, commitPick.commit.author, commitPick.commit.date, commitPick.commit.message, undefined, undefined, commitPick.commit.previousSha);
                    return commands.executeCommand(Commands.DiffWithWorking, filePick.uri, commit);
                }
            }

            return undefined;
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickRepoHistoryCommand]', 'getLogLocations', ex);
            return window.showErrorMessage(`Unable to show repository history. See output channel for more details`);
        }
    }
}