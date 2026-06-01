import { dirname } from 'path';
import { arch } from 'process';
import type { Disposable } from 'vscode';
import { Uri, workspace } from 'vscode';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { fromString, satisfies } from '@gitlens/utils/version.js';
import type { StoredGkCLIInstallInfo } from '../../../../constants.storage.js';
import type { Source, Sources } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import { setContext } from '../../../../system/-webview/context.js';
import { gate } from '../../../../system/decorators/gate.js';
import { getIsOffline, getPlatform, isWeb } from '../../platform.js';
import { CLIInstallError, CLIInstallErrorReason } from './errors.js';
import {
	clearResolvedCLIExecutableCache,
	extractZipFile,
	getCLIExecutable,
	getCLIVersions,
	getDevCLILocalPath,
	isInsidersCLIEnabled,
	isLockedBinaryError,
	resolveCLIExecutable,
	runCLICommand,
} from './utils.js';

const maxAutoInstallAttempts = 5;

export class BinaryInstaller implements Disposable {
	private _cliCoreVersion: string | undefined;

	constructor(private readonly container: Container) {}

	dispose(): void {
		// No-op today; installed state is in storage scope, not in-memory.
	}

	/** Install the CLI. Gated to deduplicate concurrent installs. */
	@gate()
	@debug({ exit: true })
	async install(
		autoInstall?: boolean,
		source?: Sources,
		force = false,
	): Promise<{ cliVersion?: string; cliPath?: string; status: 'completed' | 'unsupported' | 'attempted' }> {
		const scope = getScopedLogger();
		clearResolvedCLIExecutableCache();

		const devLocalPath = getDevCLILocalPath();
		if (devLocalPath != null) {
			const resolved = await resolveCLIExecutable();
			if (resolved != null) {
				scope?.info(`Using local CLI binary: ${resolved.fsPath}`);
				const versions = await getCLIVersions();
				return { cliVersion: versions?.core, cliPath: dirname(resolved.fsPath), status: 'completed' };
			}

			scope?.warn(`Local CLI binary not found at: ${devLocalPath}`);
			return { cliVersion: undefined, cliPath: undefined, status: 'attempted' };
		}

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		let cliInstallAttempts = force ? 0 : (cliInstall?.attempts ?? 0);
		let cliInstallStatus = cliInstall?.status ?? 'attempted';
		let cliVersion = cliInstall?.version;
		const cliPath = this.container.context.globalStorageUri.fsPath;
		const platform = getPlatform();

		if (!force) {
			if (cliInstallStatus === 'completed') {
				cliVersion = cliInstall?.version;
				if (await resolveCLIExecutable(cliPath)) {
					return { cliVersion: cliVersion, cliPath: cliPath, status: 'completed' };
				}

				scope?.warn(`CLI binary not found at expected path: ${getCLIExecutable(cliPath).fsPath}`);

				cliInstallStatus = 'attempted';
				cliVersion = undefined;
			} else if (cliInstallStatus === 'unsupported') {
				return { cliVersion: undefined, cliPath: undefined, status: 'unsupported' };
			} else if (autoInstall && reachedMaxAttempts({ status: cliInstallStatus, attempts: cliInstallAttempts })) {
				scope?.warn(`Skipping auto-install, reached max attempts (${cliInstallAttempts})`);
				return { cliVersion: undefined, cliPath: undefined, status: 'attempted' };
			}
		}

		const insidersEnabled = isInsidersCLIEnabled();

		try {
			if (isWeb) {
				void this.container.storage
					.storeScoped('gk:cli:install', {
						status: 'unsupported',
						attempts: cliInstallAttempts,
					})
					.catch();

				throw new CLIInstallError(CLIInstallErrorReason.UnsupportedPlatform, undefined, 'web');
			}

			if (getIsOffline()) {
				throw new CLIInstallError(CLIInstallErrorReason.Offline);
			}

			cliInstallAttempts += 1;
			scope?.info(`Starting CLI installation (attempt ${cliInstallAttempts}/${maxAutoInstallAttempts})`);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('cli/install/started', {
					source: source,
					autoInstall: autoInstall ?? false,
					attempts: cliInstallAttempts,
					insiders: insidersEnabled,
				});
			}
			void this.container.storage
				.storeScoped('gk:cli:install', {
					status: 'attempted',
					attempts: cliInstallAttempts,
				})
				.catch();

			// Map platform names for the API and get architecture
			let platformName: string;
			let architecture: string;

			switch (arch) {
				case 'x64':
					architecture = 'x64';
					break;
				case 'arm64':
					architecture = 'arm64';
					break;
				default:
					architecture = 'x86'; // Default to x86 for other architectures
					break;
			}

			switch (platform) {
				case 'windows':
					platformName = 'windows';
					break;
				case 'macOS':
					platformName = 'darwin';
					break;
				case 'linux':
					platformName = 'linux';
					break;
				default: {
					void this.container.storage
						.storeScoped('gk:cli:install', {
							status: 'unsupported',
							attempts: cliInstallAttempts,
						})
						.catch();

					throw new CLIInstallError(CLIInstallErrorReason.UnsupportedPlatform, undefined, platform);
				}
			}

			let cliProxyZipFilePath: Uri | undefined;
			let cliExtractedProxyFilePath: Uri | undefined;
			const { globalStorageUri } = this.container.context;

			try {
				// Download the MCP proxy installer
				// TODO: Switch to getGkApiUrl once we support other environments
				const proxyUrl = Uri.joinPath(
					Uri.parse('https://api.gitkraken.dev'),
					'releases',
					'gkcli-proxy',
					insidersEnabled ? 'insiders' : 'production',
					platformName,
					architecture,
					'active',
				).toString();
				/* const proxyUrl = this.container.urls.getGkApiUrl(
					'releases',
					'gkcli-proxy',
					'production',
					platformName,
					architecture,
					'active',
				); */

				scope?.trace(
					`Fetching CLI proxy: platform=${platformName}, arch=${architecture}, edition=${insidersEnabled ? 'insiders' : 'production'}`,
				);
				let response = await fetch(proxyUrl);
				if (!response.ok) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyUrlFetch,
						undefined,
						`${response.status} ${response.statusText}`,
					);
				}

