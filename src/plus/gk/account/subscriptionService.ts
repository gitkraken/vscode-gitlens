import { getPlatform } from '@env/platform';
import type {
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
	CancellationToken,
	Event,
	MessageItem,
	StatusBarItem,
} from 'vscode';
import {
	CancellationTokenSource,
	version as codeVersion,
	Disposable,
	env,
	EventEmitter,
	MarkdownString,
	ProgressLocation,
	StatusBarAlignment,
	ThemeColor,
	Uri,
	window,
} from 'vscode';
import type { OpenWalkthroughCommandArgs } from '../../../commands/walkthroughs';
import { urls } from '../../../constants';
import type { CoreColors } from '../../../constants.colors';
import { Commands } from '../../../constants.commands';
import {
	proPreviewLengthInDays,
	proTrialLengthInDays,
	SubscriptionPlanId,
	SubscriptionState,
} from '../../../constants.subscription';
import type { Source, TrackingContext } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { AccountValidationError, RequestsAreBlockedTemporarilyError } from '../../../errors';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
import { fromNow } from '../../../system/date';
import { gate } from '../../../system/decorators/gate';
import { debug, log } from '../../../system/decorators/log';
import { take } from '../../../system/event';
import type { Deferrable } from '../../../system/function';
import { debounce, once } from '../../../system/function';
import { Logger } from '../../../system/logger';
import { getLogScope, setLogScopeExit } from '../../../system/logger.scope';
import { flatten } from '../../../system/object';
import { pauseOnCancelOrTimeout } from '../../../system/promise';
import { pluralize } from '../../../system/string';
import { satisfies } from '../../../system/version';
import { executeCommand, registerCommand } from '../../../system/vscode/command';
import { configuration } from '../../../system/vscode/configuration';
import { setContext } from '../../../system/vscode/context';
import { openUrl } from '../../../system/vscode/utils';
import type { GKCheckInResponse } from '../checkin';
import { getSubscriptionFromCheckIn } from '../checkin';
import type { ServerConnection } from '../serverConnection';
import { ensurePlusFeaturesEnabled } from '../utils';
import { LoginUriPathPrefix } from './authenticationConnection';
import { authenticationProviderScopes } from './authenticationProvider';
import type { Organization } from './organization';
import { getApplicablePromo } from './promos';
import type { Subscription } from './subscription';
import {
	assertSubscriptionState,
	computeSubscriptionState,
	getCommunitySubscription,
	getPreviewSubscription,
	getSubscriptionPlan,
	getSubscriptionPlanName,
	getSubscriptionStateString,
	getSubscriptionTimeRemaining,
	getTimeRemaining,
	isSubscriptionExpired,
	isSubscriptionInProTrial,
	isSubscriptionPaid,
	isSubscriptionTrial,
	SubscriptionUpdatedUriPathPrefix,
} from './subscription';

export interface SubscriptionChangeEvent {
	readonly current: Subscription;
	readonly previous: Subscription;
	readonly etag: number;
}

export class SubscriptionService implements Disposable {
	private _onDidChange = new EventEmitter<SubscriptionChangeEvent>();
	get onDidChange(): Event<SubscriptionChangeEvent> {
		return this._onDidChange.event;
	}

	private _onDidCheckIn = new EventEmitter<void>();
	get onDidCheckIn(): Event<void> {
		return this._onDidCheckIn.event;
	}

