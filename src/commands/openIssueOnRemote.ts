import { env, window } from 'vscode';
import type { OpenIssueActionContext } from '../api/gitlens';
import { actionCommandPrefix } from '../constants.commands';
import { command } from '../system/-webview/command';
import { openUrl } from '../system/-webview/vscode/uris';
import { createMarkdownCommandLink } from '../system/commands';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import { GlCommandBase } from './commandBase';

export interface OpenIssueOnRemoteCommandArgs {
	clipboard?: boolean;
	issue?: { url: string };
}

@command()
export class OpenIssueOnRemoteCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: Omit<OpenIssueActionContext, 'type'>): string {
		return createMarkdownCommandLink(`${actionCommandPrefix}openIssue`, {
			...args,
			type: 'openIssue',
		});
	}

	constructor() {
		super('gitlens.openIssueOnRemote');
	}

	async execute(args?: OpenIssueOnRemoteCommandArgs): Promise<void> {
		if (args?.issue == null) {
			void window.showInformationMessage('No issue provided');
			Logger.warn(getLogScope(), 'No issue provided in OpenIssueOnRemoteCommand', args);
			return;
		}

		if (args.clipboard) {
			await env.clipboard.writeText(args.issue.url);
		} else {
			void openUrl(args.issue.url);
		}
	}
}
