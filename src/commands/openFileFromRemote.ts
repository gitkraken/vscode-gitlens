import { env, Range, Uri, window } from 'vscode';
import { Schemes } from '../constants';
import type { Container } from '../container';
import { command } from '../system/-webview/command';
import { openTextEditor } from '../system/-webview/vscode/editors';
import { GlCommandBase } from './commandBase';

@command()
export class OpenFileFromRemoteCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.openFileFromRemote');
	}

	async execute(): Promise<void> {
		await openFileOreRevisionFromRemote(this.container, 'file');
	}
}

@command()
export class OpenRevisionFromRemoteCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.openRevisionFromRemote');
	}

	async execute(): Promise<void> {
		await openFileOreRevisionFromRemote(this.container, 'revision');
	}
}

async function openFileOreRevisionFromRemote(container: Container, type: 'file' | 'revision'): Promise<void> {
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
	if (!url?.length) return;

	const local = await container.git.getLocalInfoFromRemoteUri(Uri.parse(url));
	if (local == null) {
		void window.showWarningMessage('Unable to parse the provided remote url.');
		return;
	}

	let { uri } = local;
	if (type === 'revision' && uri.scheme === Schemes.File && local.rev) {
		uri = (await container.git.getBestRevisionUri(local.repoPath, local.uri.fsPath, local.rev)) ?? uri;
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
		await openTextEditor(uri, { selection: selection, throwOnError: true });
	} catch {
		const uris = await window.showOpenDialog({
			title: 'Open local file',
			defaultUri: uri,
			canSelectMany: false,
			canSelectFolders: false,
		});
		if (!uris?.length) return;

		await openTextEditor(uris[0]);
	}
}
