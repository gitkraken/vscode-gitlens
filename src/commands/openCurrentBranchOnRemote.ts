import type { TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../git/models/branch.utils';
import { RemoteResourceType } from '../git/models/remoteResource';
import { showGenericErrorMessage } from '../messages';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

@command()
export class OpenCurrentBranchOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.OpenCurrentBranchOnRemote);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repository = await getBestRepositoryOrShowPicker(gitUri, editor, 'Open Current Branch Name');
		if (repository == null) return;

		try {
			const branch = await repository.git.getBranch();
			if (branch?.detached) {
				void (await executeCommand<OpenOnRemoteCommandArgs>(GlCommand.OpenOnRemote, {
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

			void (await executeCommand<OpenOnRemoteCommandArgs>(GlCommand.OpenOnRemote, {
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
