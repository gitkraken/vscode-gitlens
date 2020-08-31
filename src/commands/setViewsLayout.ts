'use strict';
import { commands, window } from 'vscode';
import { viewsConfigKeys } from '../configuration';
import { extensionId } from '../constants';
import { command, Command, Commands } from './common';

enum ViewsLayout {
	GitLens = 'gitlens',
	SourceControl = 'scm',
}

export interface SetViewsLayoutCommandArgs {
	layout: ViewsLayout;
}

@command()
export class SetViewsLayoutCommand extends Command {
	constructor() {
		super(Commands.SetViewsLayout);
	}

	async execute(args?: SetViewsLayoutCommandArgs) {
		let layout = args?.layout;
		if (layout == null) {
			const pick = await window.showQuickPick(
				[
					{
						label: 'GitLens Layout',
						description: '(default)',
						detail: 'Shows all the views together on the GitLens side bar',
						layout: ViewsLayout.GitLens,
					},
					{
						label: 'Source Control Layout',
						description: '',
						detail: 'Shows all the views together on the Source Control side bar',
						layout: ViewsLayout.SourceControl,
					},
				],
				{
					placeHolder: 'Choose a GitLens views layout',
				},
			);
			if (pick == null) return;

			layout = pick.layout;
		}

		switch (layout) {
			case ViewsLayout.GitLens:
				try {
					void (await commands.executeCommand(
						'workbench.action.moveViews',
						viewsConfigKeys.map(
							view => `${extensionId}.views.${view}`,
							`workbench.view.extension.${extensionId}`,
						),
					));
				} catch {}

				break;
			case ViewsLayout.SourceControl:
				try {
					void (await commands.executeCommand(
						'workbench.action.moveViews',
						viewsConfigKeys.map(view => `${extensionId}.views.${view}`, 'workbench.view.scm'),
					));
				} catch {
					for (const view of viewsConfigKeys) {
						void (await commands.executeCommand(`${extensionId}.views.${view}.resetViewLocation`));
					}
				}

				break;
		}
	}
}
