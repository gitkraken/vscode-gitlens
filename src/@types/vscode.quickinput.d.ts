/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License.
 *  See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Minimal augmentations for QuickPick APIs added after VS Code 1.101 (our minimum engine).
 * Keep augmentations scoped to what we actually use so we don't inadvertently compile against
 * APIs unavailable to users on older VS Code versions — guard every use with
 * `supportedInVSCodeVersion(...)`.
 *
 * - `QuickPick.prompt`:                     stable in 1.108
 * - `QuickInputButtonLocation` enum:        stable in 1.109
 * - `QuickInputButton.location` / `.toggle`: stable in 1.109
 */

declare module 'vscode' {
	export interface QuickPick<T extends QuickPickItem> {
		/**
		 * Optional text that provides instructions or context to the user.
		 *
		 * The prompt is displayed below the input box and above the list of items.
		 */
		prompt: string | undefined;
	}

	export enum QuickInputButtonLocation {
		Title = 1,
		Inline = 2,
		Input = 3,
	}

	export interface QuickInputButton {
		/**
		 * Where the button should be rendered. Defaults to `QuickInputButtonLocation.Title`.
		 * Ignored for buttons added to a `QuickPickItem`.
		 */
		location?: QuickInputButtonLocation;

		/**
		 * When present, indicates that the button is a toggle button that can be checked or unchecked.
		 * Only valid when `location` is `QuickInputButtonLocation.Input`.
		 */
		readonly toggle?: {
			/** Whether the toggle is currently checked. Updated by VS Code when the button is toggled. */
			checked: boolean;
		};
	}
}
