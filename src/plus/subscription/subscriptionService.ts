import type {
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
	CancellationToken,
	Event,
	MessageItem,
	StatusBarItem,
} from 'vscode';
import {
	authentication,
	CancellationTokenSource,
	version as codeVersion,
	Disposable,
	env,
	EventEmitter,
	MarkdownString,
	ProgressLocation,
	StatusBarAlignment,
	ThemeColor,
	window,
} from 'vscode';
import { getPlatform } from '@env/platform';
import type { CoreColors } from '../../constants';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { AccountValidationError } from '../../errors';
import type { RepositoriesChangeEvent } from '../../git/gitProviderService';
import type { Subscription } from '../../subscription';
import {
	computeSubscriptionState,
	getSubscriptionPlan,
	getSubscriptionPlanName,
	getSubscriptionPlanPriority,
	getSubscriptionTimeRemaining,
	getTimeRemaining,
	isSubscriptionExpired,
	isSubscriptionInProTrial,
	isSubscriptionPaid,
	isSubscriptionTrial,
	SubscriptionPlanId,
	SubscriptionState,
} from '../../subscription';
import { executeCommand, registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { setContext } from '../../system/context';
import { createFromDateDelta } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import type { Deferrable } from '../../system/function';
import { debounce, once } from '../../system/function';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { flatten } from '../../system/object';
import { pluralize } from '../../system/string';
import { openWalkthrough } from '../../system/utils';
import { satisfies } from '../../system/version';
import { authenticationProviderId, authenticationProviderScopes } from '../gk/authenticationProvider';
import type { ServerConnection } from '../gk/serverConnection';
import { ensurePlusFeaturesEnabled } from './utils';

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

	private _disposable: Disposable;
	private _subscription!: Subscription;
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
		);

		const subscription = this.getStoredSubscription();
		// Resets the preview trial state on the upgrade to 14.0
		if (subscription != null && satisfies(previousVersion, '< 14.0')) {
			subscription.previewTrial = undefined;
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

		if (session != null && e.removed?.some(s => s.id === session!.id)) {
			this._session = undefined;
			this._sessionPromise = undefined;
			void this.logout();
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
	}

	private onRepositoriesChanged(_e: RepositoriesChangeEvent): void {
		this.updateContext();
	}

	private registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			registerCommand(Commands.PlusLoginOrSignUp, () => this.loginOrSignUp()),
			registerCommand(Commands.PlusLogout, () => this.logout()),

			registerCommand(Commands.PlusStartPreviewTrial, () => this.startPreviewTrial()),
			registerCommand(Commands.PlusManage, () => this.manage()),
			registerCommand(Commands.PlusPurchase, () => this.purchase()),

			registerCommand(Commands.PlusResendVerification, () => this.resendVerification()),
			registerCommand(Commands.PlusValidate, () => this.validate({ force: true })),

			registerCommand(Commands.PlusShowPlans, () => this.showPlans()),

			registerCommand(Commands.PlusHide, () => configuration.updateEffective('plusFeatures.enabled', false)),
			registerCommand(Commands.PlusRestore, () => configuration.updateEffective('plusFeatures.enabled', true)),

			registerCommand('gitlens.plus.reset', () => this.logout(true)),
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
	async learnAboutPreviewOrTrial() {
		const subscription = await this.getSubscription();
		if (subscription.state === SubscriptionState.FreeInPreviewTrial) {
			void openWalkthrough(
				this.container.context.extension.id,
				'gitlens.welcome',
				'gitlens.welcome.preview',
				false,
			);
		} else if (subscription.state === SubscriptionState.FreePlusInTrial) {
			void openWalkthrough(
				this.container.context.extension.id,
				'gitlens.welcome',
				'gitlens.welcome.trial',
				false,
			);
		}
	}

	@log()
	async loginOrSignUp(): Promise<boolean> {
		if (!(await ensurePlusFeaturesEnabled())) return false;

		// Abort any waiting authentication to ensure we can start a new flow
		await this.container.accountAuthentication.abort();
		void this.showAccountView();

		const session = await this.ensureSession(true);
		const loggedIn = Boolean(session);
		if (loggedIn) {
			const {
				account,
				plan: { actual, effective },
			} = this._subscription;

			if (account?.verified === false) {
				const confirm: MessageItem = { title: 'Resend Verification', isCloseAffordance: true };
				const cancel: MessageItem = { title: 'Cancel' };
				const result = await window.showInformationMessage(
					`You must verify your email before you can access ${effective.name}.`,
					confirm,
					cancel,
				);

				if (result === confirm) {
					void this.resendVerification();
				}
			} else if (isSubscriptionTrial(this._subscription)) {
				const remaining = getSubscriptionTimeRemaining(this._subscription, 'days');

				const confirm: MessageItem = { title: 'OK', isCloseAffordance: true };
				const learn: MessageItem = { title: 'Learn More' };
				const result = await window.showInformationMessage(
					`Welcome to ${
						effective.name
					} (Trial). You can now try Pro features on privately hosted repos for ${pluralize(
						'more day',
						remaining ?? 0,
					)}.`,
					{ modal: true },
					confirm,
					learn,
				);

				if (result === learn) {
					void this.learnAboutPreviewOrTrial();
				}
			} else if (isSubscriptionPaid(this._subscription)) {
				void window.showInformationMessage(
					`Welcome to ${actual.name}. You can now use Pro features on privately hosted repos.`,
					'OK',
				);
			} else {
				void window.showInformationMessage(
					`Welcome to ${actual.name}. You can use Pro features on local & publicly hosted repos.`,
					'OK',
				);
			}
		}
		return loggedIn;
	}

	@log()
	async logout(reset: boolean = false): Promise<void> {
		return this.logoutCore(reset);
	}

	private async logoutCore(reset: boolean = false): Promise<void> {
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

		if (reset && this.container.debugging) {
			this.changeSubscription(undefined);

			return;
		}

		this.changeSubscription({
			...this._subscription,
			plan: {
				actual: getSubscriptionPlan(
					SubscriptionPlanId.Free,
					false,
					undefined,
					this._subscription.plan?.actual?.startedOn != null
						? new Date(this._subscription.plan.actual.startedOn)
						: undefined,
				),
				effective: getSubscriptionPlan(
					SubscriptionPlanId.Free,
					false,
					undefined,
					this._subscription.plan?.effective?.startedOn != null
						? new Date(this._subscription.plan.actual.startedOn)
						: undefined,
				),
			},
			account: undefined,
		});
	}

	@log()
	manage(): void {
		void env.openExternal(this.connection.getAccountsUri());
	}

	@log()
	async purchase(): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this._subscription.account == null) {
			this.showPlans();
		} else {
			void env.openExternal(this.connection.getAccountsUri('subscription', 'product=gitlens&license=PRO'));
		}
		await this.showAccountView();
	}

	@gate()
	@log()
	async resendVerification(): Promise<boolean> {
		if (this._subscription.account?.verified) return true;

		const scope = getLogScope();

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
				session.accessToken,
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
				await this.validate({ force: true });
				return true;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			void window.showErrorMessage('Unable to resend verification email', 'OK');
		}

		return false;
	}

	@log()
	async showAccountView(silent: boolean = false): Promise<void> {
		if (silent && !configuration.get('plusFeatures.enabled', undefined, true)) return;

		if (!this.container.accountView.visible) {
			await executeCommand(Commands.ShowAccountView);
		}
	}

	private showPlans(): void {
		void env.openExternal(this.connection.getSiteUri('gitlens/pricing'));
	}

	@gate()
	@log()
	async startPreviewTrial(silent?: boolean): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		let { plan, previewTrial } = this._subscription;
		if (previewTrial != null) {
			void this.showAccountView();

			if (!silent && plan.effective.id === SubscriptionPlanId.Free) {
				const confirm: MessageItem = { title: 'Start Free Pro Trial', isCloseAffordance: true };
				const cancel: MessageItem = { title: 'Cancel' };
				const result = await window.showInformationMessage(
					'Your 3-day Pro preview has ended, start a free Pro trial to get an additional 7 days.\n\n✨ A trial or paid plan is required to use Pro features on privately hosted repos.',
					{ modal: true },
					confirm,
					cancel,
				);

				if (result === confirm) {
					void this.loginOrSignUp();
				}
			}

			return;
		}

		// Don't overwrite a trial that is already in progress
		if (isSubscriptionInProTrial(this._subscription)) return;

		const startedOn = new Date();

		let days: number;
		let expiresOn = new Date(startedOn);
		if (!this.container.debugging) {
			// Normalize the date to just before midnight on the same day
			expiresOn.setHours(23, 59, 59, 999);
			expiresOn = createFromDateDelta(expiresOn, { days: 3 });
			days = 3;
		} else {
			expiresOn = createFromDateDelta(expiresOn, { minutes: 1 });
			days = 0;
		}

		previewTrial = {
			startedOn: startedOn.toISOString(),
			expiresOn: expiresOn.toISOString(),
		};

		this.changeSubscription({
			...this._subscription,
			plan: {
				...this._subscription.plan,
				effective: getSubscriptionPlan(SubscriptionPlanId.Pro, false, undefined, startedOn, expiresOn),
			},
			previewTrial: previewTrial,
		});

		if (!silent) {
			setTimeout(async () => {
				const confirm: MessageItem = { title: 'OK', isCloseAffordance: true };
				const learn: MessageItem = { title: 'Learn More' };
				const result = await window.showInformationMessage(
					`You can now preview Pro features for ${pluralize(
						'day',
						days,
					)}. After which, you can start a free Pro trial for an additional 7 days.`,
					confirm,
					learn,
				);

				if (result === learn) {
					void this.learnAboutPreviewOrTrial();
				}
			}, 1);
		}
	}

	@gate()
	@log()
	async validate(options?: { force?: boolean }): Promise<void> {
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
	@gate<SubscriptionService['checkInAndValidate']>(s => s.account.id)
	private async checkInAndValidate(
		session: AuthenticationSession,
		options?: { force?: boolean; showSlowProgress?: boolean },
	): Promise<void> {
		// Only check in if we haven't in the last 12 hours
		if (
			!options?.force &&
			this._lastValidatedDate != null &&
			Date.now() - this._lastValidatedDate.getTime() < 12 * 60 * 60 * 1000 &&
			!isSubscriptionExpired(this._subscription)
		) {
			return;
		}

		if (!options?.showSlowProgress) return this.checkInAndValidateCore(session);

		const validating = this.checkInAndValidateCore(session);
		const result = await Promise.race([
			validating,
			new Promise<boolean>(resolve => setTimeout(resolve, 3000, true)),
		]);

		if (result) {
			await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: 'Validating your GitKraken account...',
				},
				() => validating,
			);
		}
	}

	@debug<SubscriptionService['checkInAndValidateCore']>({ args: { 0: s => s?.account.label } })
	private async checkInAndValidateCore(session: AuthenticationSession): Promise<void> {
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
				session.accessToken,
			);

			if (!rsp.ok) {
				throw new AccountValidationError('Unable to validate account', undefined, rsp.status, rsp.statusText);
			}

			const data: GKLicenseInfo = await rsp.json();
			this.validateSubscription(data);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
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
					void this.ensureSession(false, true);
				}
			},
			6 * 60 * 60 * 1000,
		);
	}

	@debug()
	private validateSubscription(data: GKLicenseInfo) {
		const account: Subscription['account'] = {
			id: data.user.id,
			name: data.user.name,
			email: data.user.email,
			verified: data.user.status === 'activated',
			createdOn: data.user.createdDate,
			organizationIds: data.orgIds ?? [],
		};

		const effectiveLicenses = Object.entries(data.licenses.effectiveLicenses) as [GKLicenseType, GKLicense][];
		const paidLicenses = Object.entries(data.licenses.paidLicenses) as [GKLicenseType, GKLicense][];

		let actual: Subscription['plan']['actual'] | undefined;
		if (paidLicenses.length > 0) {
			if (paidLicenses.length > 1) {
				paidLicenses.sort(
					(a, b) =>
						getSubscriptionPlanPriority(convertLicenseTypeToPlanId(b[0])) +
						licenseStatusPriority(b[1].latestStatus) -
						(getSubscriptionPlanPriority(convertLicenseTypeToPlanId(a[0])) +
							licenseStatusPriority(a[1].latestStatus)),
				);
			}

			const [licenseType, license] = paidLicenses[0];
			actual = getSubscriptionPlan(
				convertLicenseTypeToPlanId(licenseType),
				isBundleLicenseType(licenseType),
				license.organizationId,
				new Date(license.latestStartDate),
				new Date(license.latestEndDate),
				license.latestStatus === 'cancelled',
			);
		}

		if (actual == null) {
			actual = getSubscriptionPlan(
				SubscriptionPlanId.FreePlus,
				false,
				undefined,
				data.user.firstGitLensCheckIn != null
					? new Date(data.user.firstGitLensCheckIn)
					: data.user.createdDate != null
					? new Date(data.user.createdDate)
					: undefined,
			);
		}

		let effective: Subscription['plan']['effective'] | undefined;
		if (effectiveLicenses.length > 0) {
			if (effectiveLicenses.length > 1) {
				effectiveLicenses.sort(
					(a, b) =>
						getSubscriptionPlanPriority(convertLicenseTypeToPlanId(b[0])) +
						licenseStatusPriority(b[1].latestStatus) -
						(getSubscriptionPlanPriority(convertLicenseTypeToPlanId(a[0])) +
							licenseStatusPriority(a[1].latestStatus)),
				);
			}

			const [licenseType, license] = effectiveLicenses[0];
			effective = getSubscriptionPlan(
				convertLicenseTypeToPlanId(licenseType),
				isBundleLicenseType(licenseType),
				license.organizationId,
				new Date(license.latestStartDate),
				new Date(license.latestEndDate),
				license.latestStatus === 'cancelled',
			);
		}

		if (effective == null || getSubscriptionPlanPriority(actual.id) >= getSubscriptionPlanPriority(effective.id)) {
			effective = { ...actual };
		}

		this._lastValidatedDate = new Date();
		this.changeSubscription(
			{
				...this._subscription,
				plan: {
					actual: actual,
					effective: effective,
				},
				account: account,
			},
			{ store: true },
		);
	}

	private _sessionPromise: Promise<AuthenticationSession | null> | undefined;
	private _session: AuthenticationSession | null | undefined;

	@gate()
	@debug()
	private async ensureSession(createIfNeeded: boolean, force?: boolean): Promise<AuthenticationSession | undefined> {
		if (this._sessionPromise != null && this._session === undefined) {
			void (await this._sessionPromise);
		}

		if (!force && this._session != null) return this._session;
		if (this._session === null && !createIfNeeded) return undefined;

		if (this._sessionPromise === undefined) {
			this._sessionPromise = this.getOrCreateSession(createIfNeeded).then(
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
	private async getOrCreateSession(createIfNeeded: boolean): Promise<AuthenticationSession | null> {
		const scope = getLogScope();

		let session: AuthenticationSession | null | undefined;

		try {
			session = await authentication.getSession(authenticationProviderId, authenticationProviderScopes, {
				createIfNone: createIfNeeded,
				silent: !createIfNeeded,
			});
		} catch (ex) {
			session = null;

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				Logger.debug(scope, 'User declined authentication');
				await this.logoutCore();
				return null;
			}

			Logger.error(ex, scope);
		}

		if (session == null) {
			Logger.debug(scope, 'No valid session was found');
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

			Logger.debug(scope, `Account validation failed (${ex.statusCode ?? ex.original?.code})`);

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
								`Unable to sign in to your (${name}) GitKraken account. Please try again. If this issue persists, please contact support.${
									unauthorized ? '' : ` Error=${ex.message}`
								}`,
								confirm,
							);

							if (result === confirm) {
								void this.loginOrSignUp();
							}
						});
					}
				} else {
					session = session ?? null;

					// if ((ex.original as any)?.code !== 'ENOTFOUND') {
					// 	void window.showErrorMessage(
					// 		`Unable to sign in to your (${name}) GitKraken account right now. Please try again in a few minutes. If this issue persists, please contact support. Error=${ex.message}`,
					// 		'OK',
					// 	);
					// }
				}
			}
		}

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
					actual: getSubscriptionPlan(SubscriptionPlanId.Free, false, undefined),
					effective: getSubscriptionPlan(SubscriptionPlanId.Free, false, undefined),
				},
				account: undefined,
				state: SubscriptionState.Free,
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
						undefined,
						new Date(subscription.previewTrial.startedOn),
						new Date(subscription.previewTrial.expiresOn),
					),
				},
			};
		}

		subscription.state = computeSubscriptionState(subscription);
		assertSubscriptionState(subscription);

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

		void this.storeSubscription(subscription);

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

		void setContext('gitlens:plus', actual.id != SubscriptionPlanId.Free ? actual.id : undefined);
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
		} = this._subscription;

		if (effective.id === SubscriptionPlanId.Free) {
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

		this._statusBarSubscription.name = 'GitKraken Subscription';
		this._statusBarSubscription.command = Commands.ShowHomeView;

		if (account?.verified === false) {
			this._statusBarSubscription.text = `$(warning) ${effective.name} (Unverified)`;
			this._statusBarSubscription.backgroundColor = new ThemeColor(
				'statusBarItem.warningBackground' satisfies CoreColors,
			);
			this._statusBarSubscription.tooltip = new MarkdownString(
				trial
					? `**Please verify your email**\n\nYou must verify your email before you can start your **${effective.name}** trial.\n\nClick for details`
					: `**Please verify your email**\n\nYou must verify your email before you can use Pro features on privately hosted repos.\n\nClick for details`,
				true,
			);
		} else {
			const remaining = getSubscriptionTimeRemaining(this._subscription, 'days');

			this._statusBarSubscription.text = `${effective.name} (Trial)`;
			this._statusBarSubscription.tooltip = new MarkdownString(
				`You have ${pluralize('day', remaining ?? 0)} left in your free **${
					effective.name
				}** trial, which gives you additional access to Pro features on privately hosted repos.\n\nClick for details`,
				true,
			);
		}

		this._statusBarSubscription.show();
	}
}

