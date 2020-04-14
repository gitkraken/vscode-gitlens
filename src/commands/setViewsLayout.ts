'use strict';
import { commands, ConfigurationTarget, window } from 'vscode';
import { configuration, viewKeys, ViewLocation } from '../configuration';
import { command, Command, Commands } from './common';
import { extensionId } from '../constants';

enum ViewsLayout {
	Default = 'default',
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
		if (layout === undefined) {
			const pick = await window.showQuickPick(
				[
					{
						label: 'GitLens Layout',
						description: '(default)',
						detail: 'Shows all the views together on the GitLens side bar',
						layout: ViewsLayout.Default,
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

		let location;
		switch (layout) {
			case ViewsLayout.Default:
				location = ViewLocation.GitLens;
				break;
			case ViewsLayout.SourceControl:
				location = ViewLocation.SourceControl;
				break;
			default:
				return;
		}

		for (const view of viewKeys) {
			if (configuration.get('views', view, 'location') === location) {
				await commands.executeCommand(`${extensionId}.views.${view}:${location}.resetViewLocation`);
			} else {
				await configuration.update('views', view, 'location', location, ConfigurationTarget.Global);
			}
		}
	}
}
