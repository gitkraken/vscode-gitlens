import { ViewColumn } from 'vscode';
import type { Sources } from '../../../constants.telemetry';
import { executeCommand } from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { setContext } from '../../../system/-webview/context';
import type { Serialized } from '../../../system/serialize';
import type {
	WebviewPanelShowCommandArgs,
	WebviewPanelsProxy,
	WebviewsController,
	WebviewViewProxy,
} from '../../webviewsController';
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

export function registerPatchDetailsWebviewView(
	controller: WebviewsController,
): WebviewViewProxy<'gitlens.views.patchDetails', PatchDetailsWebviewShowingArgs, Serialized<State>> {
	return controller.registerWebviewView<
		'gitlens.views.patchDetails',
		State,
		Serialized<State>,
		PatchDetailsWebviewShowingArgs
	>(
		{
			id: 'gitlens.views.patchDetails',
			fileName: 'patchDetails.html',
			title: 'Patch',
			contextKeyPrefix: `gitlens:webviewView:patchDetails`,
			trackingFeature: 'patchDetailsView',
			type: 'patchDetails',
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
				void executeCommand<WebviewPanelShowCommandArgs>('gitlens.showPatchDetailsPage', undefined, ...args);
				return;
			}

			const arg = args[0];
			if (arg == null) return;

			await setContext('gitlens:views:patchDetails:mode', 'state' in arg ? arg.state.mode : arg.mode);
		},
	);
}

export function registerPatchDetailsWebviewPanel(
	controller: WebviewsController,
): WebviewPanelsProxy<'gitlens.patchDetails', PatchDetailsWebviewShowingArgs, Serialized<State>> {
	return controller.registerWebviewPanel<
		'gitlens.patchDetails',
		State,
		Serialized<State>,
		PatchDetailsWebviewShowingArgs
	>(
		{ id: 'gitlens.showPatchDetailsPage', options: { preserveInstance: true } },
		{
			id: 'gitlens.patchDetails',
			fileName: 'patchDetails.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'Patch',
			contextKeyPrefix: `gitlens:webview:patchDetails`,
			trackingFeature: 'patchDetailsWebview',
			type: 'patchDetails',
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
