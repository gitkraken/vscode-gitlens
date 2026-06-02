import { dirname } from 'path';
import { arch } from 'process';
import type { Disposable } from 'vscode';
import { Uri, workspace } from 'vscode';
import { debug } from '@gitlens/utils/decorators/log.js';
import { sequentialize } from '@gitlens/utils/decorators/sequentialize.js';
import { Logger } from '@gitlens/utils/logger.js';
import { formatLoggableScopeBlock, getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { fromString, satisfies } from '@gitlens/utils/version.js';
import type { StoredGkCLIInstallInfo } from '../../../../constants.storage.js';
import type { Source, Sources } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import { setContext } from '../../../../system/-webview/context.js';
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

/** Total-duration cap for fetching the tiny proxy metadata JSON. Safe as a hard cap because the payload is
 * small — 60s only catches a connection that accepts then never responds. */
const proxyMetadataFetchTimeout = 60_000; // 60s
/** Max time with no download progress before the binary download is treated as stalled. A no-progress
 * timeout (rather than a total-duration cap) won't abort a slow-but-steady multi-MB download but still
 * fails fast when a connection accepts then goes silent. */
const proxyDownloadStallTimeout = 60_000; // 60s

export class CliBinaryInstaller implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly authenticate: () => Promise<void>,
	) {}

	dispose(): void {
		// No-op today; installed state is in storage scope, not in-memory.
	}

	/** Install the CLI. Serialized so installs never overlap — two `gk install` subprocesses writing the
	 * same globalStorage directory at once risks corruption and the Windows running-binary lock
	 * (`ProxyExtractLocked`).
	 *
	 * Uses `@sequentialize()`, not `@gate()`: `@gate()` would hand the in-flight promise to all callers
	 * regardless of args, so a force reinstall (e.g. insiders toggle, `gitlens.ai.mcp.reinstall`) arriving
	 * during a background auto-install would dedupe onto it and silently skip the force. Sequentializing
	 * queues the force behind the in-flight install and runs it on its own instead.
	 *
	 * `changed` is `true` only when a fresh install actually ran; `false` for every short-circuit/no-op
	 * path (already installed, local dev binary, unsupported/offline). Callers that fire reactive events
	 * on completion should gate on it to avoid feedback loops back into `install`.
	 */
	@sequentialize()
	@debug({ exit: true })
	async install(
		autoInstall?: boolean,
		source?: Sources,
		force = false,
	): Promise<{
		cliVersion?: string;
		cliPath?: string;
		status: 'completed' | 'unsupported' | 'attempted';
		changed: boolean;
	}> {
		const scope = getScopedLogger();
		clearResolvedCLIExecutableCache();

		const devLocalPath = getDevCLILocalPath();
		if (devLocalPath != null) {
			const resolved = await resolveCLIExecutable();
			if (resolved != null) {
				scope?.info(`Using local CLI binary: ${resolved.fsPath}`);
				const versions = await getCLIVersions();
				return {
					cliVersion: versions?.core,
					cliPath: dirname(resolved.fsPath),
					status: 'completed',
					changed: false,
				};
			}

			scope?.warn(`Local CLI binary not found at: ${devLocalPath}`);
			return { cliVersion: undefined, cliPath: undefined, status: 'attempted', changed: false };
		}

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		let cliInstallAttempts = force ? 0 : (cliInstall?.attempts ?? 0);
		let cliInstallStatus = cliInstall?.status ?? 'attempted';
		let cliVersion = cliInstall?.version;
		const cliPath = this.container.context.globalStorageUri.fsPath;
		const platform = getPlatform();

		if (!force) {
			if (cliInstallStatus === 'completed') {
				if (await resolveCLIExecutable(cliPath)) {
					return { cliVersion: cliVersion, cliPath: cliPath, status: 'completed', changed: false };
				}

				scope?.warn(`CLI binary not found at expected path: ${getCLIExecutable(cliPath).fsPath}`);

				cliInstallStatus = 'attempted';
				cliVersion = undefined;
			} else if (cliInstallStatus === 'unsupported') {
				return { cliVersion: undefined, cliPath: undefined, status: 'unsupported', changed: false };
			} else if (autoInstall && reachedMaxAttempts({ status: cliInstallStatus, attempts: cliInstallAttempts })) {
				scope?.warn(`Skipping auto-install, reached max attempts (${cliInstallAttempts})`);
				return { cliVersion: undefined, cliPath: undefined, status: 'attempted', changed: false };
			}
		}

		const insidersEnabled = isInsidersCLIEnabled();

		let changed = false;

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

			// Unrecognized architectures fall back to x86 (unrecognized platforms throw below)
			const architecture = arch === 'x64' || arch === 'arm64' ? arch : 'x86';
			let platformName: string;

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
				const response = await fetchProxyMetadata(proxyUrl, proxyMetadataFetchTimeout);
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
				const cliProxyZipFileDownloadData = await downloadProxyArchive(downloadUrl, proxyDownloadStallTimeout);
				if (cliProxyZipFileDownloadData.byteLength === 0) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyDownload,
						undefined,
						'Downloaded proxy archive data is empty',
					);
				}

				const cliProxyZipFileName = downloadUrl.substring(downloadUrl.lastIndexOf('/') + 1);
				cliProxyZipFilePath = Uri.joinPath(globalStorageUri, cliProxyZipFileName);

				try {
					await workspace.fs.createDirectory(globalStorageUri);
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.GlobalStorageDirectory,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : undefined,
					);
				}

				try {
					await workspace.fs.writeFile(cliProxyZipFilePath, cliProxyZipFileDownloadData);
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.ProxyDownload,
						ex instanceof Error ? ex : undefined,
						'Failed to write proxy archive to global storage',
					);
				}

				try {
					const expectedBinary = platform === 'windows' ? 'gk.exe' : 'gk';
					await extractZipFile(cliProxyZipFilePath.fsPath, globalStorageUri.fsPath, {
						filter: filename => filename === expectedBinary || filename.endsWith(`/${expectedBinary}`),
					});

					// Verify the extracted binary exists (stat throws if it doesn't)
					cliExtractedProxyFilePath = Uri.joinPath(globalStorageUri, expectedBinary);
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
					changed = true;
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

					await this.authenticate();
				} catch (ex) {
					throw new CLIInstallError(
						CLIInstallErrorReason.CoreInstall,
						ex instanceof Error ? ex : undefined,
						ex instanceof Error ? ex.message : '',
					);
				}
			} finally {
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

		return { cliVersion: cliVersion, cliPath: cliPath, status: cliInstallStatus, changed: changed };
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

			// Update the install scope's version so consumers (e.g. GkMcpService's mcp-config cache) notice
			// the core swap. Without this the cached config keeps the old version and VS Code keeps running
			// the stale MCP stdio process until reload.
			if (currentVersion?.core != null && currentVersion.core !== previousVersion?.core) {
				const cliInstall = this.container.storage.getScoped('gk:cli:install');
				if (cliInstall != null) {
					void this.container.storage
						.storeScoped('gk:cli:install', { ...cliInstall, version: currentVersion.core })
						.catch();
				}
			}

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
				return {
					needsUpdate: 'proxy',
					core: undefined,
					proxy: undefined,
				};
			}

			const { core: currentCoreVersion, proxy: currentProxyVersion } = currentVersions;

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
		}

		return {
			needsUpdate: 'proxy',
			core: undefined,
			proxy: undefined,
		};
	}

	/**
	 * Ensures the CLI is installed and up-to-date. Called on extension activation (after a 3s defer).
	 *
	 * - If the dev local CLI path is set, skips install/update entirely.
	 * - If the CLI is installed but the binary is missing, forces a reinstall.
	 * - If the CLI is installed and outdated, forces a reinstall.
	 * - If the CLI is installed and up-to-date but the extension version has changed, runs an update check.
	 *
	 * Returns the install result if a fresh install ran, the up-to-date version if a version check passed,
	 * or `undefined` if there was nothing to do.
	 */
	@debug()
	async ensureUpdateOrInstall(): Promise<
		| {
				cliVersion?: string;
				cliPath?: string;
				status: 'completed' | 'unsupported' | 'attempted';
				changed: boolean;
		  }
		| undefined
	> {
		if (getDevCLILocalPath() != null) {
			Logger.info(`${formatLoggableScopeBlock('CLI')} Using local CLI binary — skipping auto-install/update`);
			void setContext('gitlens:gk:cli:installed', true);
			return undefined;
		}

		let forceInstall = false;
		const versionDidChange = this.container.version !== this.container.previousVersion;

		const cliInstall = this.container.storage.getScoped('gk:cli:install');
		if (cliInstall?.status === 'completed') {
			// Verify the binary exists before spawning `gk version`.
			if (!(await resolveCLIExecutable())) {
				Logger.warn(`${formatLoggableScopeBlock('CLI')} CLI binary missing at startup — forcing reinstall`);
				forceInstall = true;
			} else {
				const { needsUpdate, core, proxy } = await this.checkUpdateRequired();
				let currentCoreVersion = core;
				if (needsUpdate !== undefined) {
					Logger.info(
						`${formatLoggableScopeBlock('CLI')} CLI ${needsUpdate} version ${(needsUpdate === 'core' ? currentCoreVersion : proxy) ?? 'unknown'} is outdated, forcing reinstall`,
					);
					forceInstall = true;
				} else {
					// Already at/above minimums: only run `gk update` when the extension version changed
					// since last run, to pick up a newer core without spawning a subprocess every activation.
					if (versionDidChange) {
						const updateResult = await this.updateCore();
						if (updateResult?.current != null) {
							currentCoreVersion = updateResult.current;
						}
					}

					if (currentCoreVersion != null) {
						Logger.info(`${formatLoggableScopeBlock('CLI')} CLI core version is ${currentCoreVersion}`);
						void setContext('gitlens:gk:cli:installed', true);
						return {
							cliVersion: currentCoreVersion,
							cliPath: this.container.context.globalStorageUri.fsPath,
							status: 'completed',
							// No install ran (binary present, version current). Caller must not fire change events.
							changed: false,
						};
					}
				}
			}
		}

		let didReachMaxAttempts = reachedMaxAttempts(cliInstall);

		// A new extension version clears the stored attempt count, so an install that previously hit max
		// attempts is retried after an upgrade.
		if (forceInstall || (didReachMaxAttempts && versionDidChange)) {
			void this.container.storage.storeScoped('gk:cli:install', undefined);
			didReachMaxAttempts = false;
		}

		if (!forceInstall && didReachMaxAttempts) {
			return undefined;
		}

		// CLI auto-installs whenever AI is enabled, independent of MCP support
		// (see commit bd67ef89 / issue #5280). MCP service reacts to onDidChangeInstall.
		if (this.container.ai.enabled) {
			return this.install(true, 'gk-cli-integration', forceInstall).catch(() => undefined);
		}

		return undefined;
	}
}