function flattenSubscription(subscription: Optional<Subscription, 'state'> | undefined, prefix?: string) {
	if (subscription == null) return {};

	return {
		...flatten(subscription.account, {
			arrays: 'join',
			prefix: `${prefix ? `${prefix}.` : ''}account`,
			skipPaths: ['name', 'email'],
			skipNulls: true,
			stringify: true,
		}),
		...flatten(subscription.plan, {
			prefix: `${prefix ? `${prefix}.` : ''}subscription`,
			skipPaths: ['actual.name', 'effective.name'],
			skipNulls: true,
			stringify: true,
		}),
		...flatten(subscription.previewTrial, {
			prefix: `${prefix ? `${prefix}.` : ''}subscription.previewTrial`,
			skipPaths: ['actual.name', 'effective.name'],
			skipNulls: true,
			stringify: true,
		}),
		'subscription.state': subscription.state,
	};
}

function assertSubscriptionState(subscription: Optional<Subscription, 'state'>): asserts subscription is Subscription {}

interface GKLicenseInfo {
	readonly user: GKUser;
	readonly licenses: {
		readonly paidLicenses: Record<GKLicenseType, GKLicense>;
		readonly effectiveLicenses: Record<GKLicenseType, GKLicense>;
	};
	readonly orgIds?: string[];
}

