'use strict';
import { commands, ConfigurationTarget, Uri, window } from 'vscode';
import { BuiltInCommands } from './constants';
import { GitCommit } from './gitService';
import { Logger } from './logger';
import { configuration } from './configuration';

export enum SuppressedMessages {
    CommitHasNoPreviousCommitWarning = 'suppressCommitHasNoPreviousCommitWarning',
    CommitNotFoundWarning = 'suppressCommitNotFoundWarning',
    FileNotUnderSourceControlWarning = 'suppressFileNotUnderSourceControlWarning',
    GitVersionWarning = 'suppressGitVersionWarning',
    LineUncommittedWarning = 'suppressLineUncommittedWarning',
    NoRepositoryWarning = 'suppressNoRepositoryWarning',
    ResultsExplorerNotice = 'suppressResultsExplorerNotice',
    UpdateNotice = 'suppressUpdateNotice',
    WelcomeNotice = 'suppressWelcomeNotice'
}

export class Messages {

    static showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<string | undefined> {
        if (commit === undefined) return Messages.showMessage('info', `Commit has no previous commit`, SuppressedMessages.CommitHasNoPreviousCommitWarning);
        return Messages.showMessage('info', `Commit ${commit.shortSha} (${commit.author}, ${commit.formattedDate}) has no previous commit`, SuppressedMessages.CommitHasNoPreviousCommitWarning);
    }

    static showCommitNotFoundWarningMessage(message: string): Promise<string | undefined> {
        return Messages.showMessage('warn', `${message}. The commit could not be found`, SuppressedMessages.CommitNotFoundWarning);
    }

    static showFileNotUnderSourceControlWarningMessage(message: string): Promise<string | undefined> {
        return Messages.showMessage('warn', `${message}. The file is probably not under source control`, SuppressedMessages.FileNotUnderSourceControlWarning);
    }

    static showLineUncommittedWarningMessage(message: string): Promise<string | undefined> {
        return Messages.showMessage('warn', `${message}. The line has uncommitted changes`, SuppressedMessages.LineUncommittedWarning);
    }

    static showNoRepositoryWarningMessage(message: string): Promise<string | undefined> {
        return Messages.showMessage('warn', `${message}. No repository could be found`, SuppressedMessages.NoRepositoryWarning);
    }

    static showResultExplorerInfoMessage(): Promise<string | undefined> {
        return Messages.showMessage('info', `If you can't find your results, click on "GITLENS RESULTS" at the bottom of the Explorer view`, SuppressedMessages.ResultsExplorerNotice, null);
    }

    static showUnsupportedGitVersionErrorMessage(version: string): Promise<string | undefined> {
        return Messages.showMessage('error', `GitLens requires a newer version of Git (>= 2.2.0) than is currently installed (${version}). Please install a more recent version of Git`, SuppressedMessages.GitVersionWarning);
    }

    static async showUpdateMessage(version: string): Promise<string | undefined> {
        const viewReleaseNotes = 'View Release Notes';
        const result = await Messages.showMessage('info', `GitLens has been updated to v${version}`, SuppressedMessages.UpdateNotice, undefined, viewReleaseNotes);
        if (result === viewReleaseNotes) {
            commands.executeCommand(BuiltInCommands.Open, Uri.parse('https://marketplace.visualstudio.com/items/eamodio.gitlens/changelog'));
        }
        return result;
    }

    private static async showMessage(type: 'info' | 'warn' | 'error', message: string, suppressionKey: SuppressedMessages, dontShowAgain: string | null = 'Don\'t Show Again', ...actions: any[]): Promise<string | undefined> {
        Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain})`);

        if (configuration.get<boolean>(configuration.name('advanced')('messages')(suppressionKey).value)) {
            Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain}) skipped`);
            return undefined;
        }

        if (dontShowAgain !== null) {
            actions.push(dontShowAgain);
        }

        let result: string | undefined = undefined;
        switch (type) {
            case 'info':
                result = await window.showInformationMessage(message, ...actions);
                break;

            case 'warn':
                result = await window.showWarningMessage(message, ...actions);
                break;

            case 'error':
                result = await window.showErrorMessage(message, ...actions);
                break;
        }

        if (dontShowAgain === null || result === dontShowAgain) {
            Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain}) don't show again requested`);

            const section = configuration.name('advanced')('messages').value;
            const messages: { [key: string]: boolean } = configuration.get(section);
            messages[suppressionKey] = true;
            await configuration.update(section, messages, ConfigurationTarget.Global);

            if (result === dontShowAgain) return undefined;
        }

        Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain}) returned ${result}`);
        return result;
    }
}