	private _disposable: Disposable;
	private _subscription!: Subscription;
	private _getCheckInData: () => Promise<GKCheckInResponse | undefined>;
	private _statusBarSubscription: StatusBarItem | undefined;
	private _validationTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
		previousVersion: string | undefined,
	) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			this.container.accountAuthentication.onDidChangeSessions(
				e => setTimeout(() => this.onAuthenticationChanged(e), 0),
				this,
			),
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'plusFeatures')) {
					this.updateContext();
				}
			}),
			container.uri.onDidReceiveSubscriptionUpdatedUri(this.checkUpdatedSubscription, this),
			container.uri.onDidReceiveLoginUri(this.onLoginUri, this),
		);

		const subscription = this.getStoredSubscription();
		this._getCheckInData = () => Promise.resolve(undefined);
		// Resets the preview trial state on the upgrade to 14.0
		if (subscription != null) {
			if (satisfies(previousVersion, '< 14.0')) {
				subscription.previewTrial = undefined;
			}

			if (subscription.account?.id != null) {
				this._getCheckInData = () => this.loadStoredCheckInData(subscription.account!.id);
			}
		}

		this.changeSubscription(subscription, { silent: true });
		setTimeout(() => void this.ensureSession(false), 10000);
	}

	dispose(): void {
		this._statusBarSubscription?.dispose();

		this._disposable.dispose();
	}

	private async onAuthenticationChanged(e: AuthenticationProviderAuthenticationSessionsChangeEvent) {
		let session = this._session;
		if (session == null && this._sessionPromise != null) {
			session = await this._sessionPromise;
		}

		if (session != null && e.removed?.some(s => s.id === session.id)) {
			this._session = undefined;
			this._sessionPromise = undefined;
			void this.logout(undefined);
			return;
		}

		const updated = e.added?.[0] ?? e.changed?.[0];
		if (updated == null) return;

		if (updated.id === session?.id && updated.accessToken === session?.accessToken) {
			return;
		}

		this._session = session;
		void this.validate({ force: true });
	}

	private _etag: number = 0;
	get etag(): number {
		return this._etag;
	}

	private onReady() {
		this._disposable = Disposable.from(
			this._disposable,
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			...this.registerCommands(),
		);
		this.updateContext();

		if (DEBUG) {
			void import(/* webpackChunkName: "__debug__" */ './__debug__accountDebug').then(m => {
				let restore: { session: AuthenticationSession | null | undefined } | undefined;

				function setSession(this: SubscriptionService, session: AuthenticationSession | null | undefined) {
					this._sessionPromise = undefined;
					if (session === this._session) return;

					const previous = this._session;
					this._session = session;

					// Replace the next `onAuthenticationChanged` handler to avoid our own trigger below
					const fn = this.onAuthenticationChanged;
					// eslint-disable-next-line @typescript-eslint/require-await
					this.onAuthenticationChanged = async () => {
						this.onAuthenticationChanged = fn;
					};

					// @ts-expect-error - fragile, but don't want to expose this as it is only for debugging
					this.container.accountAuthentication._onDidChangeSessions.fire({
						added: previous == null && session != null ? [session] : [],
						removed: previous != null && session == null ? [previous] : [],
						changed: previous != null && session != null ? [session] : [],
					});
				}

				m.registerAccountDebug(this.container, {
					getSubscription: () => this._subscription,
					overrideSession: (session: AuthenticationSession | null | undefined) => {
						restore ??= { session: this._session };

						setSession.call(this, session);
					},
					restoreSession: () => {
						if (restore == null) return;

						const { session } = restore;
						restore = undefined;

						setSession.call(this, session);
					},
					onDidCheckIn: this._onDidCheckIn,
					changeSubscription: this.changeSubscription.bind(this),
					getStoredSubscription: this.getStoredSubscription.bind(this),
				});
			});
		}
	}

	private onRepositoriesChanged(_e: RepositoriesChangeEvent): void {
		this.updateContext();
	}

	private registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerCommand(Commands.PlusLogin, (src?: Source) => this.loginOrSignUp(false, src)),
			registerCommand(Commands.PlusSignUp, (src?: Source) => this.loginOrSignUp(true, src)),
			registerCommand(Commands.PlusLogout, (src?: Source) => this.logout(src)),
			registerCommand(Commands.GKSwitchOrganization, () => this.switchOrganization()),

			registerCommand(Commands.PlusManage, (src?: Source) => this.manage(src)),
			registerCommand(Commands.PlusShowPlans, (src?: Source) => this.showPlans(src)),
			registerCommand(Commands.PlusStartPreviewTrial, (src?: Source) => this.startPreviewTrial(src)),
			registerCommand(Commands.PlusReactivateProTrial, (src?: Source) => this.reactivateProTrial(src)),
			registerCommand(Commands.PlusResendVerification, (src?: Source) => this.resendVerification(src)),
			registerCommand(Commands.PlusUpgrade, (src?: Source) => this.upgrade(src)),

			registerCommand(Commands.PlusHide, (src?: Source) => this.setProFeaturesVisibility(false, src)),
			registerCommand(Commands.PlusRestore, (src?: Source) => this.setProFeaturesVisibility(true, src)),

			registerCommand(Commands.PlusValidate, (src?: Source) => this.validate({ force: true }, src)),
		];
	}

	async getAuthenticationSession(createIfNeeded: boolean = false): Promise<AuthenticationSession | undefined> {
		return this.ensureSession(createIfNeeded);
	}

	async getSubscription(cached = false): Promise<Subscription> {
		const promise = this.ensureSession(false);
		if (!cached) {
			void (await promise);
		}
		return this._subscription;
	}

	@debug()
	async learnAboutPro(source: Source, originalSource: Source | undefined): Promise<void> {
		if (originalSource != null) {
			source.detail = {
				...(typeof source.detail === 'string' ? { action: source.detail } : source.detail),
				...flatten(originalSource, 'original'),
			};
		}

		const subscription = await this.getSubscription();
		switch (subscription.state) {
			case SubscriptionState.VerificationRequired:
			case SubscriptionState.Community:
			case SubscriptionState.ProPreview:
			case SubscriptionState.ProPreviewExpired:
				void executeCommand<OpenWalkthroughCommandArgs>(Commands.OpenWalkthrough, {
					...source,
					step: 'pro-features',
				});
				break;
			case SubscriptionState.ProTrial:
				void executeCommand<OpenWalkthroughCommandArgs>(Commands.OpenWalkthrough, {
					...source,
					step: 'pro-trial',
				});
				break;
			case SubscriptionState.ProTrialExpired:
				void executeCommand<OpenWalkthroughCommandArgs>(Commands.OpenWalkthrough, {
					...source,
					step: 'pro-upgrade',
				});
				break;
			case SubscriptionState.ProTrialReactivationEligible:
				void executeCommand<OpenWalkthroughCommandArgs>(Commands.OpenWalkthrough, {
					...source,
					step: 'pro-reactivate',
				});
				break;
			case SubscriptionState.Paid:
				void executeCommand<OpenWalkthroughCommandArgs>(Commands.OpenWalkthrough, {
					...source,
					step: 'pro-paid',
				});
				break;
		}
	}

	private async showPlanMessage(source: Source | undefined) {
		if (!(await this.ensureSession(false))) return;
		const {
			account,
			plan: { actual, effective },
		} = this._subscription;

		if (account?.verified === false) {
			const days = getSubscriptionTimeRemaining(this._subscription, 'days') ?? proTrialLengthInDays;

			const verify: MessageItem = { title: 'Resend Email' };
			const learn: MessageItem = { title: 'See Pro Features' };
			const confirm: MessageItem = { title: 'Continue', isCloseAffordance: true };
			const result = await window.showInformationMessage(
				isSubscriptionPaid(this._subscription)
					? `You are now on the ${actual.name} plan. \n\nYou must first verify your email. Once verified, you will have full access to Pro features.`
					: `Welcome to your ${
							effective.name
					  } Trial.\n\nYou must first verify your email. Once verified, you will have full access to Pro features for ${
							days < 1 ? '<1 more day' : pluralize('day', days, { infix: ' more ' })
					  }.`,
				{
					modal: true,
					detail: `Your ${
						isSubscriptionPaid(this._subscription) ? 'plan' : 'trial'
					} also includes access to the GitKraken DevEx platform, unleashing powerful Git visualization & productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.`,
				},
				verify,
				learn,
				confirm,
			);

			if (result === verify) {
				void this.resendVerification(source);
			} else if (result === learn) {
				void this.learnAboutPro({ source: 'prompt', detail: { action: 'trial-started-verify-email' } }, source);
			}
		} else if (isSubscriptionPaid(this._subscription)) {
			const learn: MessageItem = { title: 'See Pro Features' };
			const confirm: MessageItem = { title: 'Continue', isCloseAffordance: true };
			const result = await window.showInformationMessage(
				`You are now on the ${actual.name} plan and have full access to Pro features.`,
				{
					modal: true,
					detail: 'Your plan also includes access to the GitKraken DevEx platform, unleashing powerful Git visualization & productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.',
				},
				learn,
				confirm,
			);

			if (result === learn) {
				void this.learnAboutPro({ source: 'prompt', detail: { action: 'upgraded' } }, source);
			}
		} else if (isSubscriptionTrial(this._subscription)) {
			const days = getSubscriptionTimeRemaining(this._subscription, 'days') ?? 0;

			const learn: MessageItem = { title: 'See Pro Features' };
			const confirm: MessageItem = { title: 'Continue', isCloseAffordance: true };
			const result = await window.showInformationMessage(
				`Welcome to your ${effective.name} Trial.\n\nYou now have full access to Pro features for ${
					days < 1 ? '<1 more day' : pluralize('day', days, { infix: ' more ' })
				}.`,
				{
					modal: true,
					detail: 'Your trial also includes access to the GitKraken DevEx platform, unleashing powerful Git visualization & productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.',
				},
				confirm,
				learn,
			);

			if (result === learn) {
				void this.learnAboutPro({ source: 'prompt', detail: { action: 'trial-started' } }, source);
			}
		} else {
			const upgrade: MessageItem = { title: 'Upgrade to Pro' };
			const learn: MessageItem = { title: 'See Pro Features' };
			const confirm: MessageItem = { title: 'Continue', isCloseAffordance: true };
			const result = await window.showInformationMessage(
				`You are now on the ${actual.name} plan.`,
				{
					modal: true,
					detail: 'You only have access to Pro features on publicly-hosted repos. For full access to Pro features, please upgrade to a paid plan.\nA paid plan also includes access to the GitKraken DevEx platform, unleashing powerful Git visualization & productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.',
				},
				upgrade,
				learn,
				confirm,
			);

			if (result === upgrade) {
				void this.upgrade(source);
			} else if (result === learn) {
				void this.learnAboutPro({ source: 'prompt', detail: { action: 'trial-ended' } }, source);
			}
		}
	}

	@log()
	async loginOrSignUp(signUp: boolean, source: Source | undefined): Promise<boolean> {
		if (!(await ensurePlusFeaturesEnabled())) return false;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent(
				'subscription/action',
				{ action: signUp ? 'sign-up' : 'sign-in' },
				source,
			);
		}

		const context = getTrackingContextFromSource(source);
		return this.loginCore({ signUp: signUp, source: source, context: context });
	}

	async loginWithCode(authentication: { code: string; state?: string }, source?: Source): Promise<boolean> {
		if (!(await ensurePlusFeaturesEnabled())) return false;
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'sign-in' }, source);
		}

		const session = await this.ensureSession(false);
		if (session != null) {
			await this.logout(source);
		}

		return this.loginCore({ signIn: authentication, source: source });
	}

	private async loginCore(options?: {
		signUp?: boolean;
		source?: Source;
		signIn?: { code: string; state?: string };
		context?: TrackingContext;
	}): Promise<boolean> {
		// Abort any waiting authentication to ensure we can start a new flow
		await this.container.accountAuthentication.abort();
		void this.showAccountView();

		const session = await this.ensureSession(true, {
			signIn: options?.signIn,
			signUp: options?.signUp,
			context: options?.context,
		});
		const loggedIn = Boolean(session);
		if (loggedIn) {
			void this.showPlanMessage(options?.source);
		}
		return loggedIn;
	}

	@log()
	async logout(source: Source | undefined): Promise<void> {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'sign-out' }, source);
		}

		return this.logoutCore();
	}

	private async logoutCore(): Promise<void> {
		this.connection.resetRequestExceptionCount();
		this._lastValidatedDate = undefined;
		if (this._validationTimer != null) {
			clearInterval(this._validationTimer);
			this._validationTimer = undefined;
		}

		await this.container.accountAuthentication.abort();

		this._sessionPromise = undefined;
		if (this._session != null) {
			void this.container.accountAuthentication.removeSession(this._session.id);
			this._session = undefined;
		} else {
			// Even if we don't have a session, make sure to remove any other matching sessions
			void this.container.accountAuthentication.removeSessionsByScopes(authenticationProviderScopes);
		}

		this.changeSubscription(getCommunitySubscription(this._subscription));
	}

	@log()
	async manage(source: Source | undefined): Promise<void> {
		const scope = getLogScope();
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'manage' }, source);
		}

		try {
			const exchangeToken = await this.container.accountAuthentication.getExchangeToken();
			void env.openExternal(this.container.getGkDevExchangeUri(exchangeToken, 'account'));
		} catch (ex) {
			Logger.error(ex, scope);
			void env.openExternal(this.container.getGkDevUri('account'));
		}
	}

	@gate(() => '')
	@log()
	async reactivateProTrial(source: Source | undefined): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;
		const scope = getLogScope();

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'reactivate' }, source);
		}

		const session = await this.ensureSession(false);
		if (session == null) return;

		try {
			const rsp = await this.connection.fetchApi('user/reactivate-trial', {
				method: 'POST',
				body: JSON.stringify({ client: 'gitlens' }),
			});

			if (!rsp.ok) {
				if (rsp.status === 409) {
					void window.showErrorMessage(
						'You are not eligible to reactivate your Pro trial. If you feel that is an error, please contact support.',
						'OK',
					);
					return;
				}

				void window.showErrorMessage(
					`Unable to reactivate trial: (${rsp.status}) ${rsp.statusText}. Please try again. If this issue persists, please contact support.`,
					'OK',
				);
				return;
			}
		} catch (ex) {
			if (ex instanceof RequestsAreBlockedTemporarilyError) {
				void window.showErrorMessage(
					'Unable to reactivate trial: Too many failed requests. Please reload the window and try again.',
					'OK',
				);
				return;
			}

			void window.showErrorMessage(
				`Unable to reactivate trial. Please try again. If this issue persists, please contact support.`,
				'OK',
			);
			Logger.error(ex, scope);
			return;
		}

		// Trial was reactivated. Do a check-in to update, and show a message if successful.
		try {
			await this.checkInAndValidate(session, { force: true });
			if (isSubscriptionTrial(this._subscription)) {
				const remaining = getSubscriptionTimeRemaining(this._subscription, 'days');

				const confirm: MessageItem = { title: 'OK' };
				const learn: MessageItem = { title: "See What's New" };
				const result = await window.showInformationMessage(
					`Your Pro trial has been reactivated! Experience all the new Pro features for another ${pluralize(
						'day',
						remaining ?? 0,
					)}.`,
					{ modal: true },
					confirm,
					learn,
				);

				if (result === learn) {
					void openUrl(urls.releaseNotes);
				}
			}
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
		}
	}

	@gate(() => '')
	@log()
	async resendVerification(source: Source | undefined): Promise<boolean> {
		if (this._subscription.account?.verified) return true;

		const scope = getLogScope();

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'resend-verification' }, source);
		}
		void this.showAccountView(true);

		const session = await this.ensureSession(false);
		if (session == null) return false;

		try {
			const rsp = await this.connection.fetchApi(
				'resend-email',
				{
					method: 'POST',
					body: JSON.stringify({ id: session.account.id }),
				},
				{ token: session.accessToken },
			);

			if (!rsp.ok) {
				debugger;
				Logger.error(
					'',
					scope,
					`Unable to resend verification email; status=(${rsp.status}): ${rsp.statusText}`,
				);

				void window.showErrorMessage(`Unable to resend verification email; Status: ${rsp.statusText}`, 'OK');

				return false;
			}

			const confirm = { title: 'Recheck' };
			const cancel = { title: 'Cancel' };
			const result = await window.showInformationMessage(
				"Once you have verified your email address, click 'Recheck'.",
				confirm,
				cancel,
			);

			if (result === confirm) {
				await this.validate({ force: true }, source);
				return true;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			void window.showErrorMessage('Unable to resend verification email', 'OK');
		}

		return false;
	}

	private setProFeaturesVisibility(visible: boolean, source: Source | undefined) {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent(
				'subscription/action',
				{ action: 'visibility', visible: visible },
				source,
			);
		}

		void configuration.updateEffective('plusFeatures.enabled', visible);
	}

	@log()
	async showAccountView(silent: boolean = false): Promise<void> {
		if (silent && !configuration.get('plusFeatures.enabled', undefined, true)) return;

		if (!this.container.homeView.visible) {
			await executeCommand(Commands.ShowAccountView);
		}
	}

	private showPlans(source: Source | undefined): void {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'pricing' }, source);
		}

		void openUrl(urls.pricing);
	}

	@gate(() => '')
	@log()
	async startPreviewTrial(source: Source | undefined): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'start-preview-trial' }, source);
		}

		const { plan, previewTrial } = this._subscription;
		if (previewTrial != null) {
			void this.showAccountView();

			if (plan.effective.id === SubscriptionPlanId.Community) {
				const signUp: MessageItem = { title: 'Start Pro Trial' };
				const signIn: MessageItem = { title: 'Sign In' };
				const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
				const result = await window.showInformationMessage(
					`Do you want to start your free ${proTrialLengthInDays}-day Pro trial for full access to Pro features?`,
					{ modal: true },
					signUp,
					signIn,
					cancel,
				);

				if (result === signUp || result === signIn) {
					void this.loginOrSignUp(result === signUp, source);
				}
			}

			return;
		}

		// Don't overwrite a trial that is already in progress
		if (isSubscriptionInProTrial(this._subscription)) return;

		const days = proPreviewLengthInDays;
		const subscription = getPreviewSubscription(days, this._subscription);
		this.changeSubscription(subscription);

		setTimeout(async () => {
			const confirm: MessageItem = { title: 'Continue' };
			const learn: MessageItem = { title: 'See Pro Features' };
			const result = await window.showInformationMessage(
				`You can now preview local Pro features for ${
					days < 1 ? '1 day' : pluralize('day', days)
				}, or [start your free ${proTrialLengthInDays}-day Pro trial](command:gitlens.plus.signUp "Start Pro Trial") for full access to Pro features.`,
				confirm,
				learn,
			);

			if (result === learn) {
				void this.learnAboutPro({ source: 'notification', detail: { action: 'preview-started' } }, source);
			}
		}, 1);
	}

	@log()
	async upgrade(source: Source | undefined): Promise<void> {
		const scope = getLogScope();

		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'upgrade' }, source);
		}

		if (this._subscription.account != null) {
			// Do a pre-check-in to see if we've already upgraded to a paid plan.
			try {
				const session = await this.ensureSession(false);
				if (session != null) {
					if ((await this.checkUpdatedSubscription()) === SubscriptionState.Paid) {
						return;
					}
				}
			} catch {}
		}

		const query = new URLSearchParams();
		query.set('source', 'gitlens');
		query.set('product', 'gitlens');

		const hasAccount = this._subscription.account != null;

		const successUri = await env.asExternalUri(
			Uri.parse(
				`${env.uriScheme}://${this.container.context.extension.id}/${
					hasAccount ? SubscriptionUpdatedUriPathPrefix : LoginUriPathPrefix
				}`,
			),
		);
		query.set('success_uri', successUri.toString(true));

		const promoCode = getApplicablePromo(this._subscription.state)?.code;
		if (promoCode != null) {
			query.set('promoCode', promoCode);
		}

		const activeOrgId = this._subscription.activeOrganization?.id;
		if (activeOrgId != null) {
			query.set('org', activeOrgId);
		}

		const context = getTrackingContextFromSource(source);
		if (context != null) {
			query.set('context', context);
		}

		try {
			if (hasAccount) {
				const token = await this.container.accountAuthentication.getExchangeToken(
					SubscriptionUpdatedUriPathPrefix,
				);
				const purchasePath = `purchase/checkout?${query.toString()}`;
				if (!(await openUrl(this.container.getGkDevExchangeUri(token, purchasePath).toString(true)))) return;
			} else if (
				!(await openUrl(this.container.getGkDevUri('purchase/checkout', query.toString()).toString(true)))
			) {
				return;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			if (!(await openUrl(this.container.getGkDevUri('purchase/checkout', query.toString()).toString(true)))) {
				return;
			}
		}

		const completionPromises = [new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5 * 60 * 1000))];

		if (hasAccount) {
			completionPromises.push(
				new Promise<boolean>(resolve =>
					take(
						window.onDidChangeWindowState,
						2,
					)(e => {
						if (e.focused) {
							resolve(true);
						}
					}),
				),
				new Promise<boolean>(resolve =>
					once(this.container.uri.onDidReceiveSubscriptionUpdatedUri)(() => resolve(false)),
				),
			);
		} else {
			completionPromises.push(
				new Promise<boolean>(resolve => once(this.container.uri.onDidReceiveLoginUri)(() => resolve(false))),
			);
		}

		const refresh = await Promise.race(completionPromises);

		if (refresh) {
			void this.checkUpdatedSubscription();
		}
	}

	@gate<SubscriptionService['validate']>(o => `${o?.force ?? false}`)
	@log()
	async validate(options?: { force?: boolean }, _source?: Source | undefined): Promise<void> {
		const scope = getLogScope();

		const session = await this.ensureSession(false);
		if (session == null) {
			this.changeSubscription(this._subscription);
			return;
		}

		try {
			await this.checkInAndValidate(session, options);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
		}
	}

	private _lastValidatedDate: Date | undefined;

	@debug<SubscriptionService['checkInAndValidate']>({ args: { 0: s => s?.account?.label } })
	private async checkInAndValidate(
		session: AuthenticationSession,
		options?: { force?: boolean; showSlowProgress?: boolean; organizationId?: string },
	): Promise<GKCheckInResponse | undefined> {
		const scope = getLogScope();

		// Only check in if we haven't in the last 12 hours
		if (
			!options?.force &&
			this._lastValidatedDate != null &&
			Date.now() - this._lastValidatedDate.getTime() < 12 * 60 * 60 * 1000 &&
			!isSubscriptionExpired(this._subscription)
		) {
			setLogScopeExit(scope, ` (${fromNow(this._lastValidatedDate.getTime(), true)})...`, 'skipped');
			return;
		}

		const validating = this.checkInAndValidateCore(session, options?.organizationId);
		if (!options?.showSlowProgress) return validating;

		// Show progress if we are waiting too long
		const result = await pauseOnCancelOrTimeout(validating, undefined, 3000);
		if (result.paused) {
			return window.withProgress(
				{ location: ProgressLocation.Notification, title: 'Validating your account...' },
				() => result.value,
			);
		}

		return result.value;
	}

	@gate<SubscriptionService['checkInAndValidateCore']>(s => s.account.id)
	@debug<SubscriptionService['checkInAndValidateCore']>({ args: { 0: s => s?.account?.label } })
	private async checkInAndValidateCore(
		session: AuthenticationSession,
		organizationId?: string,
	): Promise<GKCheckInResponse | undefined> {
		const scope = getLogScope();
		this._lastValidatedDate = undefined;

		try {
			const checkInData = {
				id: session.account.id,
				platform: getPlatform(),
				gitlensVersion: this.container.version,
				machineId: env.machineId,
				sessionId: env.sessionId,
				vscodeEdition: env.appName,
				vscodeHost: env.appHost,
				vscodeVersion: codeVersion,
				previewStartedOn: this._subscription.previewTrial?.startedOn,
				previewExpiresOn: this._subscription.previewTrial?.expiresOn,
			};

			const rsp = await this.connection.fetchApi(
				'gitlens/checkin',
				{
					method: 'POST',
					body: JSON.stringify(checkInData),
				},
				{ token: session.accessToken, organizationId: organizationId },
			);

			if (!rsp.ok) {
				this._getCheckInData = () => Promise.resolve(undefined);
				throw new AccountValidationError('Unable to validate account', undefined, rsp.status, rsp.statusText);
			}

			this._onDidCheckIn.fire();

			const data: GKCheckInResponse = await rsp.json();
			this._getCheckInData = () => Promise.resolve(data);
			this.storeCheckInData(data);

			await this.validateAndUpdateSubscriptions(data, session);
			return data;
		} catch (ex) {
			this._getCheckInData = () => Promise.resolve(undefined);

			Logger.error(ex, scope);
			debugger;

			// If we cannot check in, validate stored subscription
			this.changeSubscription(this._subscription);
			if (ex instanceof AccountValidationError) throw ex;

			throw new AccountValidationError('Unable to validate account', ex);
		} finally {
			this.startDailyValidationTimer();
		}
	}

	private startDailyValidationTimer(): void {
		if (this._validationTimer != null) {
			clearInterval(this._validationTimer);
		}

		// Check 4 times a day to ensure we validate at least once a day
		this._validationTimer = setInterval(
			() => {
				if (this._lastValidatedDate == null || this._lastValidatedDate.getDate() !== new Date().getDate()) {
					void this.ensureSession(false, { force: true });
				}
			},
			6 * 60 * 60 * 1000,
		);
	}

	private storeCheckInData(data: GKCheckInResponse): void {
		if (data.user?.id == null) return;

		void this.container.storage.store(`gk:${data.user.id}:checkin`, {
			v: 1,
			timestamp: Date.now(),
			data: data,
		});
	}

	private async loadStoredCheckInData(userId: string): Promise<GKCheckInResponse | undefined> {
		const scope = getLogScope();
		const storedCheckIn = this.container.storage.get(`gk:${userId}:checkin`);
		// If more than a day old, ignore
		if (storedCheckIn?.timestamp == null || Date.now() - storedCheckIn.timestamp > 24 * 60 * 60 * 1000) {
			// Attempt a check-in to see if we can get a new one
			const session = await this.getAuthenticationSession(false);
			if (session == null) return undefined;

			try {
				return await this.checkInAndValidate(session, { force: true });
			} catch (ex) {
				Logger.error(ex, scope);
				return undefined;
			}
		}

		return storedCheckIn?.data;
	}

	@debug()
	private async validateAndUpdateSubscriptions(data: GKCheckInResponse, session: AuthenticationSession) {
		const scope = getLogScope();
		let organizations: Organization[];
		try {
			organizations =
				(await this.container.organizations.getOrganizations({
					force: true,
					accessToken: session.accessToken,
					userId: session.account.id,
				})) ?? [];
		} catch (ex) {
			Logger.error(ex, scope);
			organizations = [];
		}
		let chosenOrganizationId: string | undefined = configuration.get('gitKraken.activeOrganizationId') ?? undefined;
		if (chosenOrganizationId === '') {
			chosenOrganizationId = undefined;
		} else if (chosenOrganizationId != null && !organizations.some(o => o.id === chosenOrganizationId)) {
			chosenOrganizationId = undefined;
			void configuration.updateEffective('gitKraken.activeOrganizationId', undefined);
		}
		const subscription = getSubscriptionFromCheckIn(data, organizations, chosenOrganizationId);
		this._lastValidatedDate = new Date();
		this.changeSubscription(
			{
				...this._subscription,
				...subscription,
			},
			{ store: true },
		);
	}

	private _sessionPromise: Promise<AuthenticationSession | null> | undefined;
	private _session: AuthenticationSession | null | undefined;

	@gate()
	@debug()
	private async ensureSession(
		createIfNeeded: boolean,
		options?: {
			force?: boolean;
			signUp?: boolean;
			signIn?: { code: string; state?: string };
			context?: TrackingContext;
		},
	): Promise<AuthenticationSession | undefined> {
		if (this._sessionPromise != null) {
			void (await this._sessionPromise);
		}

		if (!options?.force && this._session != null) return this._session;
		if (this._session === null && !createIfNeeded) return undefined;

		if (this._sessionPromise === undefined) {
			this._sessionPromise = this.getOrCreateSession(createIfNeeded, {
				signUp: options?.signUp,
				signIn: options?.signIn,
				context: options?.context,
			}).then(
				s => {
					this._session = s;
					this._sessionPromise = undefined;
					return this._session;
				},
				() => {
					this._session = null;
					this._sessionPromise = undefined;
					return this._session;
				},
			);
		}

		const session = await this._sessionPromise;
		return session ?? undefined;
	}

	@debug()
	private async getOrCreateSession(
		createIfNeeded: boolean,
		options?: { signUp?: boolean; signIn?: { code: string; state?: string }; context?: TrackingContext },
	): Promise<AuthenticationSession | null> {
		const scope = getLogScope();

		let session: AuthenticationSession | null | undefined;
		try {
			if (options != null && createIfNeeded) {
				this.container.accountAuthentication.setOptionsForScopes(authenticationProviderScopes, options);
			}
			session = await this.container.accountAuthentication.getOrCreateSession(
				authenticationProviderScopes,
				createIfNeeded,
			);
		} catch (ex) {
			session = null;
			if (options != null && createIfNeeded) {
				this.container.accountAuthentication.clearOptionsForScopes(authenticationProviderScopes);
			}

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				setLogScopeExit(scope, ' \u2022 User declined authentication');
				await this.logoutCore();
				return null;
			}

			Logger.error(ex, scope);
		}

		if (session == null) {
			setLogScopeExit(scope, ' \u2022 No valid session was found');
			await this.logoutCore();
			return session ?? null;
		}

		try {
			await this.checkInAndValidate(session, { showSlowProgress: createIfNeeded, force: createIfNeeded });
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			this.container.telemetry.sendEvent('account/validation/failed', {
				'account.id': session.account.id,
				exception: String(ex),
				code: ex.original?.code,
				statusCode: ex.statusCode,
			});

			setLogScopeExit(
				scope,
				` \u2022 Account validation failed (${ex.statusCode ?? ex.original?.code})`,
				'FAILED',
			);

			if (ex instanceof AccountValidationError) {
				const name = session.account.label;

				// if (
				// 	(ex.statusCode != null && ex.statusCode < 500) ||
				// 	(ex.statusCode == null && (ex.original as any)?.code !== 'ENOTFOUND')
				// ) {
				if (
					(ex.original as any)?.code !== 'ENOTFOUND' &&
					ex.statusCode != null &&
					ex.statusCode < 500 &&
					ex.statusCode >= 400
				) {
					session = null;
					await this.logoutCore();

					if (createIfNeeded) {
						const unauthorized = ex.statusCode === 401;
						queueMicrotask(async () => {
							const confirm: MessageItem = { title: 'Retry Sign In' };
							const result = await window.showErrorMessage(
								`Unable to sign in to your (${name}) account. Please try again. If this issue persists, please contact support.${
									unauthorized ? '' : ` Error=${ex.message}`
								}`,
								confirm,
							);

							if (result === confirm) {
								void this.loginOrSignUp(false, {
									source: 'subscription',
									detail: {
										error: 'validation-failed',
										'error.message': ex.message,
									},
								});
							}
						});
					}
				} else {
					session = session ?? null;

					// if ((ex.original as any)?.code !== 'ENOTFOUND') {
					// 	void window.showErrorMessage(
					// 		`Unable to sign in to your (${name}) account right now. Please try again in a few minutes. If this issue persists, please contact support. Error=${ex.message}`,
					// 		'OK',
					// 	);
					// }
				}
			}
		}

		this.connection.resetRequestExceptionCount();
		return session;
	}

	@debug()
	private changeSubscription(
		subscription: Optional<Subscription, 'state'> | undefined,
		options?: { silent?: boolean; store?: boolean },
	): void {
		if (subscription == null) {
			subscription = {
				plan: {
					actual: getSubscriptionPlan(SubscriptionPlanId.Community, false, 0, undefined),
					effective: getSubscriptionPlan(SubscriptionPlanId.Community, false, 0, undefined),
				},
				account: undefined,
				state: SubscriptionState.Community,
			};
		}

		// If the effective plan has expired, then replace it with the actual plan
		if (isSubscriptionExpired(subscription)) {
			subscription = {
				...subscription,
				plan: {
					...subscription.plan,
					effective: subscription.plan.actual,
				},
			};
		}

		// If we don't have a paid plan (or a non-preview trial), check if the preview trial has expired, if not apply it
		if (
			!isSubscriptionPaid(subscription) &&
			subscription.previewTrial != null &&
			(getTimeRemaining(subscription.previewTrial.expiresOn) ?? 0) > 0
		) {
			subscription = {
				...subscription,
				plan: {
					...subscription.plan,
					effective: getSubscriptionPlan(
						SubscriptionPlanId.Pro,
						false,
						0,
						undefined,
						new Date(subscription.previewTrial.startedOn),
						new Date(subscription.previewTrial.expiresOn),
					),
				},
			};
		}

		subscription.state = computeSubscriptionState(subscription);
		assertSubscriptionState(subscription);

		const promo = getApplicablePromo(subscription.state);
		void setContext('gitlens:promo', promo?.key);

		const previous = this._subscription as typeof this._subscription | undefined; // Can be undefined here, since we call this in the constructor
		// Check the previous and new subscriptions are exactly the same
		const matches = previous != null && JSON.stringify(previous) === JSON.stringify(subscription);

		// If the previous and new subscriptions are exactly the same, kick out
		if (matches) {
			if (options?.store) {
				void this.storeSubscription(subscription);
			}
			return;
		}

		queueMicrotask(() => {
			let data = flattenSubscription(subscription);
			this.container.telemetry.setGlobalAttributes(data);

			data = {
				...data,
				...(!matches ? flattenSubscription(previous, 'previous') : {}),
			};

			this.container.telemetry.sendEvent(previous == null ? 'subscription' : 'subscription/changed', data);
		});

		if (options?.store !== false) {
			void this.storeSubscription(subscription);
		}

		this._subscription = subscription;
		this._etag = Date.now();

		if (!options?.silent) {
			this.updateContext();

			if (previous != null) {
				this._onDidChange.fire({ current: subscription, previous: previous, etag: this._etag });
			}
		}
	}

	private getStoredSubscription(): Subscription | undefined {
		const storedSubscription = this.container.storage.get('premium:subscription');

		let lastValidatedAt: number | undefined;
		let subscription: Subscription | undefined;
		if (storedSubscription?.data != null) {
			({ lastValidatedAt, ...subscription } = storedSubscription.data);
			this._lastValidatedDate = lastValidatedAt != null ? new Date(lastValidatedAt) : undefined;
		} else {
			subscription = undefined;
		}

		if (subscription != null) {
			// Migrate the plan names to the latest names
			(subscription.plan.actual as Mutable<Subscription['plan']['actual']>).name = getSubscriptionPlanName(
				subscription.plan.actual.id,
			);
			(subscription.plan.effective as Mutable<Subscription['plan']['effective']>).name = getSubscriptionPlanName(
				subscription.plan.effective.id,
			);
		}

		return subscription;
	}

	private async storeSubscription(subscription: Subscription): Promise<void> {
		return this.container.storage.store('premium:subscription', {
			v: 1,
			data: { ...subscription, lastValidatedAt: this._lastValidatedDate?.getTime() },
		});
	}

	private _cancellationSource: CancellationTokenSource | undefined;
	private _updateAccessContextDebounced: Deferrable<SubscriptionService['updateAccessContext']> | undefined;

	private updateContext(): void {
		this._updateAccessContextDebounced?.cancel();
		if (this._updateAccessContextDebounced == null) {
			this._updateAccessContextDebounced = debounce(this.updateAccessContext.bind(this), 500);
		}

		if (this._cancellationSource != null) {
			this._cancellationSource.cancel();
		}
		this._cancellationSource = new CancellationTokenSource();

		void this._updateAccessContextDebounced(this._cancellationSource.token);
		this.updateStatusBar();

		const {
			plan: { actual },
			state,
		} = this._subscription;

		void setContext('gitlens:plus', actual.id != SubscriptionPlanId.Community ? actual.id : undefined);
		void setContext('gitlens:plus:state', state);
	}

	private async updateAccessContext(cancellation: CancellationToken): Promise<void> {
		let allowed: boolean | 'mixed' = false;
		// For performance reasons, only check if we have any repositories
		if (this.container.git.repositoryCount !== 0) {
			({ allowed } = await this.container.git.access());
			if (cancellation.isCancellationRequested) return;
		}

		const plusFeatures = configuration.get('plusFeatures.enabled') ?? true;

		let disallowedRepos: string[] | undefined;

		if (!plusFeatures && allowed === 'mixed') {
			disallowedRepos = [];
			for (const repo of this.container.git.repositories) {
				if (repo.closed) continue;

				const access = await this.container.git.access(undefined, repo.uri);
				if (cancellation.isCancellationRequested) return;

				if (!access.allowed) {
					disallowedRepos.push(repo.uri.toString());
				}
			}
		}

		void setContext('gitlens:plus:enabled', Boolean(allowed) || plusFeatures);
		void setContext('gitlens:plus:required', allowed === false);
		void setContext('gitlens:plus:disallowedRepos', disallowedRepos);
	}

	private updateStatusBar(): void {
		const {
			account,
			plan: { effective },
			state,
		} = this._subscription;

		if (effective.id === SubscriptionPlanId.Community) {
			this._statusBarSubscription?.dispose();
			this._statusBarSubscription = undefined;
			return;
		}

		const trial = isSubscriptionTrial(this._subscription);
		if (!trial && account?.verified !== false) {
			this._statusBarSubscription?.dispose();
			this._statusBarSubscription = undefined;
			return;
		}

		if (this._statusBarSubscription == null) {
			this._statusBarSubscription = window.createStatusBarItem(
				'gitlens.plus.subscription',
				StatusBarAlignment.Left,
				1,
			);
		}

		this._statusBarSubscription.name = 'GitLens Subscription';
		this._statusBarSubscription.command = Commands.ShowAccountView;

		if (account?.verified === false) {
			this._statusBarSubscription.text = `$(warning) ${effective.name} (Unverified)`;
			this._statusBarSubscription.backgroundColor = new ThemeColor(
				'statusBarItem.warningBackground' satisfies CoreColors,
			);
			this._statusBarSubscription.tooltip = new MarkdownString(
				trial
					? `**Please verify your email**\n\nYou must verify your email before you can start your **${effective.name}** trial.\n\nClick for details`
					: `**Please verify your email**\n\nYou must verify your email before you can use Pro features on privately-hosted repos.\n\nClick for details`,
				true,
			);
		} else {
			const remaining = getSubscriptionTimeRemaining(this._subscription, 'days');
			const isReactivatedTrial = state === SubscriptionState.ProTrial && effective.trialReactivationCount > 0;

			this._statusBarSubscription.text = `${effective.name} (Trial)`;
			this._statusBarSubscription.tooltip = new MarkdownString(
				`${
					isReactivatedTrial
						? `[See what's new](${urls.releaseNotes}) with ${pluralize('day', remaining ?? 0, {
								infix: ' more ',
						  })} in your **${effective.name}** trial.`
						: `You have ${pluralize('day', remaining ?? 0)} remaining in your **${effective.name}** trial.`
				} Once your trial ends, you'll need a paid plan for full access to [Pro features](command:gitlens.openWalkthrough?%7B%22step%22%3A%22pro-trial%22,%22source%22%3A%22prompt%22%7D).\n\nYour trial also includes access to the [GitKraken DevEx platform](${
					urls.platform
				}), unleashing powerful Git visualization & productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.`,
				true,
			);
		}

		this._statusBarSubscription.show();
	}

	async switchOrganization(): Promise<void> {
		const scope = getLogScope();
		if (this._session == null) return;

		let organizations;
		try {
			organizations = await this.container.organizations.getOrganizations();
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);
			return;
		}

		if (organizations == null || organizations.length === 0) return;

		// Show a quickpick to select the active organization
		const picks: { label: string; org: Organization | null }[] = organizations.map(org => ({
			label: org.name,
			org: org,
		}));

		const pick = await window.showQuickPick(picks, {
			title: 'Switch Organization',
			placeHolder: 'Select the active organization for your account',
		});

		const currentActiveOrganization = this._subscription?.activeOrganization;
		if (pick?.org == null) {
			return;
		}

		if (currentActiveOrganization != null && pick.org.id === currentActiveOrganization.id) {
			return;
		}

		await this.checkInAndValidate(this._session, { force: true, organizationId: pick.org.id });
		const checkInData = await this._getCheckInData();
		if (checkInData == null) return;

		const organizationSubscription = getSubscriptionFromCheckIn(checkInData, organizations, pick.org.id);

		if (configuration.get('gitKraken.activeOrganizationId') !== pick.org.id) {
			await configuration.updateEffective('gitKraken.activeOrganizationId', pick.org.id);
		}

		this.changeSubscription(
			{
				...this._subscription,
				...organizationSubscription,
			},
			{ store: true },
		);
	}

	onLoginUri(uri: Uri) {
		const scope = getLogScope();
		const queryParams = new URLSearchParams(uri.query);
		const code = queryParams.get('code');
		const state = queryParams.get('state');
		const context = queryParams.get('context');
		let contextMessage = 'sign in to GitKraken';

		switch (context) {
			case 'start_trial':
				contextMessage = 'start a Pro trial';
				break;
		}

		if (code == null) {
			Logger.error(undefined, scope, `No code provided. Link: ${uri.toString(true)}`);
			void window.showErrorMessage(
				`Unable to ${contextMessage} with that link. Please try clicking the link again. If this issue persists, please contact support.`,
			);
			return;
		}

		void this.loginWithCode({ code: code, state: state ?? undefined }, { source: 'deeplink' });
	}

	async checkUpdatedSubscription(): Promise<SubscriptionState | undefined> {
		if (this._session == null) return undefined;
		const oldSubscriptionState = this._subscription.state;
		await this.checkInAndValidate(this._session, { force: true });
		if (oldSubscriptionState !== this._subscription.state) {
			void this.showPlanMessage({ source: 'subscription' });
		}

		return this._subscription.state;
	}
}

