import type { ColorTheme, ThemeIcon } from 'vscode';
import { version as codeVersion, ColorThemeKind, env, ExtensionMode, Uri, window, workspace } from 'vscode';
import { getPlatform } from '@env/platform';
import type { IconPath } from '../../@types/vscode.iconpath';
import type { Container } from '../../container';
import { joinPaths, normalizePath } from '../path';
import { getDistributionGroup } from '../string';
import { satisfies } from '../version';
import { executeCoreCommand } from './command';
import { configuration } from './configuration';
import { exists } from './vscode/uris';

export const deviceCohortGroup = getDistributionGroup(env.machineId);

export function getExtensionModeLabel(mode: ExtensionMode): string {
	switch (mode) {
		case ExtensionMode.Production:
			return 'production';
		case ExtensionMode.Development:
			return 'dev';
		case ExtensionMode.Test:
			return 'test';
		default:
			// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
			return `unknown (${mode})`;
	}
}

let _hostAppName: string | undefined | null;
export async function getHostAppName(): Promise<string | undefined> {
	if (_hostAppName !== undefined) return _hostAppName ?? undefined;

	switch (env.appName) {
		case 'Visual Studio Code':
			_hostAppName = 'code';
			break;
		case 'Visual Studio Code - Insiders':
			_hostAppName = 'code-insiders';
			break;
		case 'Visual Studio Code - Exploration':
			_hostAppName = 'code-exploration';
			break;
		case 'VSCodium':
			_hostAppName = 'codium';
			break;
		case 'Cursor':
			_hostAppName = 'cursor';
			break;
		case 'Windsurf':
			_hostAppName = 'windsurf';
			break;
		default: {
			try {
				const bytes = await workspace.fs.readFile(Uri.file(joinPaths(env.appRoot, 'product.json')));
				const product = JSON.parse(new TextDecoder().decode(bytes));
				_hostAppName = product.applicationName;
			} catch {
				_hostAppName = null;
			}

			break;
		}
	}

	return _hostAppName ?? undefined;
}

let _hostExecutablePath: string | undefined;
export async function getHostExecutablePath(): Promise<string> {
	if (_hostExecutablePath != null) return _hostExecutablePath;

	const platform = getPlatform();

	const app = (await getHostAppName()) ?? 'code';

	_hostExecutablePath = app;
	if (env.remoteName) return app;

	async function checkPath(path: string) {
		return (await exists(Uri.file(path))) ? path : undefined;
	}

	switch (platform) {
		case 'windows':
		case 'linux':
			_hostExecutablePath =
				(await checkPath(joinPaths(env.appRoot, '..', '..', 'bin', app))) ??
				(await checkPath(joinPaths(env.appRoot, 'bin', app))) ??
				app;
			break;
		case 'macOS':
			_hostExecutablePath =
				(await checkPath(joinPaths(env.appRoot, 'bin', app))) ??
				(await checkPath(joinPaths(env.appRoot, '..', '..', 'bin', app))) ??
				app;
			break;
		default:
			throw new Error(`Unsupported platform: ${platform}`);
	}

	return _hostExecutablePath;
}

export async function getHostEditorCommand(includeWorkspaceUri: boolean = false): Promise<string> {
	const path = normalizePath(await getHostExecutablePath()).replace(/ /g, '\\ ');
	if (includeWorkspaceUri) {
		const uri = workspace.workspaceFile ?? workspace.workspaceFolders?.[0]?.uri;
		if (uri != null) {
			return `${path} --wait --reuse-window --folder-uri="${uri.toString()}"`;
		}
	}

	return `${path} --wait --reuse-window`;
}

export function getIconPathUris(container: Container, filename: string): Exclude<IconPath, ThemeIcon> {
	return {
		dark: Uri.file(container.context.asAbsolutePath(`images/dark/${filename}`)),
		light: Uri.file(container.context.asAbsolutePath(`images/light/${filename}`)),
	};
}

export function getQuickPickIgnoreFocusOut(): boolean {
	return !configuration.get('advanced.quickPick.closeOnFocusOut');
}

export function isDarkTheme(theme: ColorTheme): boolean {
	return theme.kind === ColorThemeKind.Dark || theme.kind === ColorThemeKind.HighContrast;
}

export function isLightTheme(theme: ColorTheme): boolean {
	return theme.kind === ColorThemeKind.Light || theme.kind === ColorThemeKind.HighContrastLight;
}

export function isHostVSCode(hostAppName: string | undefined): boolean {
	return hostAppName === 'code' || hostAppName === 'code-insiders' || hostAppName === 'code-exploration';
}

export async function openWalkthrough(
	extensionId: string,
	walkthroughId: string,
	stepId?: string,
	openToSide: boolean = true,
): Promise<void> {
	// Only open to side if there is an active tab
	if (openToSide && window.tabGroups.activeTabGroup.activeTab == null) {
		openToSide = false;
	}

	// Takes the following params: walkthroughID: string | { category: string, step: string } | undefined, toSide: boolean | undefined
	void (await executeCoreCommand(
		'workbench.action.openWalkthrough',
		{
			category: `${extensionId}#${walkthroughId}`,
			step: stepId,
		},
		openToSide,
	));
}

export async function revealInFileExplorer(uri: Uri): Promise<void> {
	void (await executeCoreCommand('revealFileInOS', uri));
}

export function supportedInVSCodeVersion(feature: 'language-models'): boolean {
	switch (feature) {
		case 'language-models':
			return satisfies(codeVersion, '>= 1.90-insider');
		default:
			return false;
	}
}
