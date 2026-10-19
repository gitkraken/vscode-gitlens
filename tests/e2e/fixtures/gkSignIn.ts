/**
 * Unattended GitKraken sign-in for E2E workers (#5682).
 *
 * The normal sign-in can't run under the test host: VS Code refuses the "open external website" dialog in tests.
 * Instead a worker signs in by itself:
 *
 * 1. Our own `state` -> `GET <site>/login` with the test account's session cookie and `redirect: manual`; the
 *    sign-in code is in the `Location` of the first 307 (no browser).
 * 2. The `vscode://eamodio.gitlens/login?code=&state=` deep link is handed to the instance through the harness
 *    evaluator (`env.openExternal`); GitLens exchanges the code and signs in.
 * 3. Ready = "Sign Out" on GitLens Settings -> Account, plus "Manage <name>" in Cloud Integrations for every required
 *    provider (a disconnected provider shows "Connect").
 *
 * The backend is chosen by `GK_E2E_ENV` (production, staging or dev); the cookie must come from that backend's site.
 * Secrets come from the environment only and are never logged, traced or attached — nor is the code, the state or
 * any account text: diagnostics use fixed vocabularies.
 *
 * Every sign-in mints a new GitLens token for the test account, and the backend neither expires nor revokes those
 * tokens. Sign in only in the specs that need an account, and never sign out (it is local-only anyway).
 */
import { randomUUID } from 'node:crypto';
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import { expect } from '@playwright/test';
import type { GitLensPage } from '../pageObjects/gitLensPage.js';
import type { VSCodeEvaluator } from './vscodeEvaluator.js';

export const signInSecretEnv = 'GK_E2E_ACCESS_TOKEN_COOKIE';

/** GitKraken backends, as GitLens maps its `gitkraken.env` setting (`src/plus/gk/urlsProvider.ts`). */
export type GkEnvironment = 'production' | 'staging' | 'dev';

const siteHosts: Record<GkEnvironment, string> = {
	production: 'gitkraken.dev',
	staging: 'staging.gitkraken.dev',
	dev: 'dev.gitkraken.dev',
};

/**
 * Each backend's site session cookie. All of them are set on `.gitkraken.dev`, so the staging site also shows
 * production's `accessToken` — which is not the staging session. The dev name is unconfirmed;
 * `GK_E2E_ACCESS_TOKEN_COOKIE_NAME` overrides.
 */
const sessionCookieNames: Record<GkEnvironment, string> = {
	production: 'accessToken',
	staging: 'stagingAccessToken',
	dev: 'devAccessToken',
};

const defaultRequiredIntegrations = ['GitHub', 'GitLab', 'Bitbucket', 'Azure DevOps'];

export interface SignInOptions {
	/** Provider names that must show as connected (e.g. 'GitHub'). Defaults to {@link requiredIntegrations}. */
	requiredIntegrations?: string[];
}

/**
 * The backend this run signs in against: `GK_E2E_ENV` (default `production`). A code issued by one backend does not
 * exchange on another's API, so the cookie, the code request and GitLens must all point at the same one.
 */
export function gkEnvironment(): GkEnvironment {
	const value = (process.env.GK_E2E_ENV ?? '').trim().toLowerCase();
	if (value === '' || value === 'production' || value === 'prod') return 'production';
	if (value === 'staging' || value === 'dev') return value;

	throw new Error(`GK_E2E_ENV must be production, staging or dev (got "${value}")`);
}

/** User settings a signed-in worker needs for {@link gkEnvironment} (none for production). */
export function gkEnvironmentUserSettings(): Record<string, unknown> {
	const env = gkEnvironment();
	return env === 'production' ? {} : { 'gitkraken.env': env };
}

/** Whether this run can sign in. Specs gate on it with `test.skip(!canSignIn(), …)`. */
export function canSignIn(): boolean {
	const has = Boolean(process.env[signInSecretEnv]);
	if (!has && process.env.E2E_REQUIRE_SIGNIN) {
		throw new Error(`${signInSecretEnv} is required (E2E_REQUIRE_SIGNIN) but not set`);
	}

	return has;
}

/**
 * Providers that must show as connected: `E2E_REQUIRED_INTEGRATIONS` (comma-separated) or the cloud git hosts.
 * `none` checks the sign-in alone.
 */
export function requiredIntegrations(): string[] {
	const value = (process.env.E2E_REQUIRED_INTEGRATIONS ?? '').trim();
	if (value.toLowerCase() === 'none') return [];

	const names = value
		.split(',')
		.map(s => s.trim())
		.filter(Boolean);
	return names.length ? names : defaultRequiredIntegrations;
}

