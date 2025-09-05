export function toMcpInstallProvider(appHostName: string | undefined): string | undefined {
	switch (appHostName) {
		case 'code':
			return 'vscode';
		case 'code-insiders':
			return 'vscode-insiders';
		case 'code-exploration':
			return 'vscode-exploration';
		default:
			return appHostName;
	}
}
