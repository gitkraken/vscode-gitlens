import { commands } from 'vscode';
import { ContextKeys, CoreCommands } from './constants';

// const contextStorage = new Map<string, unknown>();

// export function getContext(key: ContextKeys): unknown | undefined {
// 	return contextStorage.get(key);
// }

export async function setContext(
	key: ContextKeys | `${ContextKeys.ActionPrefix}${string}` | `${ContextKeys.KeyPrefix}${string}`,
	value: unknown,
): Promise<void> {
	// contextStorage.set(key, value);
	void (await commands.executeCommand(CoreCommands.SetContext, key, value));
}
