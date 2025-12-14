import type { ViewColumn, WebviewOptions, WebviewPanelOptions } from 'vscode';
import type { TrackedUsageFeatures } from '../constants.telemetry';
import type {
	CustomEditorIds,
	CustomEditorTypeFromId,
	WebviewIds,
	WebviewTypeFromId,
	WebviewViewIds,
	WebviewViewTypeFromId,
} from '../constants.views';

export interface CustomEditorDescriptor<ID extends CustomEditorIds = CustomEditorIds> {
	id: ID;
	readonly fileName: string;
	readonly iconPath: string;
	readonly title: string;
	readonly contextKeyPrefix: `gitlens:webview:${CustomEditorTypeFromId<ID>}`;
	readonly trackingFeature: TrackedUsageFeatures;
	readonly type: CustomEditorTypeFromId<ID>;
	readonly plusFeature: boolean;
	readonly webviewOptions?: WebviewOptions;
	readonly webviewHostOptions?: WebviewPanelOptions;

	readonly allowMultipleInstances?: never;
}

export interface WebviewPanelDescriptor<ID extends WebviewIds> {
	id: ID;
	readonly fileName: string;
	readonly iconPath: string;
	readonly title: string;
	readonly contextKeyPrefix: `gitlens:webview:${WebviewTypeFromId<ID>}`;
	readonly trackingFeature: TrackedUsageFeatures;
	readonly type: WebviewTypeFromId<ID>;
	readonly plusFeature: boolean;
	readonly column?: ViewColumn;
	readonly webviewOptions?: WebviewOptions;
	readonly webviewHostOptions?: WebviewPanelOptions;

	readonly allowMultipleInstances?: boolean;
}

export interface WebviewViewDescriptor<ID extends WebviewViewIds = WebviewViewIds> {
	id: ID;
	readonly fileName: string;
	readonly title: string;
	readonly contextKeyPrefix: `gitlens:webviewView:${WebviewViewTypeFromId<ID>}`;
	readonly trackingFeature: TrackedUsageFeatures;
	readonly type: WebviewViewTypeFromId<ID>;
	readonly plusFeature: boolean;
	readonly webviewOptions?: WebviewOptions;
	readonly webviewHostOptions?: {
		readonly retainContextWhenHidden?: boolean;
	};

	readonly allowMultipleInstances?: never;
}
