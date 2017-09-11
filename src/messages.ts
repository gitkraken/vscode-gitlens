'use strict';
import { commands, ExtensionContext, Uri, window } from 'vscode';
import { BuiltInCommands } from './constants';
import { GitCommit } from './gitService';
import { Logger } from './logger';
import * as moment from 'moment';

export type SuppressedKeys = 'suppressCommitHasNoPreviousCommitWarning' |
    'suppressCommitNotFoundWarning' |
    'suppressFileNotUnderSourceControlWarning' |
    'suppressGitVersionWarning' |
    'suppressLineUncommittedWarning' |
    'suppressNoRepositoryWarning' |
    'suppressUpdateNotice' |
    'suppressWelcomeNotice';
export const SuppressedKeys = {
    CommitHasNoPreviousCommitWarning: 'suppressCommitHasNoPreviousCommitWarning' as SuppressedKeys,
    CommitNotFoundWarning: 'suppressCommitNotFoundWarning' as SuppressedKeys,
    FileNotUnderSourceControlWarning: 'suppressFileNotUnderSourceControlWarning' as SuppressedKeys,
    GitVersionWarning: 'suppressGitVersionWarning' as SuppressedKeys,
    LineUncommittedWarning: 'suppressLineUncommittedWarning' as SuppressedKeys,
    NoRepositoryWarning: 'suppressNoRepositoryWarning' as SuppressedKeys,
    UpdateNotice: 'suppressUpdateNotice' as SuppressedKeys,
    WelcomeNotice: 'suppressWelcomeNotice' as SuppressedKeys
};

export class Messages {

    static context: ExtensionContext;

    static configure(context: ExtensionContext) {
        this.context = context;
    }

    static showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<string | undefined> {
        if (commit === undefined) return Messages._showMessage('info', `Commit has no previous commit`, SuppressedKeys.CommitHasNoPreviousCommitWarning);
        return Messages._showMessage('info', `Commit ${commit.shortSha} (${commit.author}, ${moment(commit.date).fromNow()}) has no previous commit`, SuppressedKeys.CommitHasNoPreviousCommitWarning);
    }

    static showCommitNotFoundWarningMessage(message: string): Promise<string | undefined> {
        return Messages._showMessage('warn', `${message}. The commit could not be found`, SuppressedKeys.CommitNotFoundWarning);
    }

    static showFileNotUnderSourceControlWarningMessage(message: string): Promise<string | undefined> {
        return Messages._showMessage('warn', `${message}. The file is probably not under source control`, SuppressedKeys.FileNotUnderSourceControlWarning);
    }

    static showLineUncommittedWarningMessage(message: string): Promise<string | undefined> {
        return Messages._showMessage('warn', `${message}. The line has uncommitted changes`, SuppressedKeys.LineUncommittedWarning);
    }

    static showNoRepositoryWarningMessage(message: string): Promise<string | undefined> {
        return Messages._showMessage('warn', `${message}. No repository could be found`, SuppressedKeys.NoRepositoryWarning);
    }

    static showUnsupportedGitVersionErrorMessage(version: string): Promise<string | undefined> {
        return Messages._showMessage('error', `GitLens requires a newer version of Git (>= 2.2.0) than is currently installed (${version}). Please install a more recent version of Git.`, SuppressedKeys.GitVersionWarning);
    }

    static async showUpdateMessage(version: string): Promise<string | undefined> {
        const viewReleaseNotes = 'View Release Notes';
        const result = await Messages._showMessage('info', `GitLens has been updated to v${version}`, SuppressedKeys.UpdateNotice, undefined, viewReleaseNotes);
        if (result === viewReleaseNotes) {
            commands.executeCommand(BuiltInCommands.Open, Uri.parse('https://marketplace.visualstudio.com/items/eamodio.gitlens/changelog'));
        }
        return result;
    }

    static async showWelcomeMessage(): Promise<string | undefined> {
        const viewDocs = 'View Docs';
        const result = await Messages._showMessage('info', `Thank you for choosing GitLens! GitLens is powerful, feature rich, and highly configurable, so please be sure to view the docs and tailor it to suit your needs.`, SuppressedKeys.WelcomeNotice, null, viewDocs);
        if (result === viewDocs) {
            commands.executeCommand(BuiltInCommands.Open, Uri.parse('https://marketplace.visualstudio.com/items/eamodio.gitlens'));
        }
        return result;
    }

    private static async _showMessage(type: 'info' | 'warn' | 'error', message: string, suppressionKey: SuppressedKeys, dontShowAgain: string | null = 'Don\'t Show Again', ...actions: any[]): Promise<string | undefined> {
        Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain})`);

        if (Messages.context.globalState.get(suppressionKey, false)) {
            Logger.log(`ShowMessage(${type}, ${message}, ${suppressionKey}, ${dontShowAgain}) skipped`);
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
            await Messages.context.globalState.update(suppressionKey, true);

            if (result === dontShowAgain) return undefined;
        }

        Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain}) returned ${result}`);
        return result;
    }
}