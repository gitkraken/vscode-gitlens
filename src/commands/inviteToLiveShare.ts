import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import type { CommandContext } from './base';
import { Command, isCommandContextViewNodeHasContributor } from './base';

export interface InviteToLiveShareCommandArgs {
	email?: string;
}

@command()
export class InviteToLiveShareCommand extends Command {
	static getMarkdownCommandArgs(args: InviteToLiveShareCommandArgs): string;
	static getMarkdownCommandArgs(email: string | undefined): string;
	static getMarkdownCommandArgs(argsOrEmail: InviteToLiveShareCommandArgs | string | undefined): string {
		const args =
			argsOrEmail === undefined || typeof argsOrEmail === 'string' ? { email: argsOrEmail } : argsOrEmail;
		return super.getMarkdownCommandArgsCore<InviteToLiveShareCommandArgs>(Commands.InviteToLiveShare, args);
	}

	constructor(private readonly container: Container) {
		super(Commands.InviteToLiveShare);
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