export async function signInToGitKraken(
	evaluate: VSCodeEvaluator['evaluate'],
	gitlens: GitLensPage,
	options?: SignInOptions,
): Promise<void> {
	const cookie = process.env[signInSecretEnv];
	if (!cookie) throw new Error(`${signInSecretEnv} is not set`);

	const required = options?.requiredIntegrations ?? requiredIntegrations();
	const env = gkEnvironment();

	if (env !== 'production') {
		// GitLens honours `gitkraken.env` only in a pre-release (date-versioned) build or in Development mode, and the
		// harness runs extensions in Test mode — a release-versioned build would silently stay on production and the
		// exchange would fail. Say so up front.
		const version = await evaluate(
			vscode => vscode.extensions.getExtension('eamodio.gitlens')?.packageJSON.version as string | undefined,
		);
		if (!(Number(version?.split('.')[0]) > 2020)) {
			throw new Error(
				`GK_E2E_ENV=${env} needs a pre-release build (GitLens ${version ?? '?'} ignores gitkraken.env): run \`pnpm run patch-pre\` before bundling`,
			);
		}
	}

	const start = Date.now();
	const state = randomUUID();
	const code = await getSignInCodeWithRetry(env, cookie, state);
	log(`[${env}] code received in ${Date.now() - start} ms`);

	const delivered = Date.now();
	await evaluate(
		// The host's own scheme (`vscode-insiders`, a fork's) — a `vscode://` link would reach another editor, or none
		async (vscode, query: string) =>
			vscode.env.openExternal(vscode.Uri.parse(`${vscode.env.uriScheme}://eamodio.gitlens/login?${query}`)),
		`code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
	);

	// Signing in opens GitLens Settings -> Account by itself
	const settings = await gitlens.getGitLensWebview('GitLens Settings', 'webviewPanel', 60_000);
	try {
		if (settings == null) throw new Error('GitLens Settings did not open after the sign-in deep link');

		await expect(settings.getByText('Sign Out', { exact: true }).first(), 'signed in').toBeVisible({
			timeout: 60_000,
		});
		log(`signed in after ${Date.now() - delivered} ms; plan: ${JSON.stringify(await accountPlanLabels(settings))}`);

		await settings.getByText('Cloud Integrations', { exact: true }).first().click();
		for (const name of required) {
			await expect(
				settings.getByText(`Manage ${name}`, { exact: true }).first(),
				`${name} connected`,
			).toBeAttached({ timeout: 30_000 });
		}
		log(`integrations connected after ${Date.now() - delivered} ms: ${required.join(', ')}`);
	} catch (ex) {
		const words = settings == null ? ['<no GitLens Settings webview>'] : await settingsStateWords(settings);
		log(`sign-in FAILED — settings state: ${JSON.stringify(words)}`);
		throw ex;
	}

	// Leave the workbench as a signed-out worker would have it
	await evaluate(async vscode => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});
}

function log(message: string): void {
	console.log(`[gk-sign-in] ${message}`);
}

function sessionCookieName(env: GkEnvironment): string {
	return process.env.GK_E2E_ACCESS_TOKEN_COOKIE_NAME?.trim() || sessionCookieNames[env];
}

/**
 * The code arrives in the first redirect of this request, so `redirect_uri` only selects the flow and never delivers
 * anything here — it stays the value the site is known to accept.
 */
function loginUrl(host: string, state: string): string {
	return `https://${host}/login?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(
		'vscode://eamodio.gitlens/did-authenticate',
	)}&source=gitlens&ide=code`;
}

/**
 * Headers for the sign-in code request. Off production the site sits behind Cloudflare Access (its API does not), so
 * the request also carries an Access credential: a service token (`GK_E2E_CF_ACCESS_CLIENT_ID` /
 * `GK_E2E_CF_ACCESS_CLIENT_SECRET`) or a browser's short-lived `CF_Authorization` cookie (`GK_E2E_CF_AUTHORIZATION`).
 * Never sent to production.
 */
function siteRequestHeaders(env: GkEnvironment, cookie: string): Record<string, string> {
	const cookies = [`${sessionCookieName(env)}=${cookie}`];
	const headers: Record<string, string> = {};

	if (env !== 'production') {
		const id = process.env.GK_E2E_CF_ACCESS_CLIENT_ID;
		const secret = process.env.GK_E2E_CF_ACCESS_CLIENT_SECRET;
		if (id && secret) {
			headers['CF-Access-Client-Id'] = id;
			headers['CF-Access-Client-Secret'] = secret;
		}

		const cfAuthorization = process.env.GK_E2E_CF_AUTHORIZATION;
		if (cfAuthorization) {
			cookies.push(`CF_Authorization=${cfAuthorization}`);
		}
	}

	headers.Cookie = cookies.join('; ');
	return headers;
}

class SignInCodeError extends Error {
	constructor(
		message: string,
		readonly retryable: boolean,
	) {
		super(message);
	}
}

/**
 * Asking for a code is retried (network blips, 5xx); the exchange is not — a token is minted only when GitLens
 * exchanges the code, so retrying here costs no extra token.
 */
async function getSignInCodeWithRetry(
	env: GkEnvironment,
	cookie: string,
	state: string,
	attempts = 3,
): Promise<string> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await getSignInCode(env, cookie, state);
		} catch (ex) {
			if (attempt >= attempts || (ex instanceof SignInCodeError && !ex.retryable)) throw ex;

			log(`code request failed (attempt ${attempt}/${attempts}), retrying`);
			await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
		}
	}
}

async function getSignInCode(env: GkEnvironment, cookie: string, state: string): Promise<string> {
	const host = siteHosts[env];

	let rsp: Response;
	try {
		rsp = await fetch(loginUrl(host, state), { redirect: 'manual', headers: siteRequestHeaders(env, cookie) });
	} catch (ex) {
		// Network-level failure (DNS, TLS, reset): report the error kind only — the URL carries the state
		const cause =
			ex instanceof Error && ex.cause instanceof Error
				? ((ex.cause as { code?: string }).code ?? ex.cause.name)
				: undefined;
		throw new SignInCodeError(
			`${host} sign-in code request failed (${ex instanceof Error ? ex.name : 'error'}${cause ? `: ${cause}` : ''})`,
			true,
		);
	}

	const location = rsp.headers.get('location');
	const url = location != null ? new URL(location, `https://${host}`) : undefined;
	if (url != null && url.host !== host) {
		// Never follow a redirect across hosts: the cookie belongs to another backend's site, or the flow moved
		throw new SignInCodeError(
			url.host.endsWith('.cloudflareaccess.com')
				? `${host} is behind Cloudflare Access (${url.host}); set GK_E2E_CF_ACCESS_CLIENT_ID/_SECRET (service token) or GK_E2E_CF_AUTHORIZATION`
				: `${host} redirected to another host (${url.host}); is the cookie from the ${host} site?`,
			false,
		);
	}

	const code = url?.searchParams.get('code');
	if (!code) {
		// Host and path only — the query carries the state (and the code when there is one). A redirect without a
		// code (or a 4xx) means the cookie or the flow is wrong, so only a 5xx is worth retrying
		const target = url != null ? `${url.host}${url.pathname}` : `no Location; ${await describePage(rsp)}`;
		throw new SignInCodeError(
			`${host} did not return a sign-in code (HTTP ${rsp.status} -> ${target}); the cookie may have been signed out or rotated`,
			rsp.status >= 500,
		);
	}

	return code;
}

