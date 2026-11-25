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
import { laneCollapseExtension } from './packages/plus/commit-graph-ui/src/extensions/laneCollapse.ts';
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
globalThis.row = row;
globalThis.chain = (prefix, count, parent) =>
 Array.from({ length: count }, (_, i) => row(prefix + i, i < count - 1 ? [prefix + (i + 1)] : parent != null ? [parent] : []));
globalThis.settle = async graph => {
 for (let i = 0; i < 4; i++) {
  await graph.updateComplete;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
 }
};
globalThis.mountGraph = async (rows, options = {}) => {
 registerCommitGraphElements();
 const graph = document.createElement('gl-commit-graph');
 graph.style.cssText = 'display:block;height:200px';
 graph.profile = options.lanes
  ? Object.freeze({ ...minimalCommitGraphProfile, laneCollapse: laneCollapseExtension })
  : minimalCommitGraphProfile;
 if (options.config != null) graph.config = options.config;
 graph.hasMore = options.hasMore ?? false;
 graph.rows = rows;
 graph.seen = { selections: [], moreRows: 0, laneToggles: 0 };
 graph.addEventListener('gl-graph-changeselection', e => graph.seen.selections.push(e.detail.sha));
 graph.addEventListener('gl-graph-morerows', () => graph.seen.moreRows++);
 graph.addEventListener('gl-graph-lanetoggle', () => graph.seen.laneToggles++);
 document.body.append(graph);
 await settle(graph);
 return graph;
};
globalThis.landing = graph => {
 const tree = graph.querySelector('.gl-graph__tree');
 const active = tree?.getAttribute('aria-activedescendant');
 return {
  selected: [...graph.querySelectorAll('.gl-graph__row[aria-selected="true"]')].map(r => r.dataset.sha),
  focused: document.activeElement === tree,
  activeRow: active != null ? document.getElementById(active)?.dataset.sha : undefined,
 };
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

test('the graph dims its selection from window focus unless the host sets windowFocused', async () => {
	await load();
	const dimmed = () =>
		page.evaluate(async () => {
			await settle(graph);
			return graph.querySelector('.gl-graph__viewport').classList.contains('gl-graph--window-unfocused');
		});
	await page.evaluate(async () => {
		globalThis.graph = await mountGraph([row('a', ['b']), row('b', [])]);
		window.dispatchEvent(new Event('focus'));
	});
	assert.equal(await dimmed(), false);

	await page.evaluate(() => window.dispatchEvent(new Event('blur')));
	assert.equal(await dimmed(), true);

	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	assert.equal(await dimmed(), false);

	await page.evaluate(() => {
		graph.windowFocused = true;
		window.dispatchEvent(new Event('blur'));
	});
	assert.equal(await dimmed(), false);
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

async function jumpPastLoadedEnd() {
	await page.evaluate(async () => {
		globalThis.loaded = chain('c', 5, 'p');
		globalThis.graph = await mountGraph(loaded);
		graph.selectedRows = { c4: true };
		await settle(graph);
		graph.querySelector('.gl-graph__tree').focus();
	});
	await page.keyboard.press('Control+ArrowDown');
}

test('an unclaimed jump to a row that is not loaded yet selects and focuses it once it is appended', async () => {
	await load();
	await jumpPastLoadedEnd();
	const actual = await page.evaluate(async () => {
		graph.rows = [...loaded, row('p', [])];
		await settle(graph);
		return { ...landing(graph), selections: graph.seen.selections };
	});
	assert.deepEqual(actual, { selected: ['p'], focused: true, activeRow: 'p', selections: ['p'] });
	assert.deepEqual(errors, []);
});

test('a keyboard selection before the jumped-to row arrives drops its landing', async () => {
	await load();
	await jumpPastLoadedEnd();
	await page.keyboard.press('ArrowUp');
	const actual = await page.evaluate(async () => {
		graph.rows = [...loaded, row('p', [])];
		await settle(graph);
		return { ...landing(graph), selections: graph.seen.selections };
	});
	assert.deepEqual(actual, { selected: ['c3'], focused: true, activeRow: 'c3', selections: ['c3'] });
	assert.deepEqual(errors, []);
});

test('a selecting reveal of a row that arrives in a collapsed lane expands that lane once and lands on the row', async () => {
	await load();
	const actual = await page.evaluate(async () => {
		const rows = [row('m', ['a1', 's1']), row('s1', ['s2']), row('a1', ['a2']), row('s2', ['a2']), row('a2', [])];
		const graph = await mountGraph(rows.slice(4), { lanes: true, config: { lanesFoldingDefault: 'all' } });
		graph.scrollToSha('s2', { select: true });
		graph.rows = rows;
		await graph.updateComplete;
		const folded = graph.querySelector('.gl-graph__row[data-sha="s2"]') == null;
		await settle(graph);
		return { folded: folded, selected: landing(graph).selected, laneToggles: graph.seen.laneToggles };
	});
	assert.deepEqual(actual, { folded: true, selected: ['s2'], laneToggles: 1 });
	assert.deepEqual(errors, []);
});

test('a restored scroll state keeps its row at the same offset after rows are prepended', async () => {
	await load();
	const actual = await page.evaluate(async () => {
		const rows = chain('r', 100);
		const first = await mountGraph(rows);
		first.querySelector('lit-virtualizer').scrollTop = 1003;
		await settle(first);
		first.remove();
		const saved = first.getScrollState();

		const second = await mountGraph([...chain('n', 10, 'r0'), ...rows]);
		second.restoreScrollState(saved);
		await settle(second);
		return { saved: saved, restored: second.getScrollState() };
	});
	assert.equal(actual.restored.sha, actual.saved.sha);
	assert.equal(actual.restored.offset, actual.saved.offset);
	assert.ok(actual.restored.scrollTop > actual.saved.scrollTop);
	assert.deepEqual(errors, []);
});

test('a reveal still waiting for its row wins over a scroll restore', async () => {
	await load();
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const actual = await page.evaluate(async () => {
		const rows = chain('r', 100, 'x');
		const graph = await mountGraph(rows);
		graph.scrollToSha('x');
		graph.restoreScrollState({ sha: 'r50', offset: 0, scrollTop: 1000 });
		await settle(graph);
		const waiting = graph.getScrollState().scrollTop;

		graph.rows = [...rows, row('x', [])];
		await settle(graph);
		const scroller = graph.querySelector('lit-virtualizer').getBoundingClientRect();
		const target = graph.querySelector('.gl-graph__row[data-sha="x"]')?.getBoundingClientRect();
		return {
			waiting: waiting,
			inView: target != null && target.top >= scroller.top && target.bottom <= scroller.bottom,
		};
	});
	assert.deepEqual(actual, { waiting: 0, inView: true });
	assert.deepEqual(errors, []);
});

test('rows appended while the focused row is still near the end ask for more once, and none once hasMore is false', async () => {
	await load();
	const actual = await page.evaluate(async () => {
		const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
		const rows = chain('r', 309);
		const graph = await mountGraph(rows.slice(0, 300), { hasMore: true });
		graph.selectedRows = { r299: true };
		await settle(graph);
		graph.focus();
		await pause(400);

		const askedAfter = async (count, hasMore) => {
			graph.hasMore = hasMore;
			graph.seen.moreRows = 0;
			graph.rows = rows.slice(0, count);
			await settle(graph);
			await pause(400);
			return graph.seen.moreRows;
		};
		return { whileMore: await askedAfter(303, true), afterLast: await askedAfter(306, false) };
	});
	assert.deepEqual(actual, { whileMore: 1, afterLast: 0 });
	assert.deepEqual(errors, []);
});
