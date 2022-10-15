import type { MessageItem } from 'vscode';
import { ConfigurationTarget, window } from 'vscode';
import * as nls from 'vscode-nls';
import { configuration, SuppressedMessages } from './configuration';
import { Commands } from './constants';
import type { GitCommit } from './git/models/commit';
import { Logger } from './logger';
import { executeCommand } from './system/command';

const localize = nls.loadMessageBundle();

export function showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<MessageItem | undefined> {
	if (commit == null) {
		return showMessage(
			'info',
			localize('commitHasNoPreviousCommitWarning.message', 'There is no previous commit.'),
			SuppressedMessages.CommitHasNoPreviousCommitWarning,
		);
	}
	return showMessage(
		'info',
		localize(
			'commitHasNoPreviousCommitWarning.message',
			'Commit {0} ({1}, {2}) has no previous commit.',
			commit.shortSha,
			commit.author.name,
			commit.formattedDate,
		),
		SuppressedMessages.CommitHasNoPreviousCommitWarning,
	);
}

export function showCommitNotFoundWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		`${message}. ${localize('commitNotFoundWarning.commitNotFound', 'The commit could not be found.')}`,
		SuppressedMessages.CommitNotFoundWarning,
	);
}

export async function showCreatePullRequestPrompt(branch: string): Promise<boolean> {
	const create = { title: localize('createPullRequestPrompt.title', 'Create Pull Request...') };
	const result = await showMessage(
		'info',
		localize(
			'createPullRequestPrompt.message',
			"Would you like to create a Pull Request for branch '{0}'?",
			branch,
		),
		SuppressedMessages.CreatePullRequestPrompt,
		{ title: localize('dontShowAgain', "Don't Show Again") },
		create,
	);
	return result === create;
}

export async function showDebugLoggingWarningMessage(): Promise<boolean> {
	const disable = { title: localize('debugLoggingWarningMessage.title', 'Disable Debug Logging') };
	const result = await showMessage(
		'warn',
		localize(
			'debugLoggingWarningMessage.message',
			'GitLens debug logging is currently enabled. Unless you are reporting an issue, it is recommended to be disabled. Would you like to disable it?',
		),
		SuppressedMessages.SuppressDebugLoggingWarning,
		{ title: localize('dontShowAgain', "Don't Show Again") },
		disable,
	);

	return result === disable;
}

export async function showGenericErrorMessage(message: string): Promise<MessageItem | undefined> {
	const actions: MessageItem[] = [{ title: localize('genericErrorMessage.title', 'Open Output Channel') }];
	const result = await showMessage(
		'error',
		`${message}. ${localize('genericErrorMessage.message', 'See output channel for more details')}`,
		undefined,
		null,
		...actions,
	);

	if (result !== undefined) {
		Logger.showOutputChannel();
	}
	return result;
}

export function showFileNotUnderSourceControlWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		`${message}. ${localize(
			'fileNotUnderSourceControlWarningMessage.message',
			'The file is probably not under source control.',
		)}`,
		SuppressedMessages.FileNotUnderSourceControlWarning,
	);
}

export function showGitDisabledErrorMessage() {
	return showMessage(
		'error',
		localize(
			'gitDisabledErrorMessage.message',
			'GitLens requires Git to be enabled. Please re-enable Git \u2014 set `git.enabled` to true and reload.',
		),
		SuppressedMessages.GitDisabledWarning,
	);
}

export function showGitInvalidConfigErrorMessage() {
	return showMessage(
		'error',
		localize(
			'gitInvalidConfigErrorMessage.message',
			'GitLens is unable to use Git. Your Git configuration seems to be invalid. Please resolve any issues with your Git configuration and reload.',
		),
	);
}

export function showGitMissingErrorMessage() {
	return showMessage(
		'error',
		localize(
			'gitMissingErrorMessage.message',
			"GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'git.path' is pointed to its installed location.",
		),
		SuppressedMessages.GitMissingWarning,
	);
}

export function showGitVersionUnsupportedErrorMessage(
	version: string,
	required: string,
): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		localize(
			'gitVersionUnsupportedErrorMessage.message',
			'GitLens requires a newer version of Git (>= {0}) than is currently installed ({1}). Please install a more recent version of Git.',
			required,
			version,
		),
		SuppressedMessages.GitVersionWarning,
	);
}

