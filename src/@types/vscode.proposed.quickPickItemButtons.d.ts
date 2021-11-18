/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// https://github.com/microsoft/vscode/issues/88716

declare module 'vscode' {
	export interface QuickPickItem {
		buttons?: QuickInputButton[];
	}

	export interface QuickPick<T extends QuickPickItem> extends QuickInput {
		readonly onDidTriggerItemButton: Event<QuickPickItemButtonEvent<T>>;
	}

	export interface QuickPickItemButtonEvent<T extends QuickPickItem> {
		button: QuickInputButton;
		item: T;
	}
}
