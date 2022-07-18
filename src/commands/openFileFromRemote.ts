import { env, Range, Uri, window } from 'vscode';
import * as nls from 'vscode-nls';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { openEditor } from '../system/utils';
import { Command } from './base';

const localize = nls.loadMessageBundle();

@command()
export class OpenFileFromRemoteCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.OpenFileFromRemote);
	}

	async execute() {
		let clipboard: string | undefined = await env.clipboard.readText();
		try {
			Uri.parse(clipboard, true);
		} catch {
			clipboard = undefined;
		}

		const url = await window.showInputBox({
			prompt: localize('enterRemoteFileUrlToOpen', 'Enter a remote file url to open'),
			placeHolder: localize('remoteFileUrl', 'Remote file url'),
			value: clipboard,
			ignoreFocusOut: true,
		});
		if (url == null || url.length === 0) return;

		let local = await this.container.git.getLocalInfoFromRemoteUri(Uri.parse(url));
		if (local == null) {
			local = await this.container.git.getLocalInfoFromRemoteUri(Uri.parse(url), { validate: false });
			if (local == null) {
				void window.showWarningMessage(
					localize('unableToParseProvidedRemoteUrl', 'Unable to parse the provided remote url.'),
				);

				return;
			}

			const confirm = 'Open File...';
			const pick = await window.showWarningMessage(
				localize(
					'unableToFindWorkspaceFolder',
					'Unable to find a workspace folder that matches the provided remote url.',
				),
				confirm,
			);
			if (pick !== confirm) return;
		}

		let selection;
		if (local.startLine) {
			if (local.endLine) {
				selection = new Range(local.startLine - 1, 0, local.endLine, 0);
			} else {
				selection = new Range(local.startLine - 1, 0, local.startLine - 1, 0);
			}
		}

		try {
			await openEditor(local.uri, { selection: selection, rethrow: true });
		} catch {
			const uris = await window.showOpenDialog({
				title: localize('openLocalFile', 'Open local file'),
				defaultUri: local.uri,
				canSelectMany: false,
				canSelectFolders: false,
			});
			if (uris == null || uris.length === 0) return;

			await openEditor(uris[0]);
		}
	}
}
