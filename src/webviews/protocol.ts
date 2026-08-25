import type { WebviewIds } from '../constants.views.js';
import type { ConfigPath, ConfigPathValue, Path, PathValue } from '../system/-webview/configuration.js';

// CONFIG & STATE

interface CustomConfig {
	rebaseEditor: {
		enabled: boolean;
	};
	currentLine: {
		useUncommittedChangesFormat: boolean;
	};
}

export type CustomConfigPath = Path<CustomConfig>;
export type CustomConfigPathValue<P extends CustomConfigPath> = PathValue<CustomConfig, P>;

const customConfigKeys: readonly CustomConfigPath[] = [
	'rebaseEditor.enabled',
	'currentLine.useUncommittedChangesFormat',
];

export function isCustomConfigKey(key: string): key is CustomConfigPath {
	return customConfigKeys.includes(key as CustomConfigPath);
}

export function assertsConfigKeyValue<T extends ConfigPath>(
	_key: T,
	_value: unknown,
): asserts _value is ConfigPathValue<T> {
	// Noop
}

export interface WebviewState<Id extends WebviewIds> {
	webviewId: Id;
	webviewInstanceId: string | undefined;
	timestamp: number;
}
