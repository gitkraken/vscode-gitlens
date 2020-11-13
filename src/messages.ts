'use strict';
import { ConfigurationTarget, env, MessageItem, Uri, window } from 'vscode';
import { configuration } from './configuration';
import { GitCommit } from './git/git';
import { Logger } from './logger';

export enum SuppressedMessages {
	CommitHasNoPreviousCommitWarning = 'suppressCommitHasNoPreviousCommitWarning',
	CommitNotFoundWarning = 'suppressCommitNotFoundWarning',
	FileNotUnderSourceControlWarning = 'suppressFileNotUnderSourceControlWarning',
	GitDisabledWarning = 'suppressGitDisabledWarning',
	GitVersionWarning = 'suppressGitVersionWarning',
	LineUncommittedWarning = 'suppressLineUncommittedWarning',
	NoRepositoryWarning = 'suppressNoRepositoryWarning',
}

export class Messages {
	static showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<MessageItem | undefined> {
		if (commit === undefined) {
			return Messages.showMessage(
				'info',
				'There is no previous commit.',
				SuppressedMessages.CommitHasNoPreviousCommitWarning,
			);
		}
		return Messages.showMessage(
			'info',
			`Commit ${commit.shortSha} (${commit.author}, ${commit.formattedDate}) has no previous commit.`,
			SuppressedMessages.CommitHasNoPreviousCommitWarning,
		);
	}

	static showCommitNotFoundWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}. The commit could not be found.`,
			SuppressedMessages.CommitNotFoundWarning,
		);
	}

	static async showGenericErrorMessage(message: string): Promise<MessageItem | undefined> {
		const actions: MessageItem[] = [{ title: 'Open Output Channel' }];
		const result = await Messages.showMessage(
			'error',
			`${message}. See output channel for more details`,
			undefined,
			null,
			...actions,
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
			SuppressedMessages.FileNotUnderSourceControlWarning,
		);
	}

	static showGitDisabledErrorMessage() {
		return Messages.showMessage(
			'error',
			'GitLens requires Git to be enabled. Please re-enable Git \u2014 set `git.enabled` to true and reload',
			SuppressedMessages.GitDisabledWarning,
		);
	}

	static showGitVersionUnsupportedErrorMessage(version: string, required: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'error',
			`GitLens requires a newer version of Git (>= ${required}) than is currently installed (${version}). Please install a more recent version of Git.`,
			SuppressedMessages.GitVersionWarning,
		);
	}

	static showLineUncommittedWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}. The line has uncommitted changes.`,
			SuppressedMessages.LineUncommittedWarning,
		);
	}

	static showNoRepositoryWarningMessage(message: string): Promise<MessageItem | undefined> {
		return Messages.showMessage(
			'warn',
			`${message}. No repository could be found.`,
			SuppressedMessages.NoRepositoryWarning,
		);
	}

	static async showWhatsNewMessage(version: string) {
		const actions: MessageItem[] = [{ title: "What's New" }, { title: '❤ Sponsor' }];

		const result = await Messages.showMessage(
			'info',
			`GitLens has been updated to v${version} — check out what's new!`,
			undefined,
			null,
			...actions,
		);

		if (result != null) {
			if (result === actions[0]) {
				await env.openExternal(Uri.parse('https://gitlens.amod.io/#whats-new'));
			} else if (result === actions[1]) {
				await env.openExternal(Uri.parse('https://gitlens.amod.io/#sponsor'));
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
		Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)})`);

		if (suppressionKey !== undefined && configuration.get('advanced', 'messages', suppressionKey)) {
			Logger.log(
				`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) skipped`,
			);
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
				`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(
					dontShowAgain,
				)}) don't show again requested`,
			);
			await this.suppressedMessage(suppressionKey!);

			if (result === dontShowAgain) return undefined;
		}

		Logger.log(
			`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) returned ${
				result != null ? result.title : result
			}`,
		);
		return result;
	}

	private static suppressedMessage(suppressionKey: SuppressedMessages) {
		const messages: Record<string, boolean | undefined> = configuration.get('advanced', 'messages');

		messages[suppressionKey] = true;

		for (const [key, value] of Object.entries(messages)) {
			if (value !== true) {
				messages[key] = undefined;
			}
		}

		return configuration.update('advanced', 'messages', messages as any, ConfigurationTarget.Global);
	}
}
