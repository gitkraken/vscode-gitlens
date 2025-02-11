import type { TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { RemoteResourceType } from '../git/models/remoteResource';
import { showGenericErrorMessage } from '../messages';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../quickpicks/referencePicker';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasTag } from './commandContext.utils';
import type { OpenOnRemoteCommandArgs } from './openOnRemote';

export interface OpenTagOnRemoteCommandArgs {
	tag?: string;
	clipboard?: boolean;
	remote?: string;
}

@command()
export class OpenTagOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([GlCommand.OpenTagOnRemote, GlCommand.CopyRemoteTagUrl]);
	}

	protected override preExecute(context: CommandContext, args?: OpenTagOnRemoteCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasTag(context)) {
			args = {
				...args,
				tag: context.node.tag.name,
				remote: context.node.tag.name,
			};
		}

		if (context.command === GlCommand.CopyRemoteTagUrl) {
			args = { ...args, clipboard: true };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenTagOnRemoteCommandArgs): Promise<void> {
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

			void (await executeCommand<OpenOnRemoteCommandArgs>(GlCommand.OpenOnRemote, {
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
