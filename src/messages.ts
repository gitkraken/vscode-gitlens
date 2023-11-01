import type { MessageItem } from 'vscode';
import { ConfigurationTarget, window } from 'vscode';
import type { SuppressedMessages } from './config';
import { Commands } from './constants';
import type { GitCommit } from './git/models/commit';
import { executeCommand } from './system/command';
import { configuration } from './system/configuration';
import { Logger } from './system/logger';

export function showCommitHasNoPreviousCommitWarningMessage(commit?: GitCommit): Promise<MessageItem | undefined> {
	if (commit == null) {
		return showMessage('info', 'There is no previous commit.', 'suppressCommitHasNoPreviousCommitWarning');
	}
	return showMessage(
		'info',
		`Commit ${commit.shortSha} (${commit.author.name}, ${commit.formattedDate}) has no previous commit.`,
		'suppressCommitHasNoPreviousCommitWarning',
	);
}

export function showCommitNotFoundWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('warn', `${message}. The commit could not be found.`, 'suppressCommitNotFoundWarning');
}

export async function showCreatePullRequestPrompt(branch: string): Promise<boolean> {
	const create = { title: 'Create Pull Request...' };
	const result = await showMessage(
		'info',
		`Would you like to create a Pull Request for branch '${branch}'?`,
		'suppressCreatePullRequestPrompt',
		{ title: "Don't Show Again" },
		create,
	);
	return result === create;
}

export async function showDebugLoggingWarningMessage(): Promise<boolean> {
	const disable = { title: 'Disable Debug Logging' };
	const result = await showMessage(
		'warn',
		'GitLens debug logging is currently enabled. Unless you are reporting an issue, it is recommended to be disabled. Would you like to disable it?',
		'suppressDebugLoggingWarning',
		{ title: "Don't Show Again" },
		disable,
	);

	return result === disable;
}

export async function showGenericErrorMessage(message: string): Promise<void> {
	if (Logger.enabled('error')) {
		const result = await showMessage('error', `${message}. See output channel for more details.`, undefined, null, {
			title: 'Open Output Channel',
		});

		if (result != null) {
			Logger.showOutputChannel();
		}
	} else {
		const result = await showMessage(
			'error',
			`${message}. If the error persists, please enable debug logging and try again.`,
			undefined,
			null,
			{
				title: 'Enable Debug Logging',
			},
		);

		if (result != null) {
			void executeCommand(Commands.EnableDebugLogging);
		}
	}
}

export function showFileNotUnderSourceControlWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		`${message}. The file is probably not under source control.`,
		'suppressFileNotUnderSourceControlWarning',
	);
}

export function showGitDisabledErrorMessage() {
	return showMessage(
		'error',
		'GitLens requires Git to be enabled. Please re-enable Git \u2014 set `git.enabled` to true and reload.',
		'suppressGitDisabledWarning',
	);
}

export function showGitInvalidConfigErrorMessage() {
	return showMessage(
		'error',
		'GitLens is unable to use Git. Your Git configuration seems to be invalid. Please resolve any issues with your Git configuration and reload.',
	);
}

export function showGitMissingErrorMessage() {
	return showMessage(
		'error',
		"GitLens was unable to find Git. Please make sure Git is installed. Also ensure that Git is either in the PATH, or that 'git.path' is pointed to its installed location.",
		'suppressGitMissingWarning',
	);
}

export function showGitVersionUnsupportedErrorMessage(
	version: string,
	required: string,
): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		`GitLens requires a newer version of Git (>= ${required}) than is currently installed (${version}). Please install a more recent version of Git.`,
		'suppressGitVersionWarning',
	);
}

export function showPreReleaseExpiredErrorMessage(version: string) {
	return showMessage(
		'error',
		`This GitLens pre-release version (${version}) has expired. Please upgrade to a more recent version.`,
	);
}

export function showLineUncommittedWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('warn', `${message}. The line has uncommitted changes.`, 'suppressLineUncommittedWarning');
}

export function showNoRepositoryWarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('warn', `${message}. No repository could be found.`, 'suppressNoRepositoryWarning');
}

export function showRebaseSwitchToTextWarningMessage(): Promise<MessageItem | undefined> {
	return showMessage(
		'warn',
		'Closing either the git-rebase-todo file or the Rebase Editor will start the rebase.',
		'suppressRebaseSwitchToTextWarning',
	);
}

export function showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(
	providerName: string,
): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		`Rich integration with ${providerName} has been disconnected for this session, because of too many failed requests.`,
		'suppressIntegrationDisconnectedTooManyFailedRequestsWarning',
		undefined,
		{
			title: 'OK',
		},
	);
}

export function showIntegrationRequestFailed500WarningMessage(message: string): Promise<MessageItem | undefined> {
	return showMessage('error', message, 'suppressIntegrationRequestFailed500Warning', undefined, {
		title: 'OK',
	});
}

export function showIntegrationRequestTimedOutWarningMessage(providerName: string): Promise<MessageItem | undefined> {
	return showMessage(
		'error',
		`${providerName} request timed out.`,
		'suppressIntegrationRequestTimedOutWarning',
		undefined,
		{
			title: 'OK',
		},
	);
}

export async function showWhatsNewMessage(version: string) {
	const reset = { title: 'Switch to New Layout' };
	const result = await showMessage(
		'info',
		`Upgraded to GitLens ${version} — [see what's new](https://help.gitkraken.com/gitlens/gitlens-release-notes-current/ "See what's new in GitLens ${version}").\nWe've reimagined and rearranged our views for greater focus and productivity, and recommend switching to the new layout — [learn more and tell us what you think](https://github.com/gitkraken/vscode-gitlens/discussions/2721 "Learn more about what's changed")!`,
		undefined,
		null,
		reset,
	);

	if (result === reset) {
		void executeCommand(Commands.ResetViewsLayout);
	}
}

export async function showMessage(
	type: 'info' | 'warn' | 'error',
	message: string,
	suppressionKey?: SuppressedMessages,
	dontShowAgain: MessageItem | null = { title: "Don't Show Again" },
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
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete messages[key as keyof typeof messages];
		}
	}

	return configuration.update('advanced.messages', messages, ConfigurationTarget.Global);
}