function reachedMaxAttempts(cliInstall?: StoredGkCLIInstallInfo): boolean {
	return cliInstall?.status === 'attempted' && (cliInstall.attempts ?? 0) >= maxAutoInstallAttempts;
}

/** `true` for the `AbortError`/`TimeoutError` thrown when a fetch is aborted by our timeout signal. */
function isAbortOrTimeoutError(ex: unknown): boolean {
	return ex instanceof Error && (ex.name === 'TimeoutError' || ex.name === 'AbortError');
}

/** Fetches the proxy metadata JSON with a total-duration timeout, surfacing a stall as a `CLIInstallError`
 * (so it gets standard install-failure telemetry) instead of hanging until the OS socket timeout. */
async function fetchProxyMetadata(url: string, timeoutMs: number): Promise<Response> {
	try {
		return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	} catch (ex) {
		if (isAbortOrTimeoutError(ex)) {
			throw new CLIInstallError(
				CLIInstallErrorReason.ProxyUrlFetch,
				ex instanceof Error ? ex : undefined,
				`timed out after ${timeoutMs}ms`,
			);
		}
		throw ex;
	}
}

/** Downloads the proxy archive, aborting if no bytes arrive for `stallTimeoutMs` (rationale on
 * `proxyDownloadStallTimeout`). Surfaces both HTTP failures and timeouts as `CLIInstallError`s. */
