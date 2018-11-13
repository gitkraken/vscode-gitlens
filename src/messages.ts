'use strict';
import { commands, ConfigurationTarget, MessageItem, Uri, window } from 'vscode';
import { configuration, KeyMap } from './configuration';
import { BuiltInCommands, CommandContext, setCommandContext } from './constants';
import { Container } from './container';
import { GitCommit } from './git/gitService';
import { Logger } from './logger';

export enum SuppressedMessages {
    CommitHasNoPreviousCommitWarning = 'suppressCommitHasNoPreviousCommitWarning',
    CommitNotFoundWarning = 'suppressCommitNotFoundWarning',
    FileNotUnderSourceControlWarning = 'suppressFileNotUnderSourceControlWarning',
    GitDisabledWarning = 'suppressGitDisabledWarning',
    GitVersionWarning = 'suppressGitVersionWarning',
    LineUncommittedWarning = 'suppressLineUncommittedWarning',
    NoRepositoryWarning = 'suppressNoRepositoryWarning',
    ShowKeyBindingsNotice = 'suppressShowKeyBindingsNotice',
    SupportGitLensNotification = 'suppressSupportGitLensNotification'
}

export class Messages {
    static showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<MessageItem | undefined> {
        if (commit === undefined) {
            return Messages.showMessage(
                'info',
                `Commit has no previous commit.`,
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
            `GitLens requires Git to be enabled. Please re-enable Git \u2014 set \`git.enabled\` to true and reload`,
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

    static async showKeyBindingsInfoMessage(): Promise<MessageItem | undefined> {
        if (
            Container.config.keymap !== KeyMap.Alternate ||
            Container.config.advanced.messages.suppressShowKeyBindingsNotice
        ) {
            return undefined;
        }

        const actions: MessageItem[] = [
            { title: 'Keep Shortcuts', isCloseAffordance: true },
            { title: 'Switch Shortcuts' },
            { title: 'No Shortcuts' }
        ];
        const result = await Messages.showMessage(
            'info',
            `GitLens is using keyboard shortcuts which can conflict with menu mnemonics and different keyboard layouts. To avoid such conflicts, it is recommended to switch to the new default keyboard shortcuts.`,
            SuppressedMessages.ShowKeyBindingsNotice,
            null,
            ...actions
        );

        switch (result) {
            case actions[1]:
                await configuration.update(
                    configuration.name('keymap').value,
                    KeyMap.Chorded,
                    ConfigurationTarget.Global
                );
                break;

            case actions[2]:
                await configuration.update(configuration.name('keymap').value, KeyMap.None, ConfigurationTarget.Global);
                break;
        }

        return result;
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
            `While GitLens is offered to everyone for free, if you find it useful please consider supporting it. Thank you! ❤`,
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
                await this.suppressedMessage(SuppressedMessages.SupportGitLensNotification!);
                await commands.executeCommand(BuiltInCommands.Open, uri);
            }
        }
    }

    private static async showMessage<T extends MessageItem>(
        type: 'info' | 'warn' | 'error',
        message: string,
        suppressionKey?: SuppressedMessages,
        dontShowAgain: T | null = { title: "Don't Show Again" } as T,
        ...actions: T[]
    ): Promise<T | undefined> {
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

        let result: T | undefined = undefined;
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