				let downloadUrl: string | undefined;
				try {
					const cliZipArchiveDownloadInfo: { version?: string; packages?: { zip?: string } } | undefined =
						(await response.json()) as any;
					downloadUrl = cliZipArchiveDownloadInfo?.packages?.zip;
					cliVersion = cliZipArchiveDownloadInfo?.version;
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyUrlFormat,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : undefined,
					);
				}

				if (downloadUrl == null) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyUrlFormat,
						undefined,
						'No download URL found for CLI proxy archive',
					);
				}

				scope?.trace(`Downloading CLI proxy (version: ${cliVersion})`);
				response = await fetch(downloadUrl);
				if (!response.ok) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyFetch,
						undefined,
						`${response.status} ${response.statusText}`,
					);
				}

				const cliProxyZipFileDownloadData = await response.arrayBuffer();
				if (cliProxyZipFileDownloadData.byteLength === 0) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyDownload,
						undefined,
						'Downloaded proxy archive data is empty',
					);
				}

				// installer file name is the last part of the download URL
				const cliProxyZipFileName = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1);
				cliProxyZipFilePath = Uri.joinPath(globalStorageUri, cliProxyZipFileName);

				// Ensure the global storage directory exists
				try {
					await workspace.fs.createDirectory(globalStorageUri);
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.GlobalStorageDirectory,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : undefined,
					);
				}

				// Write the installer to the extension storage
				try {
					await workspace.fs.writeFile(cliProxyZipFilePath, new Uint8Array(cliProxyZipFileDownloadData));
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyDownload,
						ex instanceof Error ? ex : undefined,
						'Failed to write proxy archive to global storage',
					);
				}

				try {
					// Extract only the gk binary from the zip file using the fflate library (cross-platform)
					const expectedBinary = platform === 'windows' ? 'gk.exe' : 'gk';
					await extractZipFile(cliProxyZipFilePath.fsPath, globalStorageUri.fsPath, {
						filter: filename => filename === expectedBinary || filename.endsWith(`/${expectedBinary}`),
					});

					// Check using stat to make sure the newly extracted file exists.
					cliExtractedProxyFilePath = Uri.joinPath(globalStorageUri, expectedBinary);

					// This will throw if the file doesn't exist
					await workspace.fs.stat(cliExtractedProxyFilePath);
				} catch (ex) {
					const reason = isLockedBinaryError(ex)
						? CLIInstallErrorReason.ProxyExtractLocked
						: CLIInstallErrorReason.ProxyExtract;
					throw new CLIInstallError(
						reason,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : '',
					);
				}

				try {
					const coreInstallOutput = await runCLICommand(['install'], { cwd: globalStorageUri.fsPath });
					if (!/Directory: (.*)/.test(coreInstallOutput)) {
						throw new Error(`Failed to find core directory in install output: ${coreInstallOutput}`);
					}

					scope?.info(`CLI installed (version: ${cliVersion}, path: ${cliPath})`);
					cliInstallStatus = 'completed';
					void this.container.storage
						.storeScoped('gk:cli:install', {
							status: cliInstallStatus,
							attempts: cliInstallAttempts,
							version: cliVersion,
						})
						.catch();
					void setContext('gitlens:gk:cli:installed', true);

					if (this.container.telemetry.enabled) {
						this.container.telemetry.sendEvent('cli/install/succeeded', {
							autoInstall: autoInstall ?? false,
							attempts: cliInstallAttempts,
							source: source,
							version: cliVersion,
							insiders: insidersEnabled,
						});
					}

					await this.authCLI();
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.CoreInstall,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : '',
					);
				}
			} finally {
				// Clean up the installer zip file
				if (cliProxyZipFilePath != null) {
					try {
						await workspace.fs.delete(cliProxyZipFilePath);
					} catch (ex) {
						scope?.warn('Failed to delete CLI proxy archive', String(ex));
					}
				}
			}
		} catch (ex) {
			scope?.error(
				ex,
				`Failed to ${autoInstall ? 'auto-install' : 'install'} CLI: ${ex instanceof Error ? ex.message : 'Unknown error during installation'}`,
			);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('cli/install/failed', {
					autoInstall: autoInstall ?? false,
					attempts: cliInstallAttempts,
					'error.message': ex instanceof Error ? ex.message : 'Unknown error',
					source: source,
					insiders: insidersEnabled,
				});
			}

			if (CLIInstallError.is(ex, CLIInstallErrorReason.UnsupportedPlatform)) {
				cliInstallStatus = 'unsupported';
			} else if (!autoInstall) {
				throw ex;
			}
		}

		return { cliVersion: cliVersion, cliPath: cliPath, status: cliInstallStatus };
	}

	/** Update the CLI core to the latest version. */
	@debug()
	async updateCore(
		source?: Source,
	): Promise<{ previous: string | undefined; current: string | undefined } | undefined> {
		const scope = getScopedLogger();
		source ??= { source: 'gk-cli-integration' };

		let previousVersion:
			| {
					proxy: string;
					core: string;
			  }
			| undefined = undefined;
		try {
			previousVersion = await getCLIVersions();
			await runCLICommand(['update']);
			const currentVersion = await getCLIVersions();
			this._cliCoreVersion = currentVersion?.core;

			scope?.debug(`CLI core update (previous: ${previousVersion?.core}, current: ${currentVersion?.core})`);
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent(
					'cli/updateCore/completed',
					{
						previous: previousVersion?.core,
						current: currentVersion?.core,
					},
					source,
				);
			}

			return {
				previous: previousVersion?.core,
				current: currentVersion?.core,
			};
		} catch (ex) {
			scope?.error(ex, 'Failed to update CLI');
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent(
					'cli/updateCore/failed',
					{
						previous: previousVersion?.core,
						'error.message': ex instanceof Error ? ex.message : 'Unknown error',
					},
					source,
				);
			}
		}

		return undefined;
	}

	/** Check if the CLI needs an update (core or proxy). */
	@debug()
	async checkUpdateRequired(): Promise<{
		needsUpdate: 'core' | 'proxy' | undefined;
		core: string | undefined;
		proxy: string | undefined;
	}> {
		const scope = getScopedLogger();

		try {
			const currentVersions = await getCLIVersions();
			if (currentVersions == null) {
				this._cliCoreVersion = undefined;
				return {
					needsUpdate: 'proxy',
					core: undefined,
					proxy: undefined,
				};
			}

			const { core: currentCoreVersion, proxy: currentProxyVersion } = currentVersions;
			this._cliCoreVersion = currentCoreVersion;

			const { core: minimumCoreVersion, proxy: minimumProxyVersion } =
				await this.container.productConfig.getCliMinimumVersions();

			if (satisfies(fromString(currentProxyVersion), `< ${minimumProxyVersion}`)) {
				return {
					needsUpdate: 'proxy',
					core: currentCoreVersion,
					proxy: currentProxyVersion,
				};
			}

			if (satisfies(fromString(currentCoreVersion), `< ${minimumCoreVersion}`)) {
				return {
					needsUpdate: 'core',
					core: currentCoreVersion,
					proxy: currentProxyVersion,
				};
			}

			return {
				needsUpdate: undefined,
				core: currentCoreVersion,
				proxy: currentProxyVersion,
			};
		} catch (ex) {
			scope?.error(ex, 'Failed to get CLI version');
			this._cliCoreVersion = undefined;
		}

		return {
			needsUpdate: 'proxy',
			core: undefined,
			proxy: undefined,
		};
	}

	/** Authenticate the CLI with the current session token. Called after a successful install and on subscription change. */
	@trace()
	async authCLI(): Promise<void> {
		const scope = getScopedLogger();

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		if (cliInstall?.status !== 'completed') return;

		const currentSessionToken = (await this.container.subscription.getAuthenticationSession())?.accessToken;
		if (currentSessionToken == null) return;

		try {
			await runCLICommand(['auth', 'login', '-t', currentSessionToken]);
		} catch (ex) {
			debugger;
			scope?.error(ex, 'Failed to authenticate CLI');
		}
	}
}

function reachedMaxAttempts(cliInstall?: StoredGkCLIInstallInfo): boolean {
	return cliInstall?.status === 'attempted' && (cliInstall.attempts ?? 0) >= maxAutoInstallAttempts;
}
