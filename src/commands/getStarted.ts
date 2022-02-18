import { Commands, CoreCommands } from '../constants';
import type { Container } from '../container';
import { command, executeCoreCommand } from '../system/command';
import { Command } from './base';

@command()
export class GetStartedCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.GetStarted);
	}

	execute(step?: string) {
		const id = this.container.context.extension.id;
		// If the step param is the same as the extension id, then this was run from the extensions view gear menu
		if (step === id) {
			step = undefined;
		}

		// Takes the following params: walkthroughID: string | { category: string, step: string } | undefined, toSide: boolean | undefined
		void executeCoreCommand(CoreCommands.OpenWalkthrough, `${id}#${step ?? 'gitlens.welcome'}`, true);
	}
}
