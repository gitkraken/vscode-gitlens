import type { Disposable, Event } from 'vscode';
import { env, EventEmitter, l10n, ProgressLocation, window } from 'vscode';
import {
	findKeplerLaunchServicesInstallLocation,
	findKeplerRegistryInstallLocation,
	getKeplerRelease,
	getKeplerReleaseTargetForHost,
	installKepler,
	isKeplerInstalled,
} from '@env/kepler/keplerInstall.js';
import { isWeb } from '@env/platform.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { Logger } from '@gitlens/utils/logger.js';
import { urls } from '../../constants.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { toAbortSignal } from '../../system/-webview/cancellation.js';
import { configuration } from '../../system/-webview/configuration.js';
import { setContext } from '../../system/-webview/context.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import type { KeplerInstallFailureReason, KeplerInstallProgress, KeplerRelease } from './keplerRelease.js';
import { KeplerInstallError, toMegabytes } from './keplerRelease.js';

/**
 * The Kepler build a user has pointed GitLens at. There is no API to discover which channel of
 * Kepler is installed, so this is a setting rather than a probe (design doc §8).
 */
export type KeplerChannel = 'production' | 'staging' | 'dev' | 'source';

export class KeplerService implements Disposable {
	/**
	 * Whether Kepler can exist in this environment at all. `false` only on the web (vscode.dev,
	 * github.dev, and other browser-hosted clients) — the one environment with no way to launch a
	 * desktop app. Desktop VS Code is available whether local or remote (SSH/WSL/Dev Containers):
	 * the Kepler *process* always runs on the user's own machine, deep-linked to from there.
	 */
	readonly available: boolean;

	/**
	 * Whether the configured channel's Kepler is installed on disk — `undefined` when we cannot
	 * tell. Probed EAGERLY at construction, and again on every read while `false` so a Kepler
	 * installed by hand meanwhile is picked up: the users the detection exists for — those who
	 * already have Kepler and keep being pitched it — are exactly the ones who never invoke a
	 * Kepler command, so a lazy probe would never run for them. It is a couple of `existsSync`
	 * calls.
	 *
	 * `undefined` on a remote extension host: the probe would check the remote filesystem, not the
	 * machine Kepler (and its desktop deep link) actually runs on, so the probe is skipped
	 * entirely rather than answering a question about the wrong machine.
	 *
	 * Assumed `true` under `source-debug`: a Kepler run from a debugger (`pnpm dev`) has no app
	 * bundle to find — it claims its scheme by patching the shared dev `Electron.app` instead.
	 */
	get installed(): boolean | undefined {
		if (this._installed === false && !this.installing && this.probe(this.channel)) {
			this.markInstalled();
		}
		return this._installed;
	}
	private _installed: boolean | undefined;

	private readonly _onDidChange = new EventEmitter<void>();
	/** Fires when {@link installed} or {@link installing} changes */
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	/** Whether GitLens is installing Kepler right now */
	get installing(): boolean {
		return this._installPromise != null;
	}
	private _installPromise: Promise<boolean> | undefined;
	private _releasePromise: Promise<KeplerRelease | undefined> | undefined;
	private readonly remote: boolean;

