import assert from 'node:assert/strict';
import * as process from 'node:process';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

/** @type {import('playwright').Browser} */
let browser;
/** @type {import('playwright').Page} */
let page;
/** @type {string} */
let bundle;
/** @type {string[]} */
let errors;

before(async () => {
	const result = await build({
		stdin: {
			contents: `
import { colorForColumn } from '@gitkraken/commit-graph/lanes/colors.js';
import { KeymapDispatcher } from '@gitlens/utils/keys/keymapDispatcher.js';
import { setGraphLanePalette } from './packages/plus/commit-graph-ui/src/localization.ts';
import { minimalCommitGraphProfile } from './packages/plus/commit-graph-ui/src/profile.ts';
import { registerCommitGraphElements } from './packages/plus/commit-graph-ui/src/register.ts';
import { registerOverviewBarElement } from './packages/plus/commit-graph-ui/src/overviewBar.ts';
Object.assign(globalThis, { colorForColumn, setGraphLanePalette, registerCommitGraphElements, registerOverviewBarElement });
const row = (sha, parents) => ({ sha, parents, author: 'A', email: 'a@x', date: 0, message: sha, kind: 'commit' });
globalThis.mountGraphs = async count => {
 registerCommitGraphElements();
 const dispatcher = new KeymapDispatcher({ isMac: false });
 dispatcher.attach();
 const keymap = { attach: () => dispatcher.createRegistrar() };
 globalThis.escapes = [];
 window.addEventListener('keydown', e => { if (e.key === 'Escape') escapes.push(e.defaultPrevented); });
 globalThis.graphs = [];
 for (let i = 0; i < count; i++) {
  const graph = document.createElement('gl-commit-graph');
  graph.style.cssText = 'display:block;height:200px';
  graph.profile = minimalCommitGraphProfile;
  graph.rows = [row('a' + i, ['b' + i]), row('b' + i, [])];
  graph.keymap = keymap;
  graph.cleared = 0;
  graph.addEventListener('gl-graph-changeselection', e => { if (e.detail.sha == null) graph.cleared++; });
  document.body.append(graph);
  graphs.push(graph);
 }
 for (const graph of graphs) await graph.updateComplete;
};
globalThis.select = async (index, sha) => {
 const graph = graphs[index];
 graph.selectedRows = sha != null ? { [sha]: true } : {};
 await graph.updateComplete;
 graph.querySelector('.gl-graph__tree').focus();
};
`,
			resolveDir: process.cwd(),
		},
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		tsconfig: 'packages/plus/commit-graph-ui/tsconfig.json',
	});
	bundle = result.outputFiles[0].text;
	browser = await chromium.launch({ headless: true });
});

after(async () => {
	await browser?.close();
});

beforeEach(async () => {
	page = await browser.newPage();
	errors = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent('<!doctype html><html><body></body></html>');
});

afterEach(async () => {
	await page?.close();
});

async function load() {
	await page.addScriptTag({ content: bundle });
}

test('Escape on the rows clears a selection and is consumed, and with none it reaches the page', async () => {
	await load();
	await page.evaluate(() => mountGraphs(1));

	await page.evaluate(() => select(0, undefined));
	await page.keyboard.press('Escape');
	assert.deepEqual(await page.evaluate(() => ({ escapes, cleared: graphs[0].cleared })), {
		escapes: [false],
		cleared: 0,
	});

	await page.evaluate(() => select(0, 'a0'));
	await page.keyboard.press('Escape');
	assert.deepEqual(await page.evaluate(() => ({ escapes, cleared: graphs[0].cleared })), {
		escapes: [false],
		cleared: 1,
	});
	assert.deepEqual(errors, []);
});

test('graphs sharing one host keymap keep their own keys, and removing one leaves the other working', async () => {
	await load();
	await page.evaluate(() => mountGraphs(2));

	const escapeIn = async index => {
		await page.evaluate(i => select(i, 'a' + i), index);
		await page.keyboard.press('Escape');
		return page.evaluate(() => graphs.map(g => g.cleared));
	};
	assert.deepEqual(await escapeIn(0), [1, 0]);
	assert.deepEqual(await escapeIn(1), [1, 1]);

	await page.evaluate(() => graphs[0].remove());
	assert.deepEqual(await escapeIn(1), [1, 2]);
	assert.deepEqual(errors, []);
});

test('a lane palette in any CSS colour syntax reaches the engine as hex, and an invalid entry changes nothing', async () => {
	await load();
	const actual = await page.evaluate(() => {
		setGraphLanePalette(['rgb(255 0 0)', 'rebeccapurple', 'hsl(120 100% 50% / 0.5)']);
		const set = [0, 1, 2].map(colorForColumn);
		setGraphLanePalette(['#0000ff', 'not-a-colour']);
		const kept = [0, 1, 2].map(colorForColumn);
		return { set, kept };
	});
	assert.deepEqual(actual.set, ['#ff0000', '#663399', '#00ff00']);
	assert.deepEqual(actual.kept, ['#ff0000', '#663399', '#00ff00']);
	assert.deepEqual(errors, []);
});

test('loading and registering on a page that already defines the shared element names does not throw', async () => {
	await page.evaluate(() => {
		for (const name of [
			'code-icon',
			'commit-stats',
			'gl-wip-stats',
			'gl-tracking-pill',
			'gl-popover',
			'gl-tooltip',
			'gl-commit-graph',
			'gl-graph-overview-bar',
		]) {
			customElements.define(name, class extends HTMLElement {});
		}
	});
	await load();
	const graphIsOurs = await page.evaluate(() => {
		const before = customElements.get('gl-commit-graph');
		registerCommitGraphElements();
		registerCommitGraphElements();
		registerOverviewBarElement();
		registerOverviewBarElement();
		return customElements.get('gl-commit-graph') !== before;
	});
	assert.equal(graphIsOurs, false);
	assert.deepEqual(errors, []);
});
