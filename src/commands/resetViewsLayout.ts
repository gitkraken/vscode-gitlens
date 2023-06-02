import { viewsConfigKeys } from '../config';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command, executeCommand } from '../system/command';
import { Command } from './base';

@command()
export class ResetViewsLayoutCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetViewsLayout);
	}

	async execute() {
		for (const view of viewsConfigKeys) {
			void (await executeCommand(`gitlens.views.${view}.resetViewLocation`));
		}
	}
}