/**
 * What a page answer (no redirect) looks like, without its content: type, size, `<title>`, and whether it carries a
 * sign-in form or a client-side redirect — tells "the session was not recognized" from "the flow is client-side".
 */
async function describePage(rsp: Response): Promise<string> {
	try {
		const body = await rsp.text();
		const title = /<title[^>]*>([^<]{0,80})<\/title>/i.exec(body)?.[1]?.trim();
		const traits = [
			/type=["']?password/i.test(body) && 'password field',
			/sign[ -]?in|log[ -]?in/i.test(body) && 'sign-in words',
			/window\.location|location\.(href|replace)|http-equiv=["']?refresh/i.test(body) && 'client-side redirect',
			/__NEXT_DATA__|id=["']root["']|id=["']app["']/i.test(body) && 'SPA shell',
		].filter(Boolean);
		return `body: ${rsp.headers.get('content-type') ?? '?'}, ${body.length} chars, title ${JSON.stringify(title ?? '')}, ${traits.join(', ') || 'no traits'}`;
	} catch {
		return 'body: unreadable';
	}
}

/**
 * The plan labels on the Account page, so a later failure shows what the account looked like (plans live per backend,
 * and a trial expires on its own). Exact labels only — the page also carries plan-comparison copy, so this is a hint,
 * not a verdict.
 */
async function accountPlanLabels(settings: FrameLocator): Promise<string[]> {
	const label =
		/^(GitLens )?(Community|Pro|Advanced|Teams|Business|Enterprise|Student)( Trial| \(Trial\)| Preview)?$/;
	return (await settingsTexts(settings)).filter(s => label.test(s)).slice(0, 6);
}

/** Only fixed state words survive — never e-mails, names or values. */
async function settingsStateWords(settings: FrameLocator): Promise<string[]> {
	const state =
		/^(Sign Out|Sign In|Not signed in|Signed in on this device|Manage [A-Za-z ]+|Connect|Cloud Integrations|\d+\/\d+)$/;
	const texts = await settingsTexts(settings);
	return texts.length ? texts.filter(s => state.test(s)) : ['<settings unreadable>'];
}

/** The distinct text nodes of the settings page, shadow roots included. */
async function settingsTexts(settings: FrameLocator): Promise<string[]> {
	try {
		return await settings.locator('body').evaluate(root => {
			const parts = new Set<string>();
			const walk = (node: Node): void => {
				if (node.nodeType === Node.TEXT_NODE) {
					const text = node.textContent?.trim();
					if (text) {
						parts.add(text);
					}
				}

				const shadowRoot = (node as Element).shadowRoot;
				if (shadowRoot) {
					shadowRoot.childNodes.forEach(walk);
				}

				node.childNodes.forEach(walk);
			};
			walk(root);
			return [...parts];
		});
	} catch {
		return [];
	}
}
