import type { Disposable } from 'vscode';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import type { Container } from '../../container.js';
import { configuration } from '../../system/-webview/configuration.js';

/**
 * The Kepler build a user has pointed GitLens at. There is no API to discover which channel of
 * Kepler is installed, so this is a setting rather than a probe (design doc §8).
 */
export type KeplerChannel = 'production' | 'staging' | 'dev' | 'source';

export class KeplerService implements Disposable {
	constructor(private readonly container: Container) {}

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
	@memoize()
	get channel(): KeplerChannel {
		if (this.container.prereleaseOrDebugging) {
			const channel = configuration.getAny('gitkraken.kepler.channel');
			if (channel === 'staging' || channel === 'dev' || channel === 'source') return channel;
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
