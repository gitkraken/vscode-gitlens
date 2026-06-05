import type { Disposable } from 'vscode';
import { authentication, commands, env, ProgressLocation, Uri, window } from 'vscode';
import {
	CloudIntegrationAuthenticationUriPathPrefix,
	toCloudIntegrationType,
} from '@gitlens/integrations/authentication/models.js';
import type { IntegrationIds } from '@gitlens/integrations/constants.js';
import type { AccountProvider, AuthenticationSessionsChangeEvent } from '@gitlens/integrations/context.js';
import type { Source } from '@gitlens/integrations/telemetry.js';
import { detailToContext, sourceToContext } from '@gitlens/integrations/telemetry.js';
import { Emitter, promisifyDeferred } from '@gitlens/utils/event.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Source as TelemetrySource } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import { openUrl } from '../../../system/-webview/vscode/uris.js';
import type { ServerConnection } from '../../gk/serverConnection.js';
import { isSubscriptionTrialOrPaidFromState } from '../../gk/utils/subscription.utils.js';

/**
 * The host-side `account` adapter: the GitKraken account + the GK-Dev connect/manage OAuth round-trips.
 * These flows were relocated here from the package so the package stays out of the GK-cloud UI/URL shape
 * and only orchestrates (state, sync, hooks) around {@link AccountProvider.connect}/`openManagement`.
 */
export function createAccountAdapter(
	container: Container,
	connection: ServerConnection,
	disposables: Disposable[],
): AccountProvider {
	const onDidChange = new Emitter<void>();
	const onDidCheckIn = new Emitter<{ force?: boolean }>();
	const onDidChangeSessions = new Emitter<AuthenticationSessionsChangeEvent>();
	disposables.push(
		onDidChange,
		onDidCheckIn,
		onDidChangeSessions,
		container.subscription.onDidChange(() => onDidChange.fire()),
		container.subscription.onDidCheckIn(e => onDidCheckIn.fire({ force: e?.force })),
		authentication.onDidChangeSessions(e => onDidChangeSessions.fire({ provider: { id: e.provider.id } })),
	);

	return {
		getAccount: async options => {
			let sub = await container.subscription.getSubscription();
			if (sub.account == null && options?.createIfNeeded) {
				if (
					!(await container.subscription.loginOrSignUp(true, options.source as TelemetrySource | undefined))
				) {
					return undefined;
				}

				sub = await container.subscription.getSubscription();
			}
			return sub.account == null
				? undefined
				: { id: sub.account.id, name: sub.account.name, email: sub.account.email };
		},
		onDidChange: onDidChange.event,
		onDidCheckIn: onDidCheckIn.event,
		onDidChangeSessions: onDidChangeSessions.event,
		isTrialOrPaid: async () =>
			isSubscriptionTrialOrPaidFromState((await container.subscription.getSubscription()).state),
		fetchGkApi: (path, init) => connection.fetchGkApi(path, init, { organizationId: false }),
		connect: opts => connectViaGkDev(container, opts),
		openManagement: source => openManagementViaGkDev(container, source),
	};
}

