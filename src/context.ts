import { commands } from 'vscode';
import { BuiltInCommands } from './constants';

export const enum ContextKeys {
	ActionPrefix = 'gitlens:action:',
	KeyPrefix = 'gitlens:key:',

	ActiveFileStatus = 'gitlens:activeFileStatus',
	AnnotationStatus = 'gitlens:annotationStatus',
	DisabledToggleCodeLens = 'gitlens:disabledToggleCodeLens',
	Disabled = 'gitlens:disabled',
	Enabled = 'gitlens:enabled',
	HasConnectedRemotes = 'gitlens:hasConnectedRemotes',
	HasRemotes = 'gitlens:hasRemotes',
	HasRichRemotes = 'gitlens:hasRichRemotes',
	Readonly = 'gitlens:readonly',
	ViewsCanCompare = 'gitlens:views:canCompare',
	ViewsCanCompareFile = 'gitlens:views:canCompare:file',
	ViewsCommitsMyCommitsOnly = 'gitlens:views:commits:myCommitsOnly',
	ViewsFileHistoryCanPin = 'gitlens:views:fileHistory:canPin',
	ViewsFileHistoryCursorFollowing = 'gitlens:views:fileHistory:cursorFollowing',
	ViewsFileHistoryEditorFollowing = 'gitlens:views:fileHistory:editorFollowing',
	ViewsLineHistoryEditorFollowing = 'gitlens:views:lineHistory:editorFollowing',
	ViewsRepositoriesAutoRefresh = 'gitlens:views:repositories:autoRefresh',
	ViewsSearchAndCompareKeepResults = 'gitlens:views:searchAndCompare:keepResults',
	ViewsWelcomeVisible = 'gitlens:views:welcome:visible',
	Vsls = 'gitlens:vsls',
}

// const contextStorage = new Map<string, unknown>();

// export function getContext(key: ContextKeys): unknown | undefined {
// 	return contextStorage.get(key);
// }

export async function setContext(
	key: ContextKeys | `${ContextKeys.ActionPrefix}${string}` | `${ContextKeys.KeyPrefix}${string}`,
	value: unknown,
): Promise<void> {
	// contextStorage.set(key, value);
	void (await commands.executeCommand(BuiltInCommands.SetContext, key, value));
}