async function downloadProxyArchive(url: string, stallTimeoutMs: number): Promise<Uint8Array> {
	const controller = new AbortController();
	let timedOut = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const armStallTimer = () => {
		if (timer != null) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, stallTimeoutMs);
	};

	try {
		armStallTimer();
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) {
			throw new CLIInstallError(
				CLIInstallErrorReason.ProxyFetch,
				undefined,
				`${response.status} ${response.statusText}`,
			);
		}

		// Stream the body so the stall timer can be reset on each chunk; fall back to a single buffered
		// read (still covered by the stall timer) if the body isn't an inspectable stream.
		const reader = response.body?.getReader();
		if (reader == null) {
			return new Uint8Array(await response.arrayBuffer());
		}

		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			armStallTimer();
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = value as Uint8Array | undefined;
			if (chunk != null) {
				chunks.push(chunk);
				size += chunk.byteLength;
			}
		}

		const data = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			data.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return data;
	} catch (ex) {
		if (timedOut || isAbortOrTimeoutError(ex)) {
			throw new CLIInstallError(
				CLIInstallErrorReason.ProxyFetch,
				ex instanceof Error ? ex : undefined,
				`download stalled (no progress for ${stallTimeoutMs}ms)`,
			);
		}
		throw ex;
	} finally {
		if (timer != null) {
			clearTimeout(timer);
		}
	}
}
