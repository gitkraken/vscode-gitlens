import type { Disposable } from 'vscode';
import { env } from 'vscode';
import { isKeplerInstalled } from '@env/kepler/keplerInstall.js';
import { isWeb } from '@env/platform.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import type { Container } from '../../container.js';
import { configuration } from '../../system/-webview/configuration.js';

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
	 * tell. Probed once, EAGERLY, at construction: the users the detection exists for — those who
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
	readonly installed: boolean | undefined;

	/**
	 * `probe` and `remote` are seams for tests; production always uses the env-abstracted
	 * filesystem probe and `vscode.env.remoteName`.
	 */
	constructor(
		private readonly container: Container,
		probe: (channel: KeplerChannel) => boolean = isKeplerInstalled,
		remote: boolean = env.remoteName != null,
	) {
		this.available = !isWeb;
		const debugging = this.debugging;
		this.installed = debugging ? true : remote ? undefined : probe(this.channel);

		// Track once, never clear (design doc §11.6): an uninstall leaves the walkthrough step
		// complete. Guarded so a detected install is not re-tracked (and re-sent as `usage/track`)
		// on every activation. Only a DETECTED install counts — not an assumed one (`source-debug`),
		// and not `undefined` (can't tell).
		if (
			this.installed === true &&
			!debugging &&
			!container.usage.isUsed('action:gitlens.kepler.installed:happened')
		) {
			void container.usage.track('action:gitlens.kepler.installed:happened');
		}
	}

	dispose(): void {}

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
