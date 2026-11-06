/**
 * Unattended GitKraken sign-in for E2E workers (#5682).
 *
 * The normal sign-in can't run under the test host: VS Code refuses the "open external website" dialog in tests,
 * and the staging and dev sites, which issue sign-in codes, sit behind Cloudflare Access. GitLens doesn't need a
 * code, though — it needs an account session, and the test account's site session token already is one: the
 * backend API accepts it as a bearer token, and the API is not gated. So a worker signs in with that token:
 *
 * 1. The harness evaluator rewrites the response to GitLens' own code exchange (`POST <api>/oauth/access_token`) to
 *    carry the token, for that one URL and only while signing in (see {@link installExchangeAnswer}).
 * 2. The `<scheme>://eamodio.gitlens/login?code=&state=` deep link is handed to the instance through the evaluator
 *    (`env.openExternal`), with a placeholder code. GitLens still sends the exchange — the backend refuses the
 *    placeholder, one failed exchange per sign-in — but reads the rewritten answer, receives the token, and signs
 *    in. Every other request — the account, check-in, the cloud integrations' provider tokens — goes to the backend
 *    API as is.
 * 3. Ready = "Sign Out" on GitLens Settings -> Account, plus "Manage <name>" in Cloud Integrations for every required
 *    provider (a disconnected provider shows "Connect").
 *
 * No site request is made (so no Cloudflare credential), and no new account token is minted: GitLens uses the
 * existing session, which signing out in the browser (or a password change) revokes. This is a stopgap until GitLens
 * offers a sign-in with a given token in its e2e builds; it rests on GitLens reading the exchange response through
 * `Response` `ok` / `status` / `json`, and the fixture fails loudly if that ever stops being true.
 *
 * The backend is chosen by `GK_E2E_ENV` (staging or dev; production only with `GK_E2E_ALLOW_PRODUCTION=1`); the
 * token must come from that backend's site (`stagingAccessToken` on staging). Secrets come from the environment only,
 * and this fixture never logs the token or any account text — its diagnostics use fixed vocabularies. The token does
 * enter the editor: it becomes GitLens' session there, as any sign-in's token would.
 */
import { randomUUID } from 'node:crypto';
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import type { GitLensPage } from '../pageObjects/gitLensPage.js';
import type { VSCodeEvaluator } from './vscodeEvaluator.js';

export const signInSecretEnv = 'GK_E2E_ACCESS_TOKEN_COOKIE';

/** GitKraken backends, as GitLens maps its `gitkraken.env` setting (`src/plus/gk/urlsProvider.ts`). */
export type GkEnvironment = 'production' | 'staging' | 'dev';

const defaultRequiredIntegrations = ['GitHub', 'GitLab', 'Bitbucket', 'Azure DevOps'];

/** GitLens' code exchange per backend (`src/plus/gk/urlsProvider.ts` + `authenticationConnection.ts`). */
const exchangeUrls: Record<GkEnvironment, string> = {
	production: 'https://api.gitkraken.dev/oauth/access_token',
	staging: 'https://staging-api.gitkraken.dev/oauth/access_token',
	dev: 'https://dev-api.gitkraken.dev/oauth/access_token',
};

export interface SignInOptions {
	/** Provider names that must show as connected (e.g. 'GitHub'). Defaults to {@link requiredIntegrations}. */
	requiredIntegrations?: string[];
}

/**
 * The backend this run signs in against: `GK_E2E_ENV` — `staging` or `dev`, or `production` only together with
 * `GK_E2E_ALLOW_PRODUCTION=1`. There is no default: production's test account shares its provider identities with
 * real use, so it has to be asked for explicitly. A token from one backend is unknown to another's API, so the token
 * and GitLens must point at the same one.
 */
