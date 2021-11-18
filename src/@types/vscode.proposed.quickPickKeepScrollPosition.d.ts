/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// https://github.com/microsoft/vscode/issues/132068

declare module 'vscode' {
	export interface QuickPick<T extends QuickPickItem> extends QuickInput {
		/*
		 * An optional flag to maintain the scroll position of the quick pick when the quick pick items are updated. Defaults to false.
		 */
		keepScrollPosition?: boolean;
	}
}
