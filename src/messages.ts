'use strict';
import { commands, ConfigurationTarget, env, MessageItem, Uri, window } from 'vscode';
import { Commands } from './commands';
import { configuration, ViewLocation } from './configuration';
import { CommandContext, setCommandContext } from './constants';
import { GitCommit } from './git/gitService';
import { Logger } from './logger';
import { Versions } from './system';
import { Container } from './container';

export enum SuppressedMessages {
    CommitHasNoPreviousCommitWarning = 'suppressCommitHasNoPreviousCommitWarning',
    CommitNotFoundWarning = 'suppressCommitNotFoundWarning',
    FileNotUnderSourceControlWarning = 'suppressFileNotUnderSourceControlWarning',
    GitDisabledWarning = 'suppressGitDisabledWarning',
    GitVersionWarning = 'suppressGitVersionWarning',
    LineUncommittedWarning = 'suppressLineUncommittedWarning',
    NoRepositoryWarning = 'suppressNoRepositoryWarning',
    SupportGitLensNotification = 'suppressSupportGitLensNotification'
}

export class Messages {
    static showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<MessageItem | undefined> {
        if (commit === undefined) {
            return Messages.showMessage(
                'info',
                'There is no previous commit.',
                SuppressedMessages.CommitHasNoPreviousCommitWarning
            );
        }
        return Messages.showMessage(
            'info',
            `Commit ${commit.shortSha} (${commit.author}, ${commit.formattedDate}) has no previous commit.`,
            SuppressedMessages.CommitHasNoPreviousCommitWarning
        );
    }

    static showCommitNotFoundWarningMessage(message: string): Promise<MessageItem | undefined> {
        return Messages.showMessage(
            'warn',
            `${message}. The commit could not be found.`,
            SuppressedMessages.CommitNotFoundWarning
        );
    }

    static async showGenericErrorMessage(message: string): Promise<MessageItem | undefined> {
        const actions: MessageItem[] = [{ title: 'Open Output Channel' }];
        const result = await Messages.showMessage(
            'error',
            `${message}. See output channel for more details`,
            undefined,
            null,
            ...actions
        );

        if (result !== undefined) {
            Logger.showOutputChannel();
        }
        return result;
    }

    static showFileNotUnderSourceControlWarningMessage(message: string): Promise<MessageItem | undefined> {
        return Messages.showMessage(
            'warn',
            `${message}. The file is probably not under source control.`,
            SuppressedMessages.FileNotUnderSourceControlWarning
        );
    }

    static showGitDisabledErrorMessage() {
        return Messages.showMessage(
            'error',
            'GitLens requires Git to be enabled. Please re-enable Git \u2014 set `git.enabled` to true and reload',
            SuppressedMessages.GitDisabledWarning
        );
    }

    static showGitVersionUnsupportedErrorMessage(version: string): Promise<MessageItem | undefined> {
        return Messages.showMessage(
            'error',
            `GitLens requires a newer version of Git (>= 2.2.0) than is currently installed (${version}). Please install a more recent version of Git.`,
            SuppressedMessages.GitVersionWarning
        );
    }

    static showLineUncommittedWarningMessage(message: string): Promise<MessageItem | undefined> {
        return Messages.showMessage(
            'warn',
            `${message}. The line has uncommitted changes.`,
            SuppressedMessages.LineUncommittedWarning
        );
    }

    static showNoRepositoryWarningMessage(message: string): Promise<MessageItem | undefined> {
        return Messages.showMessage(
            'warn',
            `${message}. No repository could be found.`,
            SuppressedMessages.NoRepositoryWarning
        );
    }

