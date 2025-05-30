import type { QualifiedViewIds } from '../constants';
import { Commands, viewIdsByDefaultContainerId } from '../constants';
import type { Container } from '../container';
import { command, executeCoreCommand } from '../system/command';
import { Command } from './base';

@command()
export class ResetViewsLayoutCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetViewsLayout);
	}

	async execute() {
		// Don't use this because it will forcibly show & expand every view
		// for (const view of viewIds) {
		// 	void (await executeCoreCommand(`gitlens.views.${view}.resetViewLocation`));
		// }

		for (const [containerId, viewIds] of viewIdsByDefaultContainerId) {
			try {
				void (await executeCoreCommand('vscode.moveViews', {
					viewIds: viewIds.map<QualifiedViewIds>(v => `gitlens.views.${v}`),
					destinationId: containerId,
				}));
			} catch {}

			if (containerId.includes('gitlens')) {
				void (await executeCoreCommand(`${containerId}.resetViewContainerLocation`));
			}
		}
	}
}