interface GKLicense {
	readonly latestStatus: 'active' | 'canceled' | 'cancelled' | 'expired' | 'in_trial' | 'non_renewing' | 'trial';
	readonly latestStartDate: string;
	readonly latestEndDate: string;
	readonly organizationId: string | undefined;
}

type GKLicenseType =
	| 'gitlens-pro'
	| 'gitlens-teams'
	| 'gitlens-hosted-enterprise'
	| 'gitlens-self-hosted-enterprise'
	| 'gitlens-standalone-enterprise'
	| 'bundle-pro'
	| 'bundle-teams'
	| 'bundle-hosted-enterprise'
	| 'bundle-self-hosted-enterprise'
	| 'bundle-standalone-enterprise';

interface GKUser {
	readonly id: string;
	readonly name: string;
	readonly email: string;
	readonly status: 'activated' | 'pending';
	readonly createdDate: string;
	readonly firstGitLensCheckIn?: string;
}

function convertLicenseTypeToPlanId(licenseType: GKLicenseType): SubscriptionPlanId {
	switch (licenseType) {
		case 'gitlens-pro':
		case 'bundle-pro':
			return SubscriptionPlanId.Pro;
		case 'gitlens-teams':
		case 'bundle-teams':
			return SubscriptionPlanId.Teams;
		case 'gitlens-hosted-enterprise':
		case 'gitlens-self-hosted-enterprise':
		case 'gitlens-standalone-enterprise':
		case 'bundle-hosted-enterprise':
		case 'bundle-self-hosted-enterprise':
		case 'bundle-standalone-enterprise':
			return SubscriptionPlanId.Enterprise;
		default:
			return SubscriptionPlanId.FreePlus;
	}
}

function isBundleLicenseType(licenseType: GKLicenseType): boolean {
	switch (licenseType) {
		case 'bundle-pro':
		case 'bundle-teams':
		case 'bundle-hosted-enterprise':
		case 'bundle-self-hosted-enterprise':
		case 'bundle-standalone-enterprise':
			return true;
		default:
			return false;
	}
}

function licenseStatusPriority(status: GKLicense['latestStatus']): number {
	switch (status) {
		case 'active':
			return 100;
		case 'expired':
		case 'cancelled':
			return -100;
		case 'in_trial':
		case 'trial':
			return 1;
		case 'canceled':
		case 'non_renewing':
			return 0;
	}
}
