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
	Uri,
	window,
} from 'vscode';
import { fetch, getProxyAgent } from '@env/fetch';
import { getPlatform } from '@env/platform';
import { Commands, ContextKeys } from '../../constants';
import type { Container } from '../../container';
import { setContext } from '../../context';
import { AccountValidationError } from '../../errors';
import type { RepositoriesChangeEvent } from '../../git/gitProviderService';
import { showMessage } from '../../messages';
import type { Subscription } from '../../subscription';
import {
	computeSubscriptionState,
	getSubscriptionPlan,
	getSubscriptionPlanName,
	getSubscriptionPlanPriority,
	getSubscriptionTimeRemaining,
	getTimeRemaining,
	isSubscriptionExpired,
	isSubscriptionPaid,
	isSubscriptionTrial,
	SubscriptionPlanId,
	SubscriptionState,
} from '../../subscription';
import { executeCommand, registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { createFromDateDelta } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import type { Deferrable } from '../../system/function';
import { debounce, once } from '../../system/function';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { flatten } from '../../system/object';
import { pluralize } from '../../system/string';
import { openWalkthrough } from '../../system/utils';
import { satisfies } from '../../system/version';
import { ensurePlusFeaturesEnabled } from './utils';

// TODO: What user-agent should we use?
const userAgent = 'Visual-Studio-Code-GitLens';

export interface SubscriptionChangeEvent {
	readonly current: Subscription;
	readonly previous: Subscription;
	readonly etag: number;
}

export class SubscriptionService implements Disposable {
	private static authenticationProviderId = 'gitlens+';
	private static authenticationScopes = ['gitlens'];

	private _onDidChange = new EventEmitter<SubscriptionChangeEvent>();
	get onDidChange(): Event<SubscriptionChangeEvent> {
		return this._onDidChange.event;
	}

	private _disposable: Disposable;
	private _subscription!: Subscription;
	private _statusBarSubscription: StatusBarItem | undefined;
	private _validationTimer: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly container: Container, previousVersion: string | undefined) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			this.container.subscriptionAuthentication.onDidChangeSessions(
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
		// Resets the preview trial state on the upgrade to 13.0
		if (subscription != null && satisfies(previousVersion, '< 13.0')) {
			subscription.previewTrial = undefined;
		}

		this.changeSubscription(subscription, true);
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
		void this.validate();
	}

	@memoize()
	private get baseApiUri(): Uri {
		const { env } = this.container;
		if (env === 'staging') {
			return Uri.parse('https://stagingapi.gitkraken.com');
		}

		if (env === 'dev') {
			return Uri.parse('https://devapi.gitkraken.com');
		}

		return Uri.parse('https://api.gitkraken.com');
	}

	@memoize()
	private get baseAccountUri(): Uri {
		const { env } = this.container;
		if (env === 'staging') {
			return Uri.parse('https://stagingapp.gitkraken.com');
		}

		if (env === 'dev') {
			return Uri.parse('https://devapp.gitkraken.com');
		}

		return Uri.parse('https://app.gitkraken.com');
	}

	@memoize()
	private get baseSiteUri(): Uri {
		const { env } = this.container;
		if (env === 'staging') {
			return Uri.parse('https://staging.gitkraken.com');
		}

		if (env === 'dev') {
			return Uri.parse('https://dev.gitkraken.com');
		}

		return Uri.parse('https://gitkraken.com');
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
			registerCommand(Commands.PlusLearn, openToSide => this.learn(openToSide)),
			registerCommand(Commands.PlusLoginOrSignUp, () => this.loginOrSignUp()),
			registerCommand(Commands.PlusLogout, () => this.logout()),

			registerCommand(Commands.PlusStartPreviewTrial, () => this.startPreviewTrial()),
			registerCommand(Commands.PlusManage, () => this.manage()),
			registerCommand(Commands.PlusPurchase, () => this.purchase()),

			registerCommand(Commands.PlusResendVerification, () => this.resendVerification()),
			registerCommand(Commands.PlusValidate, () => this.validate()),

			registerCommand(Commands.PlusShowPlans, () => this.showPlans()),

			registerCommand(Commands.PlusHide, () => configuration.updateEffective('plusFeatures.enabled', false)),
			registerCommand(Commands.PlusRestore, () => configuration.updateEffective('plusFeatures.enabled', true)),

			registerCommand('gitlens.plus.reset', () => this.logout(true)),
		];
	}

	async getSubscription(cached = false): Promise<Subscription> {
		const promise = this.ensureSession(false);
		if (!cached) {
			void (await promise);
		}
		return this._subscription;
	}

	@debug()
	learn(openToSide: boolean = true): void {
		void openWalkthrough(this.container.context.extension.id, 'gitlens.plus', undefined, openToSide);
	}

	@log()
	async loginOrSignUp(): Promise<boolean> {
		if (!(await ensurePlusFeaturesEnabled())) return false;

		// Abort any waiting authentication to ensure we can start a new flow
		await this.container.subscriptionAuthentication.abort();
		void this.showHomeView();

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
					`Before you can access ${effective.name}, you must verify your email address.`,
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
					} (Trial). You now have additional access to GitLens+ features on private repos for ${pluralize(
						'more day',
						remaining ?? 0,
					)}.`,
					{ modal: true },
					confirm,
					learn,
				);

				if (result === learn) {
					this.learn();
				}
			} else if (isSubscriptionPaid(this._subscription)) {
				void window.showInformationMessage(
					`Welcome to ${actual.name}. You now have additional access to GitLens+ features on private repos.`,
					'OK',
				);
			} else {
				void window.showInformationMessage(
					`Welcome to ${actual.name}. You have access to GitLens+ features on local & public repos.`,
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
		if (this._validationTimer != null) {
			clearInterval(this._validationTimer);
			this._validationTimer = undefined;
		}

		await this.container.subscriptionAuthentication.abort();

		this._sessionPromise = undefined;
		if (this._session != null) {
			void this.container.subscriptionAuthentication.removeSession(this._session.id);
			this._session = undefined;
		} else {
			// Even if we don't have a session, make sure to remove any other matching sessions
			void this.container.subscriptionAuthentication.removeSessionsByScopes(
				SubscriptionService.authenticationScopes,
			);
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
		void env.openExternal(this.baseAccountUri);
	}

	@log()
	async purchase(): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this._subscription.account == null) {
			this.showPlans();
		} else {
			void env.openExternal(
				Uri.joinPath(this.baseAccountUri, 'purchase-license').with({ query: 'product=gitlens&license=PRO' }),
			);
		}
		await this.showHomeView();
	}

	@gate()
	@log()
	async resendVerification(): Promise<boolean> {
		if (this._subscription.account?.verified) return true;

		const scope = getLogScope();

		void this.showHomeView(true);

		const session = await this.ensureSession(false);
		if (session == null) return false;

		try {
			const rsp = await fetch(Uri.joinPath(this.baseApiUri, 'resend-email').toString(), {
				method: 'POST',
				agent: getProxyAgent(),
				headers: {
					Authorization: `Bearer ${session.accessToken}`,
					'User-Agent': userAgent,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ id: session.account.id }),
			});

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
				await this.validate();
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
	async showHomeView(silent: boolean = false): Promise<void> {
		if (silent && !configuration.get('plusFeatures.enabled', undefined, true)) return;

		if (!this.container.homeView.visible) {
			await executeCommand(Commands.ShowHomeView);
		}
	}

	private showPlans(): void {
		void env.openExternal(Uri.joinPath(this.baseSiteUri, 'gitlens/pricing'));
	}

	@gate()
	@log()
	async startPreviewTrial(silent?: boolean): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		let { plan, previewTrial } = this._subscription;
		if (previewTrial != null) {
			void this.showHomeView();

			if (!silent && plan.effective.id === SubscriptionPlanId.Free) {
				const confirm: MessageItem = { title: 'Extend Your Trial', isCloseAffordance: true };
				const cancel: MessageItem = { title: 'Cancel' };
				const result = await window.showInformationMessage(
					'Your 3-day trial has ended.\nExtend your GitLens Pro trial to continue to use GitLens+ features on private repos, free for an additional 7-days.',
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

		const startedOn = new Date();

		let days;
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
			const confirm: MessageItem = { title: 'OK', isCloseAffordance: true };
			const learn: MessageItem = { title: 'Learn More' };
			const result = await window.showInformationMessage(
				`You have started a ${days}-day GitLens Pro trial of GitLens+ features on private repos.`,
				{ modal: true },
				confirm,
				learn,
			);

			if (result === learn) {
				this.learn();
			}
		}
	}

	@gate()
	@log()
	async validate(): Promise<void> {
		const scope = getLogScope();

		const session = await this.ensureSession(false);
		if (session == null) {
			this.changeSubscription(this._subscription);
			return;
		}

		try {
			await this.checkInAndValidate(session);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
		}
	}

	private _lastCheckInDate: Date | undefined;
	@gate<SubscriptionService['checkInAndValidate']>(s => s.account.id)
	private async checkInAndValidate(session: AuthenticationSession, showSlowProgress: boolean = false): Promise<void> {
		if (!showSlowProgress) return this.checkInAndValidateCore(session);

		const validating = this.checkInAndValidateCore(session);
		const result = await Promise.race([
			validating,
			new Promise<boolean>(resolve => setTimeout(resolve, 3000, true)),
		]);

		if (result) {
			await window.withProgress(
				{
					location: ProgressLocation.Notification,
					title: 'Validating your GitLens+ account...',
				},
				() => validating,
			);
		}
	}

	@debug<SubscriptionService['checkInAndValidate']>({ args: { 0: s => s?.account.label } })
	private async checkInAndValidateCore(session: AuthenticationSession): Promise<void> {
		const scope = getLogScope();

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

			const rsp = await fetch(Uri.joinPath(this.baseApiUri, 'gitlens/checkin').toString(), {
				method: 'POST',
				agent: getProxyAgent(),
				headers: {
					Authorization: `Bearer ${session.accessToken}`,
					'User-Agent': userAgent,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(checkInData),
			});

			if (!rsp.ok) {
				throw new AccountValidationError('Unable to validate account', undefined, rsp.status, rsp.statusText);
			}

			const data: GKLicenseInfo = await rsp.json();
			this.validateSubscription(data);
			this._lastCheckInDate = new Date();
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
		this._validationTimer = setInterval(() => {
			if (this._lastCheckInDate == null || this._lastCheckInDate.getDate() !== new Date().getDate()) {
				void this.ensureSession(false, true);
			}
		}, 1000 * 60 * 60 * 6);
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
				data.user.firstGitLensCheckIn != null ? new Date(data.user.firstGitLensCheckIn) : undefined,
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

		if (effective == null) {
			effective = { ...actual };
		} else if (getSubscriptionPlanPriority(actual.id) >= getSubscriptionPlanPriority(effective.id)) {
			effective = { ...actual };
		}

		this.changeSubscription({
			...this._subscription,
			plan: {
				actual: actual,
				effective: effective,
			},
			account: account,
		});
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
			session = await authentication.getSession(
				SubscriptionService.authenticationProviderId,
				SubscriptionService.authenticationScopes,
				{
					createIfNone: createIfNeeded,
					silent: !createIfNeeded,
				},
			);
		} catch (ex) {
			session = null;

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				Logger.debug(scope, 'User declined authentication');
				await this.logoutCore();
				return null;
			}

			Logger.error(ex, scope);
		}

		// If we didn't find a session, check if we could migrate one from the GK auth provider
		if (session === undefined) {
			session = await this.container.subscriptionAuthentication.tryMigrateSession();
		}

		if (session == null) {
			Logger.debug(scope, 'No valid session was found');
			await this.logoutCore();
			return session ?? null;
		}

		try {
			await this.checkInAndValidate(session, createIfNeeded);
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
								`Unable to sign in to your (${name}) GitLens+ account. Please try again. If this issue persists, please contact support.${
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
					// 		`Unable to sign in to your (${name}) GitLens+ account right now. Please try again in a few minutes. If this issue persists, please contact support. Error=${ex.message}`,
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
		silent: boolean = false,
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

		// Check if the preview has expired, if not apply it
		if (subscription.previewTrial != null && (getTimeRemaining(subscription.previewTrial.expiresOn) ?? 0) > 0) {
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

		subscription.state = computeSubscriptionState(subscription);
		assertSubscriptionState(subscription);

		const previous = this._subscription as typeof this._subscription | undefined; // Can be undefined here, since we call this in the constructor
		// Check the previous and new subscriptions are exactly the same
		const matches = previous != null && JSON.stringify(previous) === JSON.stringify(subscription);

		// If the previous and new subscriptions are exactly the same, kick out
		if (matches) return;

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

		setTimeout(() => {
			if (
				subscription?.account != null &&
				subscription.plan.actual.id === SubscriptionPlanId.Pro &&
				!subscription.plan.actual.bundle &&
				new Date(subscription.plan.actual.startedOn) >= new Date('2022-02-28T00:00:00.000Z') &&
				new Date(subscription.plan.actual.startedOn) <= new Date('2022-04-31T00:00:00.000Z')
			) {
				showRenewalDiscountNotification(this.container);
			}
		}, 5000);

		if (!silent) {
			this.updateContext();

			if (previous != null) {
				this._onDidChange.fire({ current: subscription, previous: previous, etag: this._etag });
			}
		}
	}

	private getStoredSubscription(): Subscription | undefined {
		const storedSubscription = this.container.storage.get('premium:subscription');

		const subscription = storedSubscription?.data;
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
			data: subscription,
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
			this._cancellationSource.dispose();
		}
		this._cancellationSource = new CancellationTokenSource();

		void this._updateAccessContextDebounced(this._cancellationSource.token);
		this.updateStatusBar();

		const {
			plan: { actual },
			state,
		} = this._subscription;

		void setContext(ContextKeys.Plus, actual.id != SubscriptionPlanId.Free ? actual.id : undefined);
		void setContext(ContextKeys.PlusState, state);
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

		void setContext(ContextKeys.PlusEnabled, Boolean(allowed) || plusFeatures);
		void setContext(ContextKeys.PlusRequired, allowed === false);
		void setContext(ContextKeys.PlusDisallowedRepos, disallowedRepos);
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

		this._statusBarSubscription.name = 'GitLens+ Subscription';
		this._statusBarSubscription.command = Commands.ShowHomeView;

		if (account?.verified === false) {
			this._statusBarSubscription.text = `$(warning) ${effective.name} (Unverified)`;
			this._statusBarSubscription.backgroundColor = new ThemeColor('statusBarItem.warningBackground');
			this._statusBarSubscription.tooltip = new MarkdownString(
				trial
					? `**Please verify your email**\n\nBefore you can start your **${effective.name}** trial, please verify your email address.\n\nClick for details`
					: `**Please verify your email**\n\nBefore you can also use GitLens+ features on private repos, please verify your email address.\n\nClick for details`,
				true,
			);
		} else {
			const remaining = getSubscriptionTimeRemaining(this._subscription, 'days');

			this._statusBarSubscription.text = `${effective.name} (Trial)`;
			this._statusBarSubscription.tooltip = new MarkdownString(
				`You have ${pluralize('day', remaining ?? 0)} left in your **${
					effective.name
				}** trial, which gives you additional access to GitLens+ features on private repos.\n\nClick for details`,
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

function showRenewalDiscountNotification(container: Container): void {
	if (container.storage.get('plus:renewalDiscountNotificationShown', false)) return;

	void container.storage.store('plus:renewalDiscountNotificationShown', true);

	void showMessage(
		'info',
		'60% off your GitLens Pro renewal — as a thank you for being an early adopter of GitLens+. So there will be no change to your price for an additional year!',
		undefined,
		undefined,
	);
}
