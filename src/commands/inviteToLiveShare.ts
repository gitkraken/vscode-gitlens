import type { Uri } from 'vscode';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { createMarkdownCommandLink } from '../system/commands.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';
import { isCommandContextViewNodeHasContributor } from './commandContext.utils.js';

export interface InviteToLiveShareCommandArgs {
	email?: string;
}

@command()
export class InviteToLiveShareCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: InviteToLiveShareCommandArgs): string;
	static createMarkdownCommandLink(email: string | undefined): string;
	static createMarkdownCommandLink(argsOrEmail: InviteToLiveShareCommandArgs | string | undefined): string {
		const args =
			argsOrEmail === undefined || typeof argsOrEmail === 'string' ? { email: argsOrEmail } : argsOrEmail;
		return createMarkdownCommandLink<InviteToLiveShareCommandArgs>('gitlens.inviteToLiveShare', args);
	}

	constructor(private readonly container: Container) {
		super('gitlens.inviteToLiveShare');
	}

	protected override preExecute(
		context: CommandContext,
		args?: InviteToLiveShareCommandArgs,
	): Promise<boolean | Uri | null | undefined> {
		if (isCommandContextViewNodeHasContributor(context)) {
			args = { ...args };
			args.email = context.node.contributor.email;
			return this.execute(args);
		}

		return this.execute(args);
	}

	async execute(args?: InviteToLiveShareCommandArgs): Promise<boolean | Uri | null | undefined> {
		if (args?.email) {
			const contact = await this.container.vsls.getContact(args.email);
			if (contact != null) {
				return contact.invite();
			}
		}

		return this.container.vsls.startSession();
	}
}
