import { ViewColumn } from 'vscode';
import type { Sources } from '../../../constants.telemetry';
import type { WebviewPanelsProxy, WebviewsController } from '../../webviewsController';
import type { ComposerHunk, ComposerHunkMap, State } from './protocol';

export interface ComposerCommandArgs {
	hunks?: ComposerHunk[];
	hunkMap?: ComposerHunkMap[];
	baseCommit?: string;
	commits?: any[];
	source?: Sources;
}

export type ComposerWebviewShowingArgs = [ComposerCommandArgs];

export function registerComposerWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.composer', ComposerWebviewShowingArgs, State> {
	return controller.registerWebviewPanel<'gitlens.composer', State, State, ComposerWebviewShowingArgs>(
		{ id: 'gitlens.showComposerPage' },
		{
			id: 'gitlens.composer',
			fileName: 'composer.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'GitLens Composer',
			contextKeyPrefix: `gitlens:webview:composer`,
			trackingFeature: 'composerWebview',
			type: 'composer',
			plusFeature: false,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: false,
				enableFindWidget: true,
			},
		},
		async (container, host) => {
			const { ComposerWebviewProvider } = await import(
				/* webpackChunkName: "webview-composer" */ './composerWebview'
			);
			return new ComposerWebviewProvider(container, host);
		},
	);
}
