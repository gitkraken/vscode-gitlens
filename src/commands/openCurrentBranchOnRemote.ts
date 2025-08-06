import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../git/utils/branch.utils';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

@command()
export class OpenCurrentBranchOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.openCurrentBranchOnRemote');
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repository = await getBestRepositoryOrShowPicker(
			this.container,
			gitUri,
			editor,
			'Open Current Branch Name',
		);
		if (repository == null) return;

		try {
			const branch = await repository.git.branches.getBranch();
			if (branch?.detached) {
				void (await executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
					resource: {
						type: RemoteResourceType.Commit,
						sha: branch.sha ?? 'HEAD',
					},
					repoPath: repository.path,
				}));

				return;
			}

			let branchName;
			let remoteName;
			if (branch?.upstream != null && !branch.upstream.missing) {
				branchName = getBranchNameWithoutRemote(branch.upstream.name);
				remoteName = getRemoteNameFromBranchName(branch.upstream.name);
			} else if (branch != null) {
				branchName = branch.name;
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
				resource: {
					type: RemoteResourceType.Branch,
					branch: branchName ?? 'HEAD',
				},
				remote: remoteName,
				repoPath: repository.path,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenCurrentBranchOnRemoteCommand');
			void showGenericErrorMessage('Unable to open branch on remote provider');
		}
	}
}
