import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import { window } from 'vscode';
import { urls } from '../../../../constants.js';
import { Container } from '../../../../container.js';
import { openUrl } from '../../../../system/-webview/vscode/uris.js';
import { maybeStartLoggableScope } from '../../../../system/logger.scope.js';
import { joinPaths } from '../../../../system/path.js';
import { run } from '../../git/shell.js';
import { getPlatform } from '../../platform.js';

/**
 * Extracts a zip file to a destination directory using the fflate library.
 * This is a cross-platform alternative to using OS-specific unzip commands.
 *
 * @param zipPath - The path to the zip file to extract
 * @param destPath - The destination directory where files will be extracted
 * @param options - Optional extraction options
 * @param options.filter - Optional filter function to select which files to extract. Return true to extract the file.
 * @throws Error if extraction fails or if path traversal is detected
 */
export async function extractZipFile(
	zipPath: string,
	destPath: string,
	options?: { filter?: (filename: string) => boolean },
): Promise<void> {
	// Dynamically import fflate to avoid bundling it when not needed
	const { unzip } = await import(/* webpackChunkName: "lib-unzip" */ 'fflate');

	// Read the zip file (returns a Buffer, which extends Uint8Array in Node.js)
	const zipData = await readFile(zipPath);

	// Unzip asynchronously (runs in worker thread, doesn't block main thread)
	// Use fflate's built-in filter to avoid decompressing unwanted files
	const filter = options?.filter;
	const unzipped = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
		unzip(
			// Buffer is a Uint8Array, but TypeScript needs the cast for strict type checking
			zipData as Uint8Array,
			{
				filter: filter
					? file => {
							// Skip directory entries (they end with /)
							if (file.name.endsWith('/')) return false;
							// Apply user filter
							return filter(file.name);
						}
					: undefined,
			},
			(err, result) => {
				if (err) {
					reject(err);
				} else {
					resolve(result);
				}
			},
		);
	});

	// Extract the files
	for (const [filename, data] of Object.entries(unzipped)) {
		// Skip directory entries (they end with /)
		if (filename.endsWith('/')) continue;

		// Resolve the full path and ensure it's within the destination (prevents path traversal)
		const filePath = resolve(destPath, filename);
		const resolvedDest = resolve(destPath);
		if (!filePath.startsWith(resolvedDest + sep) && filePath !== resolvedDest) {
			throw new Error(`Path traversal detected in zip file: ${filename}`);
		}

		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, data);
		// Make 'gk' executable on Unix systems
		if (getPlatform() !== 'windows' && (filename === 'gk' || filename.endsWith('/gk'))) {
			await chmod(filePath, 0o755);
		}
	}
}

export function toMcpInstallProvider<T extends string | undefined>(appHostName: T): T {
	switch (appHostName) {
		case 'code':
			return 'vscode' as T;
		case 'code-insiders':
			return 'vscode-insiders' as T;
		case 'code-exploration':
			return 'vscode-exploration' as T;
		default:
			return appHostName;
	}
}

export async function runCLICommand(args: string[], options?: { cwd?: string }): Promise<string> {
	const cwd = options?.cwd ?? Container.instance.storage.getScoped('gk:cli:path');
	const command = cwd == null ? undefined : joinPaths(cwd, getPlatform() === 'windows' ? 'gk.exe' : 'gk');
	using scope = maybeStartLoggableScope(
		`${command} ${args[0] === 'auth' ? '[auth]' : args.join(' ')}`,
		{ level: 'trace' },
		'CLI',
	);

	if (command == null) {
		scope?.setFailed('CLI is not installed');
		debugger;
		throw new Error('CLI is not installed');
	}

	// eslint-disable-next-line no-return-await -- await is needed for the scope to be properly disposed
	return await run(command, args, 'utf8', { cwd: cwd });
}

const CLIVersionOutputs = {
	core: /CLI Core: (\d+\.\d+\.\d+)/,
	installer: /CLI Installer: (\d+\.\d+\.\d+)/,
} as const;

export async function getCLIVersions(cliPath?: string): Promise<{ proxy: string; core: string } | undefined> {
	try {
		const output = await runCLICommand(['version'], cliPath ? { cwd: cliPath } : undefined);
		const coreMatch = output.match(CLIVersionOutputs.core)?.[1];
		const installerMatch = output.match(CLIVersionOutputs.installer)?.[1];

		if (!coreMatch || !installerMatch) {
			throw new Error(`Unexpected CLI version output: ${output}`);
		}

		return {
			core: coreMatch,
			proxy: installerMatch,
		};
	} catch (ex) {
		if (ex instanceof Error && ex.message.includes('CLI is not installed')) {
			return undefined;
		}
		debugger;
		throw ex;
	}
}

export async function showManualMcpSetupPrompt(message: string): Promise<void> {
	const learnMore = { title: 'View Setup Instructions' };
	const cancel = { title: 'Cancel', isCloseAffordance: true };
	const result = await window.showErrorMessage(message, { modal: true }, learnMore, cancel);

	if (result === learnMore) {
		void openUrl(urls.helpCenterMCP);
	}
}
