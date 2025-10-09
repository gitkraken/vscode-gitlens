/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { LanguageModelChatSelector, Range, Uri } from 'vscode';

export enum ChatModeKind {
	Ask = 'ask',
	Edit = 'edit',
	Agent = 'agent',
}

export interface ChatViewOpenOptions {
	/**
	 * The query for chat.
	 */
	query: string;
	/**
	 * Whether the query is partial and will await more input from the user.
	 */
	isPartialQuery?: boolean;
	/**
	 * A list of tools IDs with `canBeReferencedInPrompt` that will be resolved and attached if they exist.
	 */
	toolIds?: string[];
	/**
	 * Any previous chat requests and responses that should be shown in the chat view.
	 */
	previousRequests?: IChatViewOpenRequestEntry[];
	/**
	 * Whether a screenshot of the focused window should be taken and attached
	 */
	attachScreenshot?: boolean;
	/**
	 * A list of file URIs to attach to the chat as context.
	 */
	attachFiles?: (Uri | { uri: Uri; range: Range })[];
	/**
	 * A list of source control history item changes to attach to the chat as context.
	 */
	attachHistoryItemChanges?: { uri: Uri; historyItemId: string }[];
	/**
	 * A list of source control history item change ranges to attach to the chat as context.
	 */
	attachHistoryItemChangeRanges?: {
		start: { uri: Uri; historyItemId: string };
		end: { uri: Uri; historyItemId: string };
	}[];
	/**
	 * The mode ID or name to open the chat in.
	 */
	mode?: ChatModeKind | string;

	/**
	 * The language model selector to use for the chat.
	 * An Error will be thrown if there's no match. If there are multiple
	 * matches, the first match will be used.
	 *
	 * Examples:
	 *
	 * ```
	 * {
	 *   id: 'claude-sonnet-4',
	 *   vendor: 'copilot'
	 * }
	 * ```
	 *
	 * Use `claude-sonnet-4` from any vendor:
	 *
	 * ```
	 * {
	 *   id: 'claude-sonnet-4',
	 * }
	 * ```
	 */
	modelSelector?: LanguageModelChatSelector;

	/**
	 * Wait to resolve the command until the chat response reaches a terminal state (complete, error, or pending user confirmation, etc.).
	 */
	blockOnResponse?: boolean;
}

export interface ChatViewOpenRequestEntry {
	request: string;
	response: string;
}
