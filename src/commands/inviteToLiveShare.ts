'use strict';
import { command, Command, CommandContext, Commands, isCommandViewContextWithContributor } from './common';
import { Container } from '../container';

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

    constructor() {
        super(Commands.InviteToLiveShare);
    }

    protected preExecute(context: CommandContext, args: InviteToLiveShareCommandArgs = {}) {
        if (isCommandViewContextWithContributor(context)) {
            args = { ...args };
            args.email = context.node.contributor.email;
            return this.execute(args);
        }

        return this.execute(args);
    }

    async execute(args: InviteToLiveShareCommandArgs = {}) {
        if (args.email) {
            const contact = await Container.vsls.getContact(args.email);
            if (contact != null) {
                return contact.invite();
            }
        }

        return Container.vsls.startSession();
    }
}
