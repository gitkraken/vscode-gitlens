import type { Uri } from 'vscode';
import type { BrowseRepoAtRevisionCommandArgs } from '../commands/browseRepoAtRevision';
import type { GitWizardCommandArgs } from '../commands/gitWizard';
import type { QuickWizardCommandArgsWithCompletion } from '../commands/quickWizard.base';
import { GlCommand } from '../constants.commands';
import { executeCommand, executeEditorCommand } from '../system/-webview/command';
import { defer } from '../system/promise';

export async function executeGitCommand(args: GitWizardCommandArgs): Promise<void> {
	const deferred = defer<void>();
	void (await executeCommand<QuickWizardCommandArgsWithCompletion<GitWizardCommandArgs>>(GlCommand.GitCommands, {
		...args,
		completion: deferred,
	}));
	return deferred.promise;
}

export async function browseAtRevision(
	uri: Uri,
	options?: { before?: boolean; openInNewWindow?: boolean },
): Promise<void> {
	void (await executeEditorCommand<BrowseRepoAtRevisionCommandArgs>(GlCommand.BrowseRepoAtRevision, undefined, {
		uri: uri,
		before: options?.before,
		openInNewWindow: options?.openInNewWindow,
	}));
}
