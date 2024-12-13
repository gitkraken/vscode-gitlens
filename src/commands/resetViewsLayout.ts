import { GlCommand } from '../constants.commands';
import type { ViewIds } from '../constants.views';
import { viewIdsByDefaultContainerId } from '../constants.views';
import type { Container } from '../container';
import { command, executeCoreCommand } from '../system/vscode/command';
import { GlCommandBase } from './base';

@command()
export class ResetViewsLayoutCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.ResetViewsLayout);
	}

	async execute() {
		// Don't use this because it will forcibly show & expand every view
		// for (const view of viewIds) {
		// 	void (await executeCoreCommand(`gitlens.views.${view}.resetViewLocation`));
		// }

		for (const [containerId, viewIds] of viewIdsByDefaultContainerId) {
			try {
				void (await executeCoreCommand('vscode.moveViews', {
					viewIds: viewIds.map<ViewIds>(v => `gitlens.views.${v}`),
					destinationId: containerId,
				}));
			} catch {}

			if (containerId.includes('gitlens')) {
				void (await executeCoreCommand(`${containerId}.resetViewContainerLocation`));
			}
		}
	}
}
