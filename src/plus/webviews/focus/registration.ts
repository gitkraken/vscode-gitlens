import { Disposable, ViewColumn } from 'vscode';
import { Commands } from '../../../constants';
import { registerCommand } from '../../../system/command';
import { configuration } from '../../../system/configuration';
import type { WebviewPanelsProxy, WebviewsController } from '../../../webviews/webviewsController';
import type { State } from './protocol';

export function registerFocusWebviewPanel(controller: WebviewsController) {
	return controller.registerWebviewPanel<State>(
		{ id: Commands.ShowFocusPage, options: { preserveInstance: true } },
		{
			id: 'gitlens.focus',
			fileName: 'focus.html',
			iconPath: 'images/gitlens-icon.png',
			title: 'GitLens Launchpad',
			contextKeyPrefix: `gitlens:webview:focus`,
			trackingFeature: 'focusWebview',
			plusFeature: true,
			column: ViewColumn.Active,
			webviewHostOptions: {
				retainContextWhenHidden: true,
				enableFindWidget: true,
			},
			allowMultipleInstances: configuration.get('launchpad.allowMultiple'),
		},
		async (container, host) => {
			const { FocusWebviewProvider } = await import(/* webpackChunkName: "webview-focus" */ './focusWebview');
			return new FocusWebviewProvider(container, host);
		},
	);
}

export function registerFocusWebviewCommands(panels: WebviewPanelsProxy) {
	return Disposable.from(
		registerCommand(`gitlens.launchpad.refresh`, () => void panels.getActiveInstance()?.refresh(true)),
		registerCommand(
			`gitlens.launchpad.split`,
			() => void panels.splitActiveInstance({ preserveInstance: false, column: ViewColumn.Beside }),
		),
	);
}