export function showInsidersErrorMessage() {
	return showMessage(
		'error',
		localize(
			'insidersErrorMessage.message',
			'GitLens (Insiders) cannot be used while GitLens is also enabled. Please ensure that only one version is enabled.',
		),
	);
}

export function showPreReleaseExpiredErrorMessage(version: string, insiders: boolean) {
	return showMessage(
		'error',
		`${
			insiders
				? localize(
						'preReleaseExpiredErrorMessage.insiders',
						'GitLens (Insiders) version ({0}) has expired.',
						version,
				  )
				: localize(
						'preReleaseExpiredErrorMessage.preRelease',
						'GitLens pre-release version ({0}) has expired.',
						version,
				  )
		} ${localize('preReleaseExpiredErrorMessage.pleaseUpgrade', 'Please upgrade to a more recent version.')}`,
	);
}

export function showLineUncommittedWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		`${message}. ${localize('lineUncommittedWarningMessage.message', 'The line has uncommitted changes.')}`,
		SuppressedMessages.LineUncommittedWarning,
	);
}

export function showNoRepositoryWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		`${message}. ${localize('noRepositoryWarningMessage.message', 'No repository could be found.')}`,
		SuppressedMessages.NoRepositoryWarning,
	);
}

export function showRebaseSwitchToTextWarningMessage(): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		localize(
			'rebaseSwitchToTextWarningMessage.message',
			'Closing either the git-rebase-todo file or the Rebase Editor will start the rebase.',
		),
		SuppressedMessages.RebaseSwitchToTextWarning,
	);
}

export function showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(
	providerName: string,
): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		localize(
			'intergationDisconnectedErrorMessage.message',
			'Rich integration with {0} has been disconnected for this session, because of too many failed requests.',
			providerName,
		),
		SuppressedMessages.IntegrationDisconnectedTooManyFailedRequestsWarning,
		undefined,
		{
			title: localize('ok', 'OK'),
		},
	);
}

export function showIntegrationRequestFailed500WarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('error', message, SuppressedMessages.IntegrationRequestFailed500Warning, undefined, {
		title: localize('ok', 'OK'),
	});
}

export function showIntegrationRequestTimedOutWarningMessage(providerName: string): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		localize('integrationRequestTimedOutWarningMessage.message', '{0} request timed out.', providerName),
		SuppressedMessages.IntegrationRequestTimedOutWarning,
		undefined,
		{
			title: localize('ok', 'OK'),
		},
	);
}

export async function showWhatsNewMessage(version: string) {
	const whatsnew = { title: localize('whatsNewMessage.title', "See What's New") };
	const result = await showMessage(
		'info',
		localize('WhatsNewMessage.message', "GitLens {0} is here — check out what's new!", version),
		undefined,
		null,
		whatsnew,
	);

	if (result === whatsnew) {
		void (await executeCommand(Commands.ShowWelcomePage));
	}
}

async function showMessage(
	type: 'info' | 'warn' | 'error',
	message: string,
	suppressionKey?: SuppressedMessages,
	dontShowAgain: MessageItem | null = { title: localize('dontShowAgain', "Don't Show Again") },
	...actions: MessageItem[]
): Promise<MessageItem | undefined> {
	Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)})`);

	if (suppressionKey != null && configuration.get(`advanced.messages.${suppressionKey}` as const)) {
		Logger.log(`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) skipped`);
		return undefined;
	}

	if (suppressionKey != null && dontShowAgain !== null) {
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

	if (suppressionKey != null && (dontShowAgain === null || result === dontShowAgain)) {
		Logger.log(
			`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(
				dontShowAgain,
			)}) don't show again requested`,
		);
		await suppressedMessage(suppressionKey);

		if (result === dontShowAgain) return undefined;
	}

	Logger.log(
		`ShowMessage(${type}, '${message}', ${suppressionKey}, ${JSON.stringify(dontShowAgain)}) returned ${
			result != null ? result.title : result
		}`,
	);
	return result;
}

function suppressedMessage(suppressionKey: SuppressedMessages) {
	const messages = { ...configuration.get('advanced.messages') };

	messages[suppressionKey] = true;

	for (const [key, value] of Object.entries(messages)) {
		if (value !== true) {
			delete messages[key as keyof typeof messages];
		}
	}

	return configuration.update('advanced.messages', messages, ConfigurationTarget.Global);
}
