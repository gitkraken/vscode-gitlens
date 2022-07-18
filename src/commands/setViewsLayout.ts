import { window } from 'vscode';
import * as nls from 'vscode-nls';
import { viewsConfigKeys } from '../configuration';
import { Commands, CoreCommands } from '../constants';
import type { Container } from '../container';
import { command, executeCommand, executeCoreCommand } from '../system/command';
import { Command } from './base';

const localize = nls.loadMessageBundle();

enum ViewsLayout {
	GitLens = 'gitlens',
	SourceControl = 'scm',
}

export interface SetViewsLayoutCommandArgs {
	layout: ViewsLayout;
}

@command()
export class SetViewsLayoutCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.SetViewsLayout);
	}

	async execute(args?: SetViewsLayoutCommandArgs) {
		let layout = args?.layout;
		if (layout == null) {
			const pick = await window.showQuickPick(
				[
					{
						label: localize('sourceControlLayout', 'Source Control Layout'),
						description: `(${localize('default', 'default')})`,
						detail: localize(
							'showsAllViewsOnSourceControlSideBar',
							'Shows all the views together on the Source Control side bar',
						),
						layout: ViewsLayout.SourceControl,
					},
					{
						label: localize('gitlensLayout', 'GitLens Layout'),
						description: '',
						detail: localize(
							'showsAllViewsOnGitlensSideBar',
							'Shows all the views together on the GitLens side bar',
						),
						layout: ViewsLayout.GitLens,
					},
				],
				{
					placeHolder: localize('chooseGitlensViewsLayout', 'Choose a GitLens views layout'),
				},
			);
			if (pick == null) return;

			layout = pick.layout;
		}

		switch (layout) {
			case ViewsLayout.GitLens:
				try {
					// Because of https://github.com/microsoft/vscode/issues/105774, run the command twice which seems to fix things
					let count = 0;
					while (count++ < 2) {
						void (await executeCoreCommand(CoreCommands.MoveViews, {
							viewIds: viewsConfigKeys.map(view => `gitlens.views.${view}`),
							destinationId: 'workbench.view.extension.gitlens',
						}));
					}
				} catch {}

				break;
			case ViewsLayout.SourceControl:
				try {
					// Because of https://github.com/microsoft/vscode/issues/105774, run the command twice which seems to fix things
					let count = 0;
					while (count++ < 2) {
						void (await executeCoreCommand(CoreCommands.MoveViews, {
							viewIds: viewsConfigKeys.map(view => `gitlens.views.${view}`),
							destinationId: 'workbench.view.scm',
						}));
					}
				} catch {
					for (const view of viewsConfigKeys) {
						void (await executeCommand(`gitlens.views.${view}.resetViewLocation`));
					}
				}

				break;
		}
	}
}
