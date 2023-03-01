import { window } from 'vscode';
import { viewsConfigKeys } from '../config';
import { Commands, CoreCommands } from '../constants';
import type { Container } from '../container';
import { command, executeCommand, executeCoreCommand } from '../system/command';
import { Command } from './base';

export enum ViewsLayout {
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
						label: 'Source Control Layout',
						description: '(default)',
						detail: 'Shows all the views together on the Source Control side bar',
						layout: ViewsLayout.SourceControl,
					},
					{
						label: 'GitLens Layout',
						description: '',
						detail: 'Shows all the views together on the GitLens side bar',
						layout: ViewsLayout.GitLens,
					},
				],
				{
					placeHolder: 'Choose a GitLens views layout',
				},
			);
			if (pick == null) return;

			layout = pick.layout;
		}

		void this.container.storage.store('views:layout', layout);

		const views = viewsConfigKeys.filter(v => v !== 'contributors');

		switch (layout) {
			case ViewsLayout.GitLens:
				try {
					// Because of https://github.com/microsoft/vscode/issues/105774, run the command twice which seems to fix things
					let count = 0;
					while (count++ < 2) {
						void (await executeCoreCommand(CoreCommands.MoveViews, {
							viewIds: views.map(v => `gitlens.views.${v}`),
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
							viewIds: views.map(v => `gitlens.views.${v}`),
							destinationId: 'workbench.view.scm',
						}));
					}
				} catch {
					for (const view of views) {
						void (await executeCommand(`gitlens.views.${view}.resetViewLocation`));
					}
				}

				break;
		}
	}
}
