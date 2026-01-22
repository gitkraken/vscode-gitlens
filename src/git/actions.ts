import type { Uri } from 'vscode';
import type { BrowseRepoAtRevisionCommandArgs } from '../commands/browseRepoAtRevision.js';
import type { GitWizardCommandArgs } from '../commands/gitWizard.js';
import type { QuickWizardCommandArgsWithCompletion } from '../commands/quick-wizard/models/quickWizard.js';
import { executeCommand, executeEditorCommand } from '../system/-webview/command.js';
import { defer } from '../system/promise.js';

export async function executeGitCommand(args: GitWizardCommandArgs): Promise<void> {
	const deferred = defer<void>();
	void (await executeCommand<QuickWizardCommandArgsWithCompletion<GitWizardCommandArgs>>('gitlens.gitCommands', {
		...args,
		completion: deferred,
	}));
	return deferred.promise;
}

export async function browseAtRevision(
	uri: Uri,
	options?: { before?: boolean; openInNewWindow?: boolean },
): Promise<void> {
	void (await executeEditorCommand<BrowseRepoAtRevisionCommandArgs>('gitlens.browseRepoAtRevision', undefined, {
		uri: uri,
		before: options?.before,
		openInNewWindow: options?.openInNewWindow,
	}));
}