async function connectViaGkDev(
	container: Container,
	opts: { integrationIds?: IntegrationIds[]; source?: Source },
): Promise<boolean> {
	const { integrationIds, source } = opts;
	const account = (await container.subscription.getSubscription()).account;
	if (account != null) {
		// Re-authenticate the GK CLI MCP so it can use the (about-to-be-)connected integrations.
		void commands.executeCommand('gitlens.ai.mcp.authCLI');
	}

	let query = 'source=gitlens';
	if (source?.source != null && sourceToContext[source.source] != null) {
		query += `&context=${sourceToContext[source.source]}`;
	} else if (source?.detail != null && typeof source.detail === 'string' && detailToContext[source.detail] != null) {
		query += `&context=${detailToContext[source.detail]}`;
	}
	if (integrationIds != null) {
		const types: string[] = [];
		for (const id of integrationIds) {
			const type = toCloudIntegrationType[id];
			if (type == null) {
				Logger.error(undefined, `Attempting to connect unsupported cloud integration type: ${id}`);
			} else {
				types.push(type);
			}
		}
		if (types.length > 0) {
			query += `&provider=${types.join(',')}`;
		}
		if (types.length > 1) {
			query += '&flow=expanded';
		}
	}

	const baseQuery = query;
	try {
		if (account != null) {
			const token = await container.accountAuthentication.getExchangeToken(
				CloudIntegrationAuthenticationUriPathPrefix,
			);
			query += `&token=${token}`;
		} else {
			const callbackUri = (
				await env.asExternalUri(
					Uri.parse(
						`${env.uriScheme}://${container.context.extension.id}/${CloudIntegrationAuthenticationUriPathPrefix}`,
					),
				)
			).toString(true);
			query += `&redirect_uri=${encodeURIComponent(callbackUri)}`;
		}
		if (!(await openUrl(await container.urls.getGkDevUrl('connect', query)))) return false;
	} catch (ex) {
		Logger.error(ex);
		if (!(await openUrl(await container.urls.getGkDevUrl('connect', baseQuery)))) return false;
	}

	const deferred = promisifyDeferred<Uri, string | undefined>(
		container.uri.onDidReceiveCloudIntegrationAuthenticationUri,
		(uri, resolve) => resolve(new URLSearchParams(uri.query).get('code') ?? undefined),
	);
	let code: string | undefined;
	try {
		code = await window.withProgress(
			{ location: ProgressLocation.Notification, title: 'Connecting integrations...', cancellable: true },
			(_progress, token) => {
				const controller = new AbortController();
				token.onCancellationRequested(() => controller.abort());
				return Promise.race([
					deferred.promise,
					new Promise<string | undefined>((_, reject) => {
						// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
						controller.signal.addEventListener('abort', () => reject('Cancelled'), { once: true });
					}),
					new Promise<string | undefined>((_, reject) => setTimeout(reject, 5 * 60 * 1000, 'Cancelled')),
				]);
			},
		);
	} catch {
		return false;
	} finally {
		deferred.cancel();
	}

	if (account == null) {
		if (code == null) return false;

		await container.subscription.loginWithCode({ code: code }, source as TelemetrySource | undefined);
		if ((await container.subscription.getSubscription()).account == null) return false;
	}
	return true;
}

async function openManagementViaGkDev(container: Container, source: Source | undefined): Promise<boolean> {
	if ((await container.subscription.getSubscription()).account == null) {
		if (!(await container.subscription.loginOrSignUp(true, source as TelemetrySource | undefined))) return false;
	}

	try {
		const token = await container.accountAuthentication.getExchangeToken();
		if (!(await openUrl(await container.urls.getGkDevUrl('settings/integrations', `token=${token}`)))) return false;
	} catch (ex) {
		Logger.error(ex);
		if (!(await openUrl(await container.urls.getGkDevUrl('settings/integrations')))) return false;
	}
	// Resolve on the 2nd window-state change after opening — event #1 is the blur from launching the
	// external browser, event #2 is the user's refocus. Report that event's `focused` value so the package
	// re-syncs only on an actual return (preserves the old `take(…, 2)` + `if (e.focused)` gate). Resolving
	// on the FIRST event would lock to the blur (`focused: false`) and skip the re-sync entirely.
	return new Promise<boolean>(resolve => {
		let count = 0;
		let timeout: ReturnType<typeof setTimeout>;
		const subscription = window.onDidChangeWindowState(e => {
			if (++count < 2) return;

			clearTimeout(timeout);
			subscription.dispose();
			resolve(e.focused);
		});
		// Fallback: tiled window managers / multi-monitor setups may never fire the blur→refocus pair (VS
		// Code keeps focus when the browser opens on another display). Resolve `false` after a timeout so the
		// awaiting caller can't hang forever and the listener can't leak.
		timeout = setTimeout(
			() => {
				subscription.dispose();
				resolve(false);
			},
			5 * 60 * 1000,
		);
	});
}
