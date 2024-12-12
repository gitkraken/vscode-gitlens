import type { Uri } from 'vscode';
import type { BrowseRepoAtRevisionCommandArgs } from '../commands/browseRepoAtRevision';
import type { GitWizardCommandArgs } from '../commands/gitWizard';
import type { QuickWizardCommandArgsWithCompletion } from '../commands/quickWizard.base';
import { GlCommand } from '../constants.commands';
import { defer } from '../system/promise';
import { executeCommand, executeEditorCommand } from '../system/vscode/command';

export async function executeGitCommand(args: GitWizardCommandArgs): Promise<void> {
	const deferred = defer<void>();
	void (await executeCommand<QuickWizardCommandArgsWithCompletion<GitWizardCommandArgs>>(GlCommand.GitCommands, {
		...args,
		completion: deferred,
	}));
	return deferred.promise;
}

export async function browseAtRevision(uri: Uri, options?: { before?: boolean; openInNewWindow?: boolean }) {
	void (await executeEditorCommand<BrowseRepoAtRevisionCommandArgs>(GlCommand.BrowseRepoAtRevision, undefined, {
		uri: uri,
		before: options?.before,
		openInNewWindow: options?.openInNewWindow,
	}));
}
