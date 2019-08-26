'use strict';
import { TextEditor, Uri } from 'vscode';
import { GlyphChars } from '../constants';
import { GitRemote, GitService, RemoteResource, RemoteResourceType } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, OpenRemoteCommandQuickPickItem, RemotesQuickPick } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, command, Commands } from './common';

export interface OpenInRemoteCommandArgs {
	remote?: string;
	remotes?: GitRemote[];
	resource?: RemoteResource;
	clipboard?: boolean;

	goBackCommand?: CommandQuickPickItem;
}

@command()
export class OpenInRemoteCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenInRemote);
	}

	async execute(editor: TextEditor, uri?: Uri, args: OpenInRemoteCommandArgs = {}) {
		args = { ...args };
		if (args.remotes === undefined || args.resource === undefined) return undefined;

		if (args.remote !== undefined) {
			const remotes = args.remotes.filter(r => r.name === args.remote);
			// Only filter if we get some results
			if (remotes.length > 0) {
				args.remotes = remotes;
			}
		}

		try {
			let remote: GitRemote | undefined;
			if (args.remotes.length > 1) {
				remote = args.remotes.find(r => r.default);
			} else if (args.remotes.length === 1) {
				remote = args.remotes[0];
			}

			if (remote != null) {
				this.ensureRemoteBranchName(args);
				const command = new OpenRemoteCommandQuickPickItem(remote, args.resource, args.clipboard);
				return await command.execute();
			}

			const verb = args.clipboard ? 'Copy url for' : 'Open';
			const suffix = args.clipboard ? `to clipboard from${GlyphChars.Ellipsis}` : `on${GlyphChars.Ellipsis}`;
			let placeHolder = '';
			switch (args.resource.type) {
				case RemoteResourceType.Branch:
					this.ensureRemoteBranchName(args);
					placeHolder = `${verb} ${args.resource.branch} branch ${suffix}`;
					break;

				case RemoteResourceType.Commit:
					placeHolder = `${verb} commit ${GitService.shortenSha(args.resource.sha)} ${suffix}`;
					break;

				case RemoteResourceType.File:
					placeHolder = `${verb} ${args.resource.fileName} ${suffix}`;
					break;

				case RemoteResourceType.Revision:
					if (args.resource.commit !== undefined && args.resource.commit.isFile) {
						if (args.resource.commit.status === 'D') {
							args.resource.sha = args.resource.commit.previousSha;
							placeHolder = `${verb} ${args.resource.fileName} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${
								args.resource.commit.previousShortSha
							} ${suffix}`;
						} else {
							args.resource.sha = args.resource.commit.sha;
							placeHolder = `${verb} ${args.resource.fileName} ${Strings.pad(GlyphChars.Dot, 1, 1)} ${
								args.resource.commit.shortSha
							} ${suffix}`;
						}
					} else {
						const shortFileSha =
							args.resource.sha === undefined ? '' : GitService.shortenSha(args.resource.sha);
						const shaSuffix = shortFileSha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${shortFileSha}` : '';

						placeHolder = `${verb} ${args.resource.fileName}${shaSuffix} ${suffix}`;
					}
					break;
			}

			const pick = await RemotesQuickPick.show(
				args.remotes,
				placeHolder,
				args.resource,
				args.clipboard,
				args.goBackCommand
			);
			if (pick === undefined) return undefined;

			return await pick.execute();
		} catch (ex) {
			Logger.error(ex, 'OpenInRemoteCommand');
			return Messages.showGenericErrorMessage('Unable to open in remote provider');
		}
	}

	private ensureRemoteBranchName(args: OpenInRemoteCommandArgs) {
		if (
			args.remotes === undefined ||
			args.resource === undefined ||
			args.resource.type !== RemoteResourceType.Branch
		) {
			return;
		}

		// Check to see if the remote is in the branch
		const [remotePart, branchPart] = Strings.splitSingle(args.resource.branch, '/');
		if (branchPart === undefined) return;

		const remote = args.remotes.find(r => r.name === remotePart);
		if (remote === undefined) return;

		args.resource.branch = branchPart;
		args.remotes = [remote];
	}
}