type FlattenedSubscription = {
	'subscription.state'?: SubscriptionState;
	'subscription.status'?:
		| 'verification'
		| 'free'
		| 'preview'
		| 'preview-expired'
		| 'trial'
		| 'trial-expired'
		| 'trial-reactivation-eligible'
		| 'paid'
		| 'unknown';
} & Partial<
	Record<`account.${string}`, string | number | boolean | undefined> &
		Record<`subscription.${string}`, string | number | boolean | undefined> &
		Record<`subscription.previewTrial.${string}`, string | number | boolean | undefined> &
		Record<`previous.account.${string}`, string | number | boolean | undefined> &
		Record<`previous.subscription.${string}`, string | number | boolean | undefined> &
		Record<`previous.subscription.previewTrial.${string}`, string | number | boolean | undefined>
>;

function flattenSubscription(
	subscription: Optional<Subscription, 'state'> | undefined,
	prefix?: string,
): FlattenedSubscription {
	if (subscription == null) return {};

	return {
		...flatten(subscription.account, `${prefix ? `${prefix}.` : ''}account`, {
			joinArrays: true,
			skipPaths: ['name', 'email'],
		}),
		...flatten(subscription.plan, `${prefix ? `${prefix}.` : ''}subscription`, {
			skipPaths: ['actual.name', 'effective.name'],
		}),
		...flatten(subscription.previewTrial, `${prefix ? `${prefix}.` : ''}subscription.previewTrial`, {
			skipPaths: ['actual.name', 'effective.name'],
		}),
		'subscription.state': subscription.state,
		'subscription.stateString': getSubscriptionStateString(subscription.state),
	};
}

function getTrackingContextFromSource(source: Source | undefined): TrackingContext | undefined {
	switch (source?.source) {
		case 'graph':
			return 'graph';
		case 'launchpad':
			return 'launchpad';
		case 'timeline':
			return 'visual_file_history';
		case 'quick-wizard':
			if (source.detail != null && typeof source.detail !== 'string' && 'action' in source.detail) {
				switch (source.detail.action) {
					case 'worktree':
						return 'worktrees';
					case 'launchpad':
						return 'launchpad';
				}
			}
			break;
		case 'worktrees':
			return 'worktrees';
	}

	return undefined;
}
