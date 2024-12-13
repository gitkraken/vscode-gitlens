import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { createMarkdownCommandLink } from '../system/commands';
import { command } from '../system/vscode/command';
import type { CommandContext } from './base';
import { GlCommandBase, isCommandContextViewNodeHasContributor } from './base';

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
		return createMarkdownCommandLink<InviteToLiveShareCommandArgs>(GlCommand.InviteToLiveShare, args);
	}

	constructor(private readonly container: Container) {
		super(GlCommand.InviteToLiveShare);
	}

	protected override preExecute(context: CommandContext, args?: InviteToLiveShareCommandArgs) {
		if (isCommandContextViewNodeHasContributor(context)) {
			args = { ...args };
			args.email = context.node.contributor.email;
			return this.execute(args);
		}

		return this.execute(args);
	}

	async execute(args?: InviteToLiveShareCommandArgs) {
		if (args?.email) {
			const contact = await this.container.vsls.getContact(args.email);
			if (contact != null) {
				return contact.invite();
			}
		}

		return this.container.vsls.startSession();
	}
}
