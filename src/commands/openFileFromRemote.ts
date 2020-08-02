'use strict';
import { env, Range, Uri, window } from 'vscode';
import { command, Command, Commands, openEditor } from './common';
import { Container } from '../container';

@command()
export class OpenFileFromRemoteCommand extends Command {
	constructor() {
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
			prompt: 'Enter a remote file url to open',
			placeHolder: 'Remote file url',
			value: clipboard,
			ignoreFocusOut: true,
		});
		if (url == null || url.length === 0) return;

		let local = await Container.git.getLocalInfoFromRemoteUri(Uri.parse(url));
		if (local == null) {
			local = await Container.git.getLocalInfoFromRemoteUri(Uri.parse(url), { validate: false });
			if (local == null) {
				void window.showWarningMessage('Unable to parse the provided remote url.');

				return;
			}

			const confirm = 'Open File...';
			const pick = await window.showWarningMessage(
				'Unable to find a workspace folder that matches the provided remote url.',
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
				title: 'Open local file',
				defaultUri: local.uri,
				canSelectMany: false,
				canSelectFolders: false,
			});
			if (uris == null || uris.length === 0) return;

			await openEditor(uris[0]);
		}
	}
}
