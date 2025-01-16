import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
// import { getTagNameWithoutRemote, getRemoteNameFromTagName } from '../git/models/tag';
import { RemoteResourceType } from '../git/models/remoteResource';
import { showGenericErrorMessage } from '../messages';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../quickpicks/referencePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri, isCommandContextViewNodeHasTag } from './base';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenTagOnRemoteCommandArgs {
	tag?: string;
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenTagOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([Commands.OpenTagOnRemote, Commands.CopyRemoteTagUrl]);
	}

	protected override preExecute(context: CommandContext, args?: OpenTagOnRemoteCommandArgs) {
		if (isCommandContextViewNodeHasTag(context)) {
			args = {
				...args,
				tag: context.node.tag.name,
				remote: context.node.tag.name,
			};
		}

		if (context.command === Commands.CopyRemoteTagUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenTagOnRemoteCommandArgs) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		const repoPath = (
			await getBestRepositoryOrShowPicker(
				gitUri,
				editor,
				args?.clipboard ? 'Copy Remote Tag URL' : 'Open Tag On Remote',
			)
		)?.path;
		if (!repoPath) return;

		args = { ...args };

		try {
			if (args.tag == null) {
				const pick = await showReferencePicker(
					repoPath,
					args.clipboard ? 'Copy Remote Tag URL' : 'Open Tag On Remote',
					args.clipboard ? 'Choose a Tag to copy the URL from' : 'Choose a Tag to open',
					{
						autoPick: true,
						filter: { tags: () => true, branches: () => false },
						include: ReferencesQuickPickIncludes.Tags,
						sort: { tags: { current: true } },
					},
				);
				if (pick == null || pick instanceof CommandQuickPickItem) return;

				if (pick.refType === 'tag') {
					args.tag = pick.name;
				} else {
					args.tag = pick.ref;
				}
			}

			void (await executeCommand<OpenOnRemoteCommandArgs>(Commands.OpenOnRemote, {
				resource: {
					type: RemoteResourceType.Tag,
					tag: args.tag,
				},
				repoPath: repoPath,
				remote: args.remote,
				clipboard: args.clipboard,
			}));
		} catch (ex) {
			Logger.error(ex, 'OpenTagOnRemoteCommand');
			void showGenericErrorMessage('Unable to open Tag on remote provider');
		}
	}
}
