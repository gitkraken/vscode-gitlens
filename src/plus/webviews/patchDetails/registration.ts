import { ViewColumn } from 'vscode';
import { Commands } from '../../../constants.commands';
import type { Sources } from '../../../constants.telemetry';
import { executeCommand } from '../../../system/vscode/command';
import { configuration } from '../../../system/vscode/configuration';
import { setContext } from '../../../system/vscode/context';
import type { Serialized } from '../../../system/vscode/serialize';
import type { WebviewPanelShowCommandArgs, WebviewsController } from '../../../webviews/webviewsController';
import type { CreateDraft, State, ViewDraft } from './protocol';

export type ShowCreateDraft = {
	mode: 'create';
	create?: CreateDraft;
	source?: Sources;
};

export type ShowViewDraft = {
	mode: 'view';
	draft: ViewDraft;
	source?: Sources;
};

export type PatchDetailsWebviewShowingArgs = [ShowCreateDraft | ShowViewDraft];

export function registerPatchDetailsWebviewView(controller: WebviewsController) {
	return controller.registerWebviewView<State, Serialized<State>, PatchDetailsWebviewShowingArgs>(
		{
			id: 'gitlens.views.patchDetails',
			fileName: 'patchDetails.html',
			title: 'Patch',
			contextKeyPrefix: `gitlens:webviewView:patchDetails`,
			trackingFeature: 'patchDetailsView',
			plusFeature: true,
			webviewHostOptions: {
				retainContextWhenHidden: false,
			},
		},
		async (container, host) => {
			const { PatchDetailsWebviewProvider } = await import(
				/* webpackChunkName: "webview-patchDetails" */ './patchDetailsWebview'
			);
			return new PatchDetailsWebviewProvider(container, host);
		},
		async (...args) => {
			if (configuration.get('cloudPatches.experimental.layout') === 'editor') {
				await setContext('gitlens:views:patchDetails:mode', undefined);
				void executeCommand<WebviewPanelShowCommandArgs>(Commands.ShowPatchDetailsPage, undefined, ...args);
				return;
			}

			const arg = args[0];
			if (arg == null) return;

			await setContext('gitlens:views:patchDetails:mode', 'state' in arg ? arg.state.mode : arg.mode);
		},
	);
}

export function registerPatchDetailsWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State, Serialized<State>, PatchDetailsWebviewShowingArgs>(
		{ id: Commands.ShowPatchDetailsPage, options: { preserveInstance: true } },
		{
			id: 'gitlens.patchDetails',
			fileName: 'patchDetails.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Patch',
			contextKeyPrefix: `gitlens:webview:patchDetails`,
			trackingFeature: 'patchDetailsWebview',
			plusFeature: true,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: false,
				enableFindWidget: false,
			},
			allowMultipleInstances: true,
		},
		async (container, host) => {
			const { PatchDetailsWebviewProvider } = await import(
				/* webpackChunkName: "webview-patchDetails" */ './patchDetailsWebview'
			);
			return new PatchDetailsWebviewProvider(container, host);
		},
	);
}
