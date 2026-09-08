import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('WIP stats announcements use complete localized presence templates', async () => {
	const result = await build({
		stdin: {
			contents: `
import './src/webviews/apps/shared/localization.ts';
import { createWipStatsAdornmentProvider } from './packages/plus/commit-graph-ui/src/extensions/wipStats/adornmentProvider.ts';
const provider = createWipStatsAdornmentProvider({ statsBySha: new Map() });
const row = { kind: 'workdir', sha: 'wip' };
globalThis.exercise = () => ({
 clean: provider.describeForA11y(row, {}),
 sparse: provider.describeForA11y(row, { added: 2, modified: 0, deleted: 3, renamed: 0 }),
 complete: provider.describeForA11y(row, { added: 2, modified: 5, deleted: 3, renamed: 7 }),
});
`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		tsconfig: 'src/webviews/apps/tsconfig.json',
		loader: { '.scss': 'empty' },
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		const translations = {
			'no working changes': 'aucun changement local',
			'{0} added, {1} deleted': '{1} supprimés · {0} ajoutés',
			'{0} added, {1} modified, {2} deleted, {3} renamed':
				'{3} renommés · {2} supprimés · {1} modifiés · {0} ajoutés',
		};
		const encoded = Buffer.from(JSON.stringify(translations), 'utf8').toString('base64');
		await page.setContent(`<meta name="gitlens-l10n" content="${encoded}">`);
		await page.addScriptTag({ content: result.outputFiles[0].text });
		const actual = await page.evaluate(() => exercise());
		assert.deepEqual(errors, []);
		assert.deepEqual(actual, {
			clean: 'aucun changement local',
			sparse: '3 supprimés · 2 ajoutés',
			complete: '7 renommés · 3 supprimés · 5 modifiés · 2 ajoutés',
		});
	} finally {
		await browser.close();
	}
});

test('translated overlays and banners keep markup-like text inert and preserve rich links', async () => {
	const result = await build({
		stdin: {
			contents: `
import './src/webviews/apps/shared/localization.ts';
import { html, render } from 'lit';
import { localizedContent } from '@gitlens/components/localizedContent.js';
import { renderOverlayContent } from '@gitlens/components/components/overlays/overlays.utils.js';
import './src/webviews/apps/shared/components/agents-banner.ts';
import './src/webviews/apps/shared/components/overlays/popover-confirm.ts';
globalThis.render = render;
globalThis.richText = message => localizedContent(message, { link: html\`<a href="#test" @click=\${event => { event.preventDefault(); globalThis.clicked = true; }}>link</a>\` });
globalThis.overlayText = renderOverlayContent;
`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		tsconfig: 'src/webviews/apps/tsconfig.json',
		loader: { '.scss': 'empty' },
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		const translations = {
			'Learn more': '<img src=x onerror="globalThis.injected=true"> 詳細',
			'Connect Your AI Agents': 'AI エージェントを接続',
		};
		const encoded = Buffer.from(JSON.stringify(translations), 'utf8').toString('base64');
		await page.setContent(
			`<!doctype html><html lang="ja"><head><meta name="gitlens-l10n" content="${encoded}"></head><body><div id="fixture"></div></body></html>`,
		);
		await page.addScriptTag({ content: result.outputFiles[0].text });
		const actual = await page.evaluate(async () => {
			const fixture = document.getElementById('fixture');
			const hostile = '<img src=x onerror="globalThis.injected=true">';
			render(overlayText(`${hostile}\nline\n\n<a href="command:untrusted">action</a>`), fixture);
			const overlay = {
				text: fixture.textContent,
				images: fixture.querySelectorAll('img').length,
				links: fixture.querySelectorAll('a').length,
				breaks: fixture.querySelectorAll('br').length,
				rules: fixture.querySelectorAll('hr').length,
			};
			render(richText(`前 {link} ${hostile} 後 {link}`), fixture);
			fixture.querySelector('a').click();
			const rich = {
				links: fixture.querySelectorAll('a').length,
				images: fixture.querySelectorAll('img').length,
				clicked: globalThis.clicked,
			};
			const agents = document.createElement('gl-agents-banner');
			agents.mcpCanAutoRegister = true;
			agents.hooksAvailable = true;
			agents.showCleanupNotice = true;
			document.body.append(agents);
			await agents.updateComplete;
			const banner = agents.shadowRoot.querySelector('gl-banner');
			await banner.updateComplete;
			const content = banner.shadowRoot.querySelector('.banner__body');
			const bannerState = {
				title: banner.bannerTitle,
				images: content.querySelectorAll('img').length,
				links: [...content.querySelectorAll('a')].map(link => [link.getAttribute('href'), link.textContent]),
				code: [...content.querySelectorAll('code')].map(code => code.textContent),
			};
			const confirm = document.createElement('gl-popover-confirm');
			confirm.heading = 'Confirm';
			confirm.message = `${hostile}\n\nUser-provided <a href="command:untrusted">branch</a>`;
			document.body.append(confirm);
			await confirm.updateComplete;
			const message = confirm.shadowRoot.querySelector('.confirm-popover__message');
			return {
				overlay,
				rich,
				banner: bannerState,
				confirm: {
					text: message.textContent,
					images: message.querySelectorAll('img').length,
					links: message.querySelectorAll('a').length,
					breaks: message.querySelectorAll('br').length,
				},
				injected: globalThis.injected,
			};
		});
		assert.deepEqual(errors, []);
		assert.equal(actual.injected, undefined);
		assert.equal(actual.overlay.images, 0);
		assert.equal(actual.overlay.links, 0);
		assert.equal(actual.overlay.breaks, 1);
		assert.equal(actual.overlay.rules, 1);
		assert.ok(actual.overlay.text.includes('<img src=x'));
		assert.deepEqual(actual.rich, { links: 2, images: 0, clicked: true });
		assert.equal(actual.banner.title, translations['Connect Your AI Agents']);
		assert.equal(actual.banner.images, 0);
		assert.equal(actual.banner.links.length, 2);
		assert.ok(
			actual.banner.links.every(
				([href, text]) => href.startsWith('https://') && text === translations['Learn more'],
			),
		);
		assert.deepEqual(actual.banner.code, ['mcp.json', 'mcpServers.GitKraken']);
		assert.equal(actual.confirm.images, 0);
		assert.equal(actual.confirm.links, 0);
		assert.equal(actual.confirm.breaks, 2);
		assert.ok(actual.confirm.text.includes('User-provided <a href='));
	} finally {
		await browser.close();
	}
});

test('shortcut descriptions reorder key groups without changing bindings or interpreting translated markup', async () => {
	const result = await build({
		stdin: {
			contents: `
import './src/webviews/apps/shared/localization.ts';
import { render } from 'lit';
import { KeymapDispatcher } from '@gitlens/utils/keys/keymapDispatcher.js';
import { registerGraphKeymap } from './src/webviews/apps/plus/graph/keymap/registerKeymap.ts';
import './src/webviews/apps/plus/graph/components/gl-graph-keyboard-shortcuts.ts';
globalThis.exercise = () => {
 const dispatcher = new KeymapDispatcher({ isMac: false });
 registerGraphKeymap(dispatcher, new Proxy({}, { get: () => () => undefined }));
 const sheet = document.createElement('gl-graph-keyboard-shortcuts');
 sheet.keymap = dispatcher;
 const fixture = document.getElementById('fixture');
 render(sheet.render(), fixture);
 const description = [...fixture.querySelectorAll('.subline')].find(e => e.textContent.includes('で選択'));
 const keys = [...description.querySelectorAll('kbd')].map(e => e.textContent);
 const output = { text: description.textContent, keys, images: description.querySelectorAll('img').length,
 binding: dispatcher.sheetEntries().find(row => row.ids?.includes('search.commits')).keys };
 dispatcher.dispose();
 return output;
};`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		tsconfig: 'src/webviews/apps/tsconfig.json',
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		const translations = {
			'{arrows} matches · {enter} selects': '{enter} で選択 · {arrows} で移動 <img src=x>',
		};
		const encoded = Buffer.from(JSON.stringify(translations), 'utf8').toString('base64');
		await page.setContent(`<meta name="gitlens-l10n" content="${encoded}"><div id="fixture"></div>`);
		await page.addScriptTag({ content: result.outputFiles[0].text });
		const actual = await page.evaluate(() => exercise());
		assert.deepEqual(errors, []);
		assert.equal(actual.images, 0);
		assert.ok(actual.text.endsWith('で移動 <img src=x>'));
		assert.deepEqual(actual.keys, ['Enter', '↑', '↓']);
		assert.deepEqual(actual.binding, ['mod+KeyF']);
	} finally {
		await browser.close();
	}
});

test('settings format previews use the host error flag instead of English message text', async () => {
	const result = await build({
		stdin: {
			contents: `
import './src/webviews/apps/shared/localization.ts';
import { ContextProvider } from '@lit/context';
import { SettingsActions } from './src/webviews/apps/settings/actions.ts';
import { createSettingsState, settingsStateContext } from './src/webviews/apps/settings/state.ts';
import './src/webviews/apps/settings/components/format-input.ts';
globalThis.exercise = async () => {
 const responses = new Map([
  ['Invalid format is committed content', { preview: 'Invalid format is committed content', isError: false }],
  ['broken', { preview: 'Ungültiges Format', isError: true }],
 ]);
 const settings = { generateFormatPreview: async params => responses.get(params.format) };
 async function renderPreview(format) {
  const fixture = document.createElement('div');
  document.body.append(fixture);
  const state = createSettingsState();
  state.config.set({ currentLine: { format } });
  new ContextProvider(fixture, { context: settingsStateContext, initialValue: state });
  const input = document.createElement('gl-format-input');
  input.descriptor = { kind: 'text', key: 'currentLine.format', label: 'Format', preview: { type: 'commit' } };
  input.actions = new SettingsActions(state, {}, settings);
  fixture.append(input);
  await input.updateComplete;
  await new Promise(resolve => setTimeout(resolve, 250));
  await input.updateComplete;
  const example = input.shadowRoot.querySelector('.example');
  const output = { text: example.querySelector('.example__text').textContent, error: example.classList.contains('example--error') };
  state.dispose();
  fixture.remove();
  return output;
 }
 return { valid: await renderPreview('Invalid format is committed content'), invalid: await renderPreview('broken') };
};`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		tsconfig: 'src/webviews/apps/tsconfig.json',
		loader: { '.scss': 'empty' },
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		await page.setContent('<div id="fixture"></div>');
		await page.addScriptTag({ content: result.outputFiles[0].text });
		const actual = await page.evaluate(() => exercise());
		assert.deepEqual(errors, []);
		assert.deepEqual(actual.valid, { text: 'Invalid format is committed content', error: false });
		assert.deepEqual(actual.invalid, { text: 'Ungültiges Format', error: true });
	} finally {
		await browser.close();
	}
});

test('localized fallback promotions escape text across the host HTML boundary', async () => {
	const { createRequire } = await import('node:module');
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const { getL10nJson } = await import('@vscode/l10n-dev');
	const require = createRequire(import.meta.url);
	const runtime = require('@vscode/l10n');
	const source = await readFile('src/plus/gk/productConfigProvider.ts', 'utf8');
	const catalog = await getL10nJson([{ extension: '.ts', contents: source }]);
	const key = Object.keys(catalog).find(key => key.startsWith('{boldStart}Save up to 50%{boldEnd}'));
	assert.ok(key);
	const hostile = '<img src=x onerror="globalThis.injected=true">';
	const [host, browserCode] = await Promise.all([
		build({
			stdin: {
				contents: `import { ProductConfigProvider } from './src/plus/gk/productConfigProvider.ts';
globalThis.getPromo = () => new ProductConfigProvider(
 { telemetry: { sendEvent() {} }, storage: { get() {} } },
 { fetchGkConfig: async () => ({ ok: false, status: 503 }) },
).getApplicablePromo(0, 'pro', 'account');`,
				resolveDir: process.cwd(),
			},
			bundle: true,
			write: false,
			platform: 'node',
			format: 'cjs',
			define: { DEBUG: 'false' },
			external: ['vscode', '@vscode/l10n'],
			plugins: [
				{
					name: 'isolated-device-cohort',
					setup(builder) {
						builder.onResolve({ filter: /system\/-webview\/vscode\.js$/ }, () => ({
							path: 'device',
							namespace: 'test',
						}));
						builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
							contents: 'export const deviceCohortGroup = 0;',
						}));
					},
				},
			],
		}),
		build({
			stdin: { contents: "import './src/webviews/apps/shared/components/promo.ts';", resolveDir: process.cwd() },
			bundle: true,
			write: false,
			platform: 'browser',
			format: 'iife',
			target: 'es2022',
			tsconfig: 'src/webviews/apps/tsconfig.json',
		}),
	]);
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		for (const translated of [false, true]) {
			runtime.config({
				contents: translated ? { [key]: `GitLens Pro ${hostile} {boldStart}50% OFF{boldEnd}` } : {},
			});
			const context = {
				require: id => (id === 'vscode' ? { l10n: runtime } : require(id)),
				console,
				process,
				URL,
				TextEncoder,
				TextDecoder,
				setTimeout,
				clearTimeout,
			};
			runInNewContext(host.outputFiles[0].text, context);
			const promo = await context.getPromo();
			assert.ok(promo);
			if (!translated) assert.equal(promo.content.webview.info.html, '<b>Save up to 50%</b> on GitLens Pro');
			await page.goto('about:blank');
			await page.addScriptTag({ content: browserCode.outputFiles[0].text });
			for (const type of ['info', 'link']) {
				const actual = await page.evaluate(
					async ({ promo, type }) => {
						const element = document.createElement('gl-promo');
						element.type = type;
						element.promoPromise = Promise.resolve(promo);
						document.body.replaceChildren(element);
						await element.updateComplete;
						await new Promise(resolve => requestAnimationFrame(resolve));
						return {
							text: element.shadowRoot.querySelector(type === 'info' ? 'p' : '.link__full').textContent,
							bold: element.shadowRoot.querySelector('b').textContent,
							images: element.shadowRoot.querySelectorAll('img').length,
							injected: globalThis.injected === true,
							href: element.shadowRoot.querySelector('a')?.getAttribute('href'),
						};
					},
					{ promo, type },
				);
				assert.equal(
					actual.text,
					translated ? `GitLens Pro ${hostile} 50% OFF` : 'Save up to 50% on GitLens Pro',
				);
				assert.equal(actual.bold, translated ? '50% OFF' : 'Save up to 50%');
				assert.equal(actual.images, 0);
				assert.equal(actual.injected, false);
				if (type === 'link') assert.ok(actual.href.startsWith('command:gitlens.plus.upgrade'));
			}
		}
		assert.deepEqual(errors, []);
	} finally {
		runtime.config({ contents: {} });
		await browser.close();
	}
});

test('Launchpad indicator localizes every status and count grammar at its accessible consumer', async () => {
	const result = await build({
		stdin: {
			contents: `
import './src/webviews/apps/shared/localization.ts';
import { ContextProvider } from '@lit/context';
import { createGraphLaunchpadState, graphLaunchpadContext } from './src/webviews/apps/plus/graph/graphLaunchpadState.ts';
import './src/webviews/apps/plus/graph/components/gl-graph-launchpad-indicator.ts';
globalThis.exercise = async () => {
 async function renderState({ connected, loading, summary }) {
  const fixture = document.createElement('div');
  document.body.append(fixture);
  const state = createGraphLaunchpadState();
  new ContextProvider(fixture, { context: graphLaunchpadContext, initialValue: state });
  const indicator = document.createElement('gl-graph-launchpad-indicator');
  fixture.append(indicator);
  state.connected.set(connected);
  state.loading.set(loading);
  state.summary.set(summary);
  await indicator.updateComplete;
  await new Promise(resolve => requestAnimationFrame(resolve));
  await indicator.updateComplete;
  const anchor = indicator.shadowRoot.querySelector('.action-button');
  const result = {
   label: anchor.getAttribute('aria-label'),
   busy: anchor.getAttribute('aria-busy'),
   text: indicator.shadowRoot.textContent,
   injected: globalThis.injected,
   images: indicator.shadowRoot.querySelectorAll('img').length,
  };
  fixture.remove();
  return result;
 }
 return {
  disconnected: await renderState({ connected: false, loading: false, summary: undefined }),
  loading: await renderState({ connected: undefined, loading: true, summary: undefined }),
  failed: await renderState({ connected: true, loading: false, summary: { error: { name: 'NetworkError', message: 'offline' } } }),
  empty: await renderState({ connected: true, loading: false, summary: { total: 0, groups: [], hasGroupedItems: false } }),
  single: await renderState({ connected: true, loading: false, summary: { total: 4, groups: ['mergeable', 'blocked', 'follow-up', 'needs-review'], hasGroupedItems: true, mergeable: { total: 1 }, blocked: { total: 1 }, followUp: { total: 1 }, needsReview: { total: 1 } } }),
  multiple: await renderState({ connected: true, loading: false, summary: { total: 14, groups: ['mergeable', 'blocked', 'follow-up', 'needs-review'], hasGroupedItems: true, mergeable: { total: 2 }, blocked: { total: 3 }, followUp: { total: 4 }, needsReview: { total: 5 } } }),
 };
};
`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		tsconfig: 'src/webviews/apps/tsconfig.json',
		loader: { '.scss': 'empty' },
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		const translations = {
			Launchpad: '[launchpad]',
			'Launchpad — connect an integration to see pull requests': '[connect first]',
			'Launchpad — loading': '[loading now]',
			'Launchpad — unable to load pull requests': '[load failed]',
			'Launchpad — all caught up': '[nothing pending]',
			'Launchpad — {groups}': 'groups: {groups}',
			'{count} pull request can be merged': 'merge-one/{count}',
			'{count} pull requests can be merged':
				'before/{count}/<img src=x onerror="globalThis.injected=true">/after',
			'{count} pull request is blocked': 'blocked-one/{count}',
			'{count} pull requests are blocked': 'blocked-many/{count}',
			'{count} pull request requires follow-up': 'follow-one/{count}',
			'{count} pull requests require follow-up': 'follow-many/{count}',
			'{count} pull request needs your review': 'review-one/{count}',
			'{count} pull requests need your review': 'review-many/{count}',
			'Launchpad organizes your pull requests into actionable groups to help you focus and keep your team unblocked.':
				'[welcome translated]',
			'Open Launchpad': '[open launchpad]',
		};
		const encoded = Buffer.from(JSON.stringify(translations), 'utf8').toString('base64');
		await page.setContent(
			`<html lang="fr"><head><meta name="gitlens-l10n" content="${encoded}"></head><body></body></html>`,
		);
		await page.addScriptTag({ content: result.outputFiles[0].text });
		const actual = await page.evaluate(() => exercise());
		assert.deepEqual(errors, []);
		assert.equal(actual.disconnected.label, '[connect first]');
		assert.equal(actual.loading.label, '[loading now]');
		assert.equal(actual.loading.busy, 'true');
		assert.equal(actual.failed.label, '[load failed]');
		assert.equal(actual.empty.label, '[nothing pending]');
		assert.equal(actual.single.label, 'groups: merge-one/1, blocked-one/1, follow-one/1 et review-one/1');
		assert.equal(
			actual.multiple.label,
			'groups: before/2/<img src=x onerror="globalThis.injected=true">/after, blocked-many/3, follow-many/4 et review-many/5',
		);
		assert.equal(actual.multiple.injected, undefined);
		assert.equal(actual.multiple.images, 0);
		assert.match(actual.disconnected.text, /\[welcome translated\]/);
		assert.match(actual.disconnected.text, /\[open launchpad\]/);

		const englishPage = await browser.newPage();
		const englishErrors = [];
		englishPage.on('pageerror', error => englishErrors.push(error.message));
		await englishPage.setContent('<html lang="en"><body></body></html>');
		await englishPage.addScriptTag({ content: result.outputFiles[0].text });
		const english = await englishPage.evaluate(() => exercise());
		assert.equal(
			english.single.label,
			'Launchpad — 1 pull request can be merged, 1 pull request is blocked, 1 pull request requires follow-up, and 1 pull request needs your review',
		);
		assert.equal(
			english.multiple.label,
			'Launchpad — 2 pull requests can be merged, 3 pull requests are blocked, 4 pull requests require follow-up, and 5 pull requests need your review',
		);
		assert.deepEqual(englishErrors, []);
		await englishPage.close();
	} finally {
		await browser.close();
	}
});

test('running operation labels localize through row helpers and the details-header chips', async () => {
	const result = await build({
		stdin: {
			contents: `
import './src/webviews/apps/shared/localization.ts';
import { rowAdornmentTooltipFor, chipStateLabel } from './src/webviews/apps/plus/graph/components/runningOperationStatus.ts';
import './src/webviews/apps/shared/components/details-header/gl-details-header.ts';
globalThis.exercise = async () => {
 const states = [undefined, 'generating', 'complete', 'backed', 'error', 'orphaned'];
 const kinds = ['compose', 'review', 'resolve'];
 const rows = [];
 for (const kind of kinds) {
  for (const execState of states) {
   for (const hasResult of execState === 'backed' ? [true, false] : [true]) {
    rows.push({ kind, execState, hasResult, tooltip: rowAdornmentTooltipFor(kind, execState, hasResult), chip: chipStateLabel('base', execState, hasResult) });
   }
  }
 }
 async function renderHeader(execState, hasResult) {
  const header = document.createElement('gl-details-header');
  header.modes = kinds;
  header.modeStatus = execState == null ? {} : Object.fromEntries(kinds.map(kind => [kind, { execState, hasResult }]));
  document.body.append(header);
  await header.updateComplete;
  await new Promise(resolve => requestAnimationFrame(resolve));
  await header.updateComplete;
  const chips = [...header.shadowRoot.querySelectorAll('gl-action-chip')];
  for (const chip of chips) await chip.updateComplete;
  function countImages(root) {
   let count = root.querySelectorAll('img').length;
   for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot != null) count += countImages(element.shadowRoot);
   }
   return count;
  }
  const actual = chips.map(chip => ({
   label: chip.getAttribute('label'),
   state: chip.getAttribute('data-state'),
   ariaLabel: chip.shadowRoot?.querySelector('.chip')?.getAttribute('aria-label'),
  }));
  const images = countImages(header.shadowRoot);
  header.remove();
  return { actual, images };
 }
 const headers = [];
 for (const execState of states) {
  for (const hasResult of execState === 'backed' ? [true, false] : [true]) {
   headers.push({ execState, hasResult, ...(await renderHeader(execState, hasResult)) });
  }
 }
 return { rows, headers, injected: globalThis.injected };
};
`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		tsconfig: 'src/webviews/apps/tsconfig.json',
		loader: { '.scss': 'empty' },
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		const errors = [];
		page.on('pageerror', error => errors.push(error.message));
		const translations = {
			'Compose Changes': 'compose base',
			'Review Changes': 'review base',
			'Resolve Conflicts': 'resolve base',
			'Compose Changes…': 'compose idle',
			'Review Changes…': 'review idle',
			'Resolve Conflicts…': 'resolve idle',
			'Composing…': 'compose running',
			'Reviewing…': 'review running',
			'Resolving…': 'resolve running',
			'View Compose': 'compose view',
			'View Review': 'review view',
			'View Resolutions': 'resolve view',
			'Compose Failed — Click to View': 'compose failed',
			'Review Failed — Click to View': 'review failed',
			'Resolve Failed — Click to View': 'resolve failed',
			'Compose — Anchor Missing': 'compose orphan',
			'Review — Anchor Missing': 'review orphan',
			'Resolve — Anchor Missing': 'resolve orphan',
			'{label} (Running)': 'running ← {label}',
			'{label} (Completed)': '<img src=x onerror="globalThis.injected=true"> completed ← {label}',
			'{label} (Failed)': 'failed ← {label}',
			'{label} (Orphaned)': 'orphaned ← {label}',
		};
		const encoded = Buffer.from(JSON.stringify(translations), 'utf8').toString('base64');
		await page.setContent(
			`<html lang="fr"><head><meta name="gitlens-l10n" content="${encoded}"></head><body></body></html>`,
		);
		await page.addScriptTag({ content: result.outputFiles[0].text });
		const actual = await page.evaluate(() => exercise());
		assert.deepEqual(errors, []);
		assert.equal(actual.injected, undefined);
		assert.equal(actual.rows.length, 21);
		const idle = { compose: 'compose idle', review: 'review idle', resolve: 'resolve idle' };
		const running = { compose: 'compose running', review: 'review running', resolve: 'resolve running' };
		const views = { compose: 'compose view', review: 'review view', resolve: 'resolve view' };
		const failed = { compose: 'compose failed', review: 'review failed', resolve: 'resolve failed' };
		const orphaned = { compose: 'compose orphan', review: 'review orphan', resolve: 'resolve orphan' };
		for (const row of actual.rows) {
			const expectedTooltip =
				row.execState == null || (row.execState === 'backed' && !row.hasResult)
					? idle[row.kind]
					: row.execState === 'generating'
						? running[row.kind]
						: row.execState === 'complete' || row.execState === 'backed'
							? views[row.kind]
							: row.execState === 'error'
								? failed[row.kind]
								: orphaned[row.kind];
			assert.equal(row.tooltip, expectedTooltip);
			const expectedChip =
				row.execState == null || (row.execState === 'backed' && !row.hasResult)
					? 'base'
					: row.execState === 'generating'
						? 'running ← base'
						: row.execState === 'complete' || row.execState === 'backed'
							? '<img src=x onerror="globalThis.injected=true"> completed ← base'
							: row.execState === 'error'
								? 'failed ← base'
								: 'orphaned ← base';
			assert.equal(row.chip, expectedChip);
		}
		const bases = ['compose base', 'review base', 'resolve base'];
		for (const header of actual.headers) {
			assert.equal(header.actual.length, 3);
			assert.equal(header.images, 0);
			for (const [index, chip] of header.actual.entries()) {
				const expectedLabel =
					header.execState == null || (header.execState === 'backed' && !header.hasResult)
						? bases[index]
						: header.execState === 'generating'
							? `running ← ${bases[index]}`
							: header.execState === 'complete' || header.execState === 'backed'
								? `<img src=x onerror="globalThis.injected=true"> completed ← ${bases[index]}`
								: header.execState === 'error'
									? `failed ← ${bases[index]}`
									: `orphaned ← ${bases[index]}`;
				assert.equal(chip.label, expectedLabel);
				assert.equal(chip.ariaLabel, expectedLabel);
				assert.equal(chip.state, header.execState ?? '');
			}
		}

		const englishPage = await browser.newPage();
		const englishErrors = [];
		englishPage.on('pageerror', error => englishErrors.push(error.message));
		await englishPage.setContent('<html lang="en"><body></body></html>');
		await englishPage.addScriptTag({ content: result.outputFiles[0].text });
		const english = await englishPage.evaluate(() => exercise());
		const englishBase = { compose: 'Compose Changes', review: 'Review Changes', resolve: 'Resolve Conflicts' };
		const englishTooltip = {
			compose: {
				idle: 'Compose Changes…',
				running: 'Composing…',
				view: 'View Compose',
				failed: 'Compose Failed — Click to View',
				orphaned: 'Compose — Anchor Missing',
			},
			review: {
				idle: 'Review Changes…',
				running: 'Reviewing…',
				view: 'View Review',
				failed: 'Review Failed — Click to View',
				orphaned: 'Review — Anchor Missing',
			},
			resolve: {
				idle: 'Resolve Conflicts…',
				running: 'Resolving…',
				view: 'View Resolutions',
				failed: 'Resolve Failed — Click to View',
				orphaned: 'Resolve — Anchor Missing',
			},
		};
		const englishRowsExpected = [];
		for (const kind of ['compose', 'review', 'resolve']) {
			const base = 'base';
			const tooltip = englishTooltip[kind];
			englishRowsExpected.push(
				[tooltip.idle, base],
				[tooltip.running, `${base} (Running)`],
				[tooltip.view, `${base} (Completed)`],
				[tooltip.view, `${base} (Completed)`],
				[tooltip.idle, base],
				[tooltip.failed, `${base} (Failed)`],
				[tooltip.orphaned, `${base} (Orphaned)`],
			);
		}
		assert.deepEqual(
			english.rows.map(row => [row.tooltip, row.chip]),
			englishRowsExpected,
		);
		const englishHeadersExpected = [];
		for (const [state, hasResult] of [
			['idle', true],
			['generating', true],
			['complete', true],
			['backed', true],
			['backed', false],
			['error', true],
			['orphaned', true],
		]) {
			const suffix =
				state === 'idle' || (state === 'backed' && !hasResult)
					? ''
					: state === 'generating'
						? ' (Running)'
						: state === 'complete' || state === 'backed'
							? ' (Completed)'
							: state === 'error'
								? ' (Failed)'
								: ' (Orphaned)';
			englishHeadersExpected.push({
				state,
				hasResult,
				labels: Object.values(englishBase).map(base => `${base}${suffix}`),
				states: Object.values(englishBase).map(() => (state === 'idle' ? '' : state)),
			});
		}
		assert.deepEqual(
			english.headers.map(header => ({
				state: header.execState ?? 'idle',
				hasResult: header.hasResult,
				labels: header.actual.map(chip => chip.label),
				ariaLabels: header.actual.map(chip => chip.ariaLabel),
				states: header.actual.map(chip => chip.state),
			})),
			englishHeadersExpected.map(expected => ({ ...expected, ariaLabels: expected.labels })),
		);
		assert.deepEqual(englishErrors, []);
		await englishPage.close();
	} finally {
		await browser.close();
	}
});