export function gkEnvironment(): GkEnvironment {
	const value = (process.env.GK_E2E_ENV ?? '').trim().toLowerCase();
	if (value === 'staging' || value === 'dev') return value;
	if (value === 'production' || value === 'prod') {
		if (process.env.GK_E2E_ALLOW_PRODUCTION === '1') return 'production';

		throw new Error('GK_E2E_ENV=production also needs GK_E2E_ALLOW_PRODUCTION=1');
	}

	throw new Error(
		`GK_E2E_ENV must be staging or dev, or production with GK_E2E_ALLOW_PRODUCTION=1 (got "${value || '<unset>'}")`,
	);
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
	const token = sessionToken();
	const required = options?.requiredIntegrations ?? requiredIntegrations();
	const env = gkEnvironment();

	if (env !== 'production') {
		// GitLens honours `gitkraken.env` only in a pre-release (date-versioned) build or in Development mode, and the
		// harness runs extensions in Test mode — a release-versioned build would silently stay on production, where the
		// token is unknown. Say so up front.
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
	await evaluate(installExchangeAnswer, token, exchangeUrls[env]);
	let settings: FrameLocator | null | undefined;
	try {
		await evaluate(
			// The host's own scheme (`vscode-insiders`, a fork's) — a `vscode://` link would reach another editor, or none
			async (vscode, query: string) =>
				vscode.env.openExternal(vscode.Uri.parse(`${vscode.env.uriScheme}://eamodio.gitlens/login?${query}`)),
			// Placeholders: the exchange is answered locally, and GitLens doesn't check the state on this path
			`code=${randomUUID()}&state=${randomUUID()}`,
		);

		// Signing in opens GitLens Settings -> Account by itself
		settings = await gitlens.getGitLensWebview('GitLens Settings', 'webviewPanel', 60_000);
		if (settings == null) throw new Error('GitLens Settings did not open after the sign-in deep link');

		// `locator.waitFor`, not `expect`: a failed matcher puts an ARIA snapshot of its target into Playwright's
		// error-context — here the Account page, with the account's name and e-mail
		await settings.getByText('Sign Out', { exact: true }).first().waitFor({ state: 'visible', timeout: 60_000 });
		log(
			`[${env}] signed in after ${Date.now() - start} ms; plan: ${JSON.stringify(await accountPlanLabels(settings))}`,
		);
	} catch (ex) {
		const exchange = await evaluate(removeExchangeAnswer).catch(() => undefined);
		if (exchange?.seen === 0) {
			throw new Error(
				'GitLens never sent the code exchange: the login deep link did not reach it, or it could not send the request',
				{ cause: ex },
			);
		}
		if (exchange?.answered === 0) {
			throw new Error(
				'GitLens sent the code exchange but never read the answer: it no longer reads the exchange response through `Response` ok/status/json, so the token sign-in needs updating',
				{ cause: ex },
			);
		}

		const words = settings == null ? ['<no GitLens Settings webview>'] : await settingsStateWords(settings);
		log(`sign-in FAILED — settings state: ${JSON.stringify(words)}`);
		throw ex;
	}

	await evaluate(removeExchangeAnswer);

	try {
		await settings.getByText('Cloud Integrations', { exact: true }).first().click();
		for (const name of required) {
			try {
				await settings
					.getByText(`Manage ${name}`, { exact: true })
					.first()
					.waitFor({ state: 'attached', timeout: 30_000 });
			} catch {
				throw new Error(`${name} is not connected on the test account`);
			}
		}
		log(`integrations connected after ${Date.now() - start} ms: ${required.join(', ')}`);
	} catch (ex) {
		log(`sign-in FAILED — settings state: ${JSON.stringify(await settingsStateWords(settings))}`);
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

/**
 * The session token from {@link signInSecretEnv}: the cookie's value only. Pasting the whole DevTools row (name,
 * a tab, the value) is the usual mistake, so whitespace inside is refused — without echoing the value.
 */
function sessionToken(): string {
	const value = process.env[signInSecretEnv]?.trim();
	if (!value) throw new Error(`${signInSecretEnv} is not set`);
	if (/\s/.test(value) || value.includes(';')) {
		throw new Error(
			`${signInSecretEnv} must hold the cookie's value only (it contains whitespace or ';' — a whole cookie row or header?)`,
		);
	}

	return value;
}

/** What {@link installExchangeAnswer} replaced on `Response.prototype`, and how often the exchange was seen and answered. */
type ExchangeAnswer = {
	ok: PropertyDescriptor;
	status: PropertyDescriptor;
	json: (this: Response) => Promise<unknown>;
	seen: number;
	answered: number;
};

/**
 * Runs in the extension host (through the evaluator), so it must be self-contained. Rewrites the response to GitLens'
 * code exchange — exactly `url` — into a success carrying `{ access_token: token }`, leaving every other response
 * untouched. Counts the responses seen (GitLens reads `ok` first) and answered, so a failure can tell "never sent"
 * from "read differently". GitLens' fetch is Node's, whose responses are `globalThis.Response` instances.
 */
function installExchangeAnswer(_vscode: unknown, token: string, url: string): void {
	const g = globalThis as typeof globalThis & { __gkE2eExchange?: ExchangeAnswer };
	if (g.__gkE2eExchange != null) return;

	const proto = g.Response.prototype;
	const ok = Object.getOwnPropertyDescriptor(proto, 'ok')!;
	const status = Object.getOwnPropertyDescriptor(proto, 'status')!;
	const state: ExchangeAnswer = { ok: ok, status: status, json: proto.json, seen: 0, answered: 0 };
	g.__gkE2eExchange = state;

	const isExchange = (rsp: Response): boolean => rsp.url === url;
	Object.defineProperty(proto, 'ok', {
		configurable: true,
		get: function (this: Response) {
			if (!isExchange(this)) return ok.get!.call(this) as boolean;

			state.seen++;
			return true;
		},
	});
	Object.defineProperty(proto, 'status', {
		configurable: true,
		get: function (this: Response) {
			return isExchange(this) ? 200 : (status.get!.call(this) as number);
		},
	});
	proto.json = function (this: Response) {
		if (!isExchange(this)) return state.json.call(this);

		state.answered++;
		return Promise.resolve({ access_token: token });
	};
}

/** Restores `Response` and returns how often the exchange was seen and answered (runs in the extension host). */
function removeExchangeAnswer(): { seen: number; answered: number } | undefined {
	const g = globalThis as typeof globalThis & { __gkE2eExchange?: ExchangeAnswer };
	const state = g.__gkE2eExchange;
	if (state == null) return undefined;

	const proto = g.Response.prototype;
	Object.defineProperty(proto, 'ok', state.ok);
	Object.defineProperty(proto, 'status', state.status);
	proto.json = state.json;
	delete g.__gkE2eExchange;
	return { seen: state.seen, answered: state.answered };
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