	/**
	 * `probe`, `remote` and `locate` are seams for tests; production always uses the env-abstracted
	 * filesystem probe, `vscode.env.remoteName` and the registry or Launch Services lookup.
	 */
	constructor(
		private readonly container: Container,
		private readonly probe: (channel: KeplerChannel) => boolean = isKeplerInstalled,
		remote: boolean = env.remoteName != null,
		locate: (channel: KeplerChannel) => Promise<string | undefined> = locateKepler,
	) {
		this.available = !isWeb;
		const debugging = this.debugging;
		this._installed = debugging ? true : remote ? undefined : probe(this.channel);
		this.remote = remote;
		void setContext('gitlens:kepler:installed', this._installed === true);

		// Track once, never clear (design doc §11.6): an uninstall leaves the walkthrough step
		// complete. Guarded so a detected install is not re-tracked (and re-sent as `usage/track`)
		// on every activation. Only a DETECTED install counts — not an assumed one (`source-debug`),
		// and not `undefined` (can't tell).
		if (
			this._installed === true &&
			!debugging &&
			!container.usage.isUsed('action:gitlens.kepler.installed:happened')
		) {
			void container.usage.track('action:gitlens.kepler.installed:happened');
		}

		// The path probe can miss a Kepler in a custom folder; Windows' registry and macOS' Launch
		// Services, read asynchronously, catch it — and keep Install Kepler from installing a second
		// copy (on Windows, from running a silent setup that would close a Kepler already running)
		if (this._installed === false) {
			void locate(this.channel).then(location => {
				if (location != null && this._installed === false) {
					this.markInstalled();
				}
			});
		}
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	/**
	 * Whether GitLens can install Kepler itself here: a local desktop window, the production channel,
	 * and a platform and CPU Kepler ships an installer for. Elsewhere, Install Kepler opens the
	 * download page instead (remote windows — Kepler must be installed on the local machine).
	 */
	get canInstall(): boolean {
		return (
			this.available &&
			!this.remote &&
			!this.debugging &&
			this.channel === 'production' &&
			getKeplerReleaseTargetForHost() != null
		);
	}

	/**
	 * The release Install Kepler would install, for showing its version and size before the install
	 * starts. `undefined` when it can't be installed here or the release can't be read. A successful
	 * lookup is kept for the session; a failed one is retried on the next call.
	 */
	getRelease(): Promise<KeplerRelease | undefined> {
		const target = this.canInstall ? getKeplerReleaseTargetForHost() : undefined;
		if (target == null) return Promise.resolve(undefined);

		this._releasePromise ??= getKeplerRelease(target).catch((ex: unknown) => {
			Logger.warn('Unable to resolve the Kepler release', ex);
			this._releasePromise = undefined;
			return undefined;
		});
		return this._releasePromise;
	}

	/**
	 * Installs Kepler, with a cancellable progress notification, then reports the outcome. Where
	 * GitLens can't install it itself ({@link canInstall}), opens the download page instead. A second
	 * call while an install runs joins it. Resolves `true` when Kepler is installed, already or by this call,
	 * and `false` when the user cancelled — even if the cancel came too late to stop the install itself.
	 */
	install(source?: Source): Promise<boolean> {
		if (!this.available) return Promise.resolve(false);
		if (this.installed === true) {
			// The installed context key can lag an install made by hand, leaving Install Kepler on
			// offer; say so rather than appear to do nothing
			void this.showInstalled(undefined);
			return Promise.resolve(true);
		}

		if (!this.canInstall) {
			void openUrl(urls.keplerDownload);
			return Promise.resolve(false);
		}

		if (this._installPromise != null) return this._installPromise;

		this._installPromise = this.installCore(source).finally(() => {
			this._installPromise = undefined;
			void setContext('gitlens:kepler:installing', false);
			this._onDidChange.fire();
		});
		void setContext('gitlens:kepler:installing', true);
		this._onDidChange.fire();
		return this._installPromise;
	}

	private async installCore(source: Source | undefined): Promise<boolean> {
		const data = { kind: getKeplerReleaseTargetForHost()!.kind };
		this.container.telemetry.sendEvent('kepler/install/started', data, source);

		let release: KeplerRelease | undefined;
		let cancelledLate = false;
		try {
			release = await window.withProgress(
				{ location: ProgressLocation.Notification, cancellable: true },
				async (progress, token) => {
					progress.report({ message: l10n.t('Checking for the latest Kepler version…') });
					// The release shown in the prompt may be from hours ago; Kepler republishes under the same file name
					this._releasePromise = undefined;
					const resolved = await this.getRelease();
					if (resolved == null) {
						throw new KeplerInstallError('manifest', 'Unable to resolve the Kepler release');
					}

					release = resolved;
					await installKepler(resolved, {
						signal: toAbortSignal(token),
						onProgress: createProgressReporter(resolved, progress),
					});
					// Once the install step starts it can't be stopped (killing the Windows setup would
					// leave a half-installed Kepler), so a Cancel clicked during it only lands here
					cancelledLate = token.isCancellationRequested;
					return resolved;
				},
			);
		} catch (ex) {
			const reason: KeplerInstallFailureReason = ex instanceof KeplerInstallError ? ex.reason : 'install';
			this.container.telemetry.sendEvent(
				'kepler/install/failed',
				{ ...data, version: release?.version, 'failure.reason': reason },
				source,
			);
			if (reason === 'cancelled') return false;

			Logger.error(ex, 'KeplerService.install');
			// What actually failed (a command's error output, a network error), for Open Output Channel
			if (ex instanceof KeplerInstallError && ex.cause != null) {
				Logger.error(ex.cause, 'KeplerService.install: caused by');
			}
			void this.showInstallFailed(reason);
			return false;
		}

		this.markInstalled();
		this.container.telemetry.sendEvent('kepler/install/completed', { ...data, version: release.version }, source);
		// Kepler is installed either way, but the user no longer wants what the install was for
		if (cancelledLate) return false;

		void this.showInstalled(release.version);
		return true;
	}

	/** Records a successful install: updates {@link installed}, the context key and the walkthrough step. */
	private markInstalled(): void {
		this._installed = true;
		void setContext('gitlens:kepler:installed', true);
		if (!this.container.usage.isUsed('action:gitlens.kepler.installed:happened')) {
			void this.container.usage.track('action:gitlens.kepler.installed:happened');
		}
		this._onDidChange.fire();
	}

	private async showInstalled(version: string | undefined): Promise<void> {
		const open = { title: l10n.t('Open Kepler') };
		const result = await window.showInformationMessage(
			version != null ? l10n.t('Kepler {0} is installed.', version) : l10n.t('Kepler is installed.'),
			open,
		);
		if (result === open) {
			void openUrl(this.scheme);
		}
	}

	private async showInstallFailed(reason: KeplerInstallFailureReason): Promise<void> {
		const download = { title: l10n.t('Download Kepler') };
		const output = { title: l10n.t('Open Output Channel') };
		const result = await window.showErrorMessage(getInstallFailureMessage(reason), download, output);
		if (result === download) {
			void openUrl(urls.keplerDownload);
		} else if (result === output) {
			Logger.showOutputChannel();
		}
	}

	/**
	 * Mirrors `Container.env` (`src/container.ts:603-609`): undeclared (no `contributes.configuration`
	 * entry, read via `configuration.getAny`, absent from `src/config.ts` and the Settings UI),
	 * gated on `prereleaseOrDebugging` (`src/container.ts:720`), and whitelisted rather than passed
	 * through — an unrecognised value degrades to `'production'`.
	 *
	 * Undeclared follows from the gate: a setting visible in the Settings UI that silently does
	 * nothing on a stable release is worse than no setting at all (design doc §8.3).
	 */
	get channel(): KeplerChannel {
		const setting = this.setting;
		return setting === 'source-debug' ? 'source' : setting;
	}

	/**
	 * `source-debug` — Kepler running from source under a debugger (`pnpm dev`). Targets the
	 * `source` channel, but skips the install check, since there is no installed app to find.
	 */
	get debugging(): boolean {
		return this.setting === 'source-debug';
	}

	@memoize()
	private get setting(): KeplerChannel | 'source-debug' {
		if (this.container.prereleaseOrDebugging) {
			const channel = configuration.getAny('gitkraken.kepler.channel');
			if (channel === 'staging' || channel === 'dev' || channel === 'source' || channel === 'source-debug') {
				return channel;
			}
		}

		return 'production';
	}

	/**
	 * `production` keeps the bare scheme; every other channel takes the `kepler-<channel>://` slug
	 * suffix. This independently matches Kepler's own scheme derivation
	 * (`_channel-identity.mjs:62-80` in the Kepler repo).
	 */
	get scheme(): string {
		const channel = this.channel;
		if (channel === 'production') return 'kepler://';

		return `kepler-${channel}://`;
	}
}

/** Where Windows' registry or macOS' Launch Services says Kepler is — each answers only on its own platform */
async function locateKepler(channel: KeplerChannel): Promise<string | undefined> {
	return (await findKeplerRegistryInstallLocation(channel)) ?? findKeplerLaunchServicesInstallLocation(channel);
}

function getInstallFailureMessage(reason: KeplerInstallFailureReason): string {
	switch (reason) {
		case 'manifest':
			return l10n.t('Unable to install Kepler: the latest version could not be found.');
		case 'download':
			return l10n.t('Unable to install Kepler: the download was interrupted.');
		case 'verify':
			return l10n.t('Unable to install Kepler: the download could not be verified.');
		case 'register':
			return l10n.t('Unable to install Kepler: kepler:// links could not be registered.');
		case 'unsupported':
			return l10n.t('Unable to install Kepler: this platform is not supported.');
		default:
			return l10n.t('Unable to install Kepler: the installer failed.');
	}
}

/** Turns install steps into notification messages, with the download filling most of the progress bar. */
function createProgressReporter(
	release: KeplerRelease,
	progress: { report(value: { message?: string; increment?: number }): void },
): (value: KeplerInstallProgress) => void {
	// The download dominates the wait; the later steps are near-instant on macOS and Linux
	const downloadShare = 90;
	let reported = 0;
	let lastMessage: string | undefined;
	return value => {
		switch (value.step) {
			case 'download': {
				const { total } = value;
				const transferred = toMegabytes(value.transferred ?? 0);
				let message: string;
				if (total != null) {
					message =
						release.version != null
							? l10n.t(
									'Downloading Kepler {0}… {1} / {2} MB',
									release.version,
									transferred,
									toMegabytes(total),
								)
							: l10n.t('Downloading Kepler… {0} / {1} MB', transferred, toMegabytes(total));
				} else {
					message =
						release.version != null
							? l10n.t('Downloading Kepler {0}… {1} MB', release.version, transferred)
							: l10n.t('Downloading Kepler… {0} MB', transferred);
				}

				const target =
					total != null ? Math.floor(((value.transferred ?? 0) / total) * downloadShare) : reported;
				// Chunks arrive thousands of times per download; report only what the notification shows
				if (message === lastMessage && target === reported) break;

				progress.report({ message: message, increment: target - reported });
				lastMessage = message;
				reported = target;
				break;
			}
			case 'verify':
				progress.report({
					message: l10n.t('Verifying the Kepler download…'),
					increment: downloadShare - reported,
				});
				reported = downloadShare;
				break;
			case 'install':
				progress.report({ message: l10n.t('Installing Kepler…') });
				break;
			case 'register':
				progress.report({ message: l10n.t('Registering kepler:// links…') });
				break;
		}
	};
}
