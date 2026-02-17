import { env, window } from 'vscode';
import type { OpenIssueActionContext } from '../api/gitlens.d.js';
import { actionCommandPrefix } from '../constants.commands.js';
import { command } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { createMarkdownCommandLink } from '../system/commands.js';
import { Logger } from '../system/logger.js';
import { getScopedLogger } from '../system/logger.scope.js';
import { GlCommandBase } from './commandBase.js';

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
			Logger.warn(getScopedLogger(), 'No issue provided in OpenIssueOnRemoteCommand', args);
			return;
		}

		if (args.clipboard) {
			await env.clipboard.writeText(args.issue.url);
		} else {
			void openUrl(args.issue.url);
		}
	}
}