    static async showSupportGitLensMessage() {
        const actions: MessageItem[] = [
            { title: 'Become a Sponsor' },
            { title: 'Donate via PayPal' },
            { title: 'Donate via Cash App' }
        ];

        const result = await Messages.showMessage(
            'info',
            'While GitLens is offered to everyone for free, if you find it useful, please consider [supporting](https://gitlens.amod.io/#support-gitlens) it. Thank you! ❤',
            undefined,
            null,
            ...actions
        );

        if (result != null) {
            let uri;
            if (result === actions[0]) {
                uri = Uri.parse('https://www.patreon.com/eamodio');
            }
            else if (result === actions[1]) {
                uri = Uri.parse('https://www.paypal.me/eamodio');
            }
            else if (result === actions[2]) {
                uri = Uri.parse('https://cash.me/$eamodio');
            }

            if (uri !== undefined) {
                await setCommandContext(CommandContext.ViewsHideSupportGitLens, true);
                await this.suppressedMessage(SuppressedMessages.SupportGitLensNotification);
                await env.openExternal(uri);
            }
        }
    }

    static async showSetupViewLayoutMessage(previousVersion: string | undefined) {
        if (
            Container.config.views.repositories.location !== ViewLocation.GitLens ||
            Container.config.views.fileHistory.location !== ViewLocation.GitLens ||
            Container.config.views.lineHistory.location !== ViewLocation.GitLens ||
            Container.config.views.search.location !== ViewLocation.GitLens ||
            Container.config.views.compare.location !== ViewLocation.GitLens
        ) {
            return;
        }

        if (
            previousVersion !== undefined &&
            Versions.compare(Versions.fromString(previousVersion), Versions.from(9, 6, 3)) === 1
        ) {
            return;
        }

        const actions: MessageItem[] = [{ title: 'Customize...' }, { title: 'Use Defaults' }];
        const result = await Messages.showMessage(
            'info',
            'GitLens views can be configured to be shown in different side bar layouts to best match your workflow. You can easily change the default layout (where all views are shown together on the GitLens side bar) below.',
            undefined,
            null,
            ...actions
        );

        if (result != null && result === actions[0]) {
            await commands.executeCommand(Commands.ShowSettingsPage, 'views-layout');
        }
    }

    static async showWhatsNewMessage(version: string) {
        const actions: MessageItem[] = [{ title: "What's New" }, { title: 'Release Notes' }, { title: '❤' }];

        const result = await Messages.showMessage(
            'info',
            `GitLens has been updated to v${version} — check out what's new!`,
            undefined,
            null,
            ...actions
        );

        if (result != null) {
            if (result === actions[0]) {
                await commands.executeCommand(Commands.ShowWelcomePage);
            }
            else if (result === actions[1]) {
                await env.openExternal(Uri.parse('https://github.com/eamodio/vscode-gitlens/blob/master/CHANGELOG.md'));
            }
            else if (result === actions[2]) {
                await env.openExternal(Uri.parse('https://gitlens.amod.io/#support-gitlens'));
            }
        }
    }

    private static async showMessage(
        type: 'info' | 'warn' | 'error',
        message: string,
        suppressionKey?: SuppressedMessages,
        dontShowAgain: MessageItem | null = { title: "Don't Show Again" },
        ...actions: MessageItem[]
    ): Promise<MessageItem | undefined> {
        Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain})`);

        if (
            suppressionKey !== undefined &&
            configuration.get<boolean>(configuration.name('advanced')('messages')(suppressionKey).value)
        ) {
            Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain}) skipped`);
            return undefined;
        }

        if (suppressionKey !== undefined && dontShowAgain !== null) {
            actions.push(dontShowAgain);
        }

        let result: MessageItem | undefined = undefined;
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

        if ((suppressionKey !== undefined && dontShowAgain === null) || result === dontShowAgain) {
            Logger.log(
                `ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain}) don't show again requested`
            );
            await this.suppressedMessage(suppressionKey!);

            if (result === dontShowAgain) return undefined;
        }

        Logger.log(
            `ShowMessage(${type}, '${message}', ${suppressionKey}, ${dontShowAgain}) returned ${
                result ? result.title : result
            }`
        );
        return result;
    }

    private static suppressedMessage(suppressionKey: SuppressedMessages) {
        const section = configuration.name('advanced')('messages').value;
        const messages: { [key: string]: boolean | undefined } = configuration.get<{}>(section);

        messages[suppressionKey] = true;

        for (const [key, value] of Object.entries(messages)) {
            if (value !== true) {
                messages[key] = undefined;
            }
        }

        return configuration.update(section, messages, ConfigurationTarget.Global);
    }
}
