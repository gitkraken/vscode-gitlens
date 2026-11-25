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
import { registerOverviewBarElement } from './packages/plus/commit-graph-ui/src/overviewBar.ts';
registerOverviewBarElement();
const items = [
 { id: 'a', branchName: 'main', repoPath: '/repo', isPrimary: true, hasWorkingChanges: true, hasUnpushed: true, tipSha: 'head-a', upstreamSha: 'up-a', upstreamName: 'origin/main', target: { name: 'develop' } },
 { id: 'b', branchName: 'feature', repoPath: '/repo-b', hasWorkingChanges: true, branchId: 'b-id', agent: 'needs-input', agentCount: 2 },
 { id: 'c', branchName: 'fix', repoPath: '/repo-c', hasUnpushed: true, agent: 'working', agentCount: 1, tipSha: 'head-c', vscodeContext: '{"webviewItem":"wip"}' },
];
globalThis.mount = async () => {
 const bar = document.createElement('gl-graph-overview-bar');
 bar.items = items;
 globalThis.events = [];
 for (const name of ['select', 'focus', 'jump', 'statsneeded', 'contextmenu']) {
  bar.addEventListener('gl-graph-overview' + name, e => events.push({ name, detail: e.detail, cancelable: e.cancelable }));
 }
 document.body.replaceChildren(bar);
 globalThis.bar = bar;
 await bar.updateComplete;
};
globalThis.settle = async () => {
 await bar.updateComplete;
 await bar.updateComplete;
};
globalThis.probe = () => {
 const root = bar.shadowRoot;
 const active = root.activeElement;
 let focused;
 if (active?.classList.contains('pill__main')) {
  focused = 'pill:' + active.dataset.index;
 } else if (active?.classList.contains('pill__leg')) {
  focused = 'leg:' + active.dataset.sha;
 }
 return {
  focused,
  tabStops: [...root.querySelectorAll('.pill__main')].filter(b => b.getAttribute('tabindex') === '0').map(b => b.dataset.index),
 };
};
globalThis.focusPill = async index => {
 bar.shadowRoot.querySelector('.pill__main[data-index="' + index + '"]').focus();
 await settle();
};
customElements.define('x-hover-content', class extends HTMLElement {
 constructor() {
  super();
  this.attachShadow({ mode: 'open' }).innerHTML = '<span class="pill">tracking</span><span class="nested">nested</span>';
 }
});
globalThis.hoverCalls = [];
globalThis.useHover = async () => {
 const nodes = new Map();
 bar.renderHover = (item, open) => {
  hoverCalls.push([item.id, open]);
  if (!nodes.has(item.id)) nodes.set(item.id, document.createElement('x-hover-content'));
  return nodes.get(item.id);
 };
 await settle();
};
globalThis.showHover = async id => {
 const popover = bar.shadowRoot.querySelector('gl-popover[data-id="' + id + '"]');
 popover.dispatchEvent(new CustomEvent('gl-popover-show', { bubbles: true, composed: true }));
 await settle();
 return popover.querySelector('x-hover-content').shadowRoot;
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
	await page.addScriptTag({ content: bundle });
	await page.evaluate(() => mount());
});

afterEach(async () => {
	await page?.close();
});

async function press(key) {
	await page.keyboard.press(key);
	return page.evaluate(async () => {
		await settle();
		return probe();
	});
}

test('the bar has one tab stop, and Left/Right wrap between pills', async () => {
	assert.deepEqual(await page.evaluate(() => probe().tabStops), ['0']);

	await page.evaluate(() => focusPill(0));
	assert.deepEqual(await press('ArrowRight'), { focused: 'pill:1', tabStops: ['1'] });
	assert.deepEqual(await press('ArrowRight'), { focused: 'pill:2', tabStops: ['2'] });
	assert.deepEqual(await press('ArrowRight'), { focused: 'pill:0', tabStops: ['0'] });
	assert.deepEqual(await press('ArrowLeft'), { focused: 'pill:2', tabStops: ['2'] });
	assert.deepEqual(await press('ArrowLeft'), { focused: 'pill:1', tabStops: ['1'] });
	assert.deepEqual(errors, []);
});

test('Home and End move to the first and last pill', async () => {
	await page.evaluate(() => focusPill(1));
	assert.deepEqual(await press('End'), { focused: 'pill:2', tabStops: ['2'] });
	assert.deepEqual(await press('Home'), { focused: 'pill:0', tabStops: ['0'] });
	assert.deepEqual(errors, []);
});

test('arrow keys and Home/End move from the focused pill, wherever the tab stop is', async () => {
	const reordered = await page.evaluate(async () => {
		await focusPill(1);
		bar.items = [bar.items[1], bar.items[0], bar.items[2]];
		await settle();
		return probe();
	});
	assert.deepEqual(reordered, { focused: 'pill:0', tabStops: ['1'] });
	assert.deepEqual(await press('ArrowRight'), { focused: 'pill:1', tabStops: ['1'] });
	await page.evaluate(() => focusPill(0));
	assert.deepEqual(await press('End'), { focused: 'pill:2', tabStops: ['2'] });
	assert.deepEqual(errors, []);
});

test('a focused pill takes the tab stop, so Tab and Shift+Tab leave the bar from it', async () => {
	const activeId = () => page.evaluate(() => document.activeElement?.id);
	await page.evaluate(() => {
		const before = document.createElement('button');
		before.id = 'before';
		const after = document.createElement('button');
		after.id = 'after';
		bar.before(before);
		bar.after(after);
	});

	await page.evaluate(() => focusPill(2));
	assert.deepEqual(await page.evaluate(() => probe()), { focused: 'pill:2', tabStops: ['2'] });
	await page.keyboard.press('Shift+Tab');
	assert.equal(await activeId(), 'before');

	const reselected = await page.evaluate(async () => {
		await focusPill(1);
		bar.selectedId = 'a';
		await settle();
		return { probe: probe(), outlined: bar.shadowRoot.querySelector('.pill--selected')?.dataset.id };
	});
	assert.deepEqual(reselected, { probe: { focused: 'pill:1', tabStops: ['1'] }, outlined: 'a' });
	await page.keyboard.press('Tab');
	assert.equal(await activeId(), 'after');

	const away = await page.evaluate(async () => {
		bar.selectedId = 'c';
		await settle();
		return probe().tabStops;
	});
	assert.deepEqual(away, ['2']);
	assert.deepEqual(errors, []);
});

test('Tab dives into the pill jump legs, and Shift+Tab or Escape returns to the pill', async () => {
	await page.evaluate(() => focusPill(0));
	assert.deepEqual(await press('Tab'), { focused: 'leg:head-a', tabStops: ['0'] });
	assert.deepEqual(await press('ArrowRight'), { focused: 'leg:up-a', tabStops: ['0'] });
	assert.deepEqual(await press('ArrowRight'), { focused: 'leg:up-a', tabStops: ['0'] });
	assert.deepEqual(await press('Home'), { focused: 'leg:head-a', tabStops: ['0'] });
	assert.deepEqual(await press('Shift+Tab'), { focused: 'pill:0', tabStops: ['0'] });
	await press('Tab');
	assert.deepEqual(await press('Escape'), { focused: 'pill:0', tabStops: ['0'] });
	assert.deepEqual(errors, []);
});

test('Escape on a leg stays in the bar, while Escape on a pill reaches the host', async () => {
	await page.evaluate(() => {
		globalThis.hostEscapes = 0;
		document.addEventListener('keydown', e => {
			if (e.key === 'Escape') hostEscapes++;
		});
		return focusPill(0);
	});
	await press('Tab');
	assert.deepEqual(await press('Escape'), { focused: 'pill:0', tabStops: ['0'] });
	assert.equal(await page.evaluate(() => hostEscapes), 0);
	await press('Escape');
	assert.equal(await page.evaluate(() => hostEscapes), 1);
});

test('a pill reads its working-changes, unpushed and agent states in words, not glyphs', async () => {
	const cdp = await page.context().newCDPSession(page);
	const { nodes } = await cdp.send('Accessibility.getFullAXTree');
	const pills = nodes
		.filter(n => n.role?.value === 'button' && ['main', 'feature', 'fix'].includes(n.name?.value))
		.map(n => [n.name.value, n.description?.value ?? '']);
	assert.deepEqual(pills, [
		['main', 'Uncommitted changes and unpushed commits'],
		['feature', 'Uncommitted changes 2 agents, at least one needs input'],
		['fix', 'Unpushed commits Agent working'],
	]);
	const glyphsExposed = await page.evaluate(
		() =>
			bar.shadowRoot.querySelectorAll(
				'.pill__main :is(.pill__dot, .pill__unpushed-icon, .pill__agent):not([aria-hidden="true"])',
			).length,
	);
	assert.equal(glyphsExposed, 0);
});

test('renderAgentStatus replaces the robot, stays hidden from screen readers, and keeps the description', async () => {
	const agents = await page.evaluate(async () => {
		bar.renderAgentStatus = item => {
			const dot = document.createElement('span');
			dot.className = 'host-dot';
			dot.dataset.state = item.agent;
			return dot;
		};
		await settle();
		return [...bar.shadowRoot.querySelectorAll('.pill__agent')].map(el => ({
			hidden: el.getAttribute('aria-hidden'),
			host: el.querySelector('.host-dot')?.dataset.state,
			robot: el.querySelector('code-icon') != null,
		}));
	});
	assert.deepEqual(agents, [
		{ hidden: 'true', host: 'needs-input', robot: false },
		{ hidden: 'true', host: 'working', robot: false },
	]);
	const cdp = await page.context().newCDPSession(page);
	const { nodes } = await cdp.send('Accessibility.getFullAXTree');
	const feature = nodes.find(n => n.role?.value === 'button' && n.name?.value === 'feature');
	assert.equal(feature?.description?.value, 'Uncommitted changes 2 agents, at least one needs input');
});

test('legs render for any pill that supplies leg data, not only the primary', async () => {
	const legs = await page.evaluate(() =>
		[...bar.shadowRoot.querySelectorAll('.pill')].map(pill =>
			[...pill.querySelectorAll('.pill__leg')].map(leg => leg.className),
		),
	);
	assert.deepEqual(legs, [
		[
			'pill__leg pill__leg--head pill__leg--jump',
			'pill__leg pill__leg--upstream pill__leg--jump',
			'pill__leg pill__leg--target',
		],
		[],
		['pill__leg pill__leg--head pill__leg--jump'],
	]);
});

test('the tab stop re-homes when items shrink below the focused pill', async () => {
	await page.evaluate(() => focusPill(0));
	await press('End');
	const actual = await page.evaluate(async () => {
		bar.items = bar.items.slice(0, 2);
		await settle();
		return probe();
	});
	assert.deepEqual(actual, { focused: 'pill:1', tabStops: ['1'] });
	assert.deepEqual(errors, []);
});

test('selecting a pill only asks the host, which owns selectedId', async () => {
	const actual = await page.evaluate(async () => {
		bar.shadowRoot.querySelector('.pill__main[data-index="1"]').click();
		await settle();
		const before = {
			selectedId: bar.selectedId,
			outlined: bar.shadowRoot.querySelectorAll('.pill--selected').length,
		};
		bar.selectedId = 'b';
		await settle();
		const selected = bar.shadowRoot.querySelector('.pill--selected');
		return { events, before, after: selected?.dataset.id, tabStops: probe().tabStops };
	});
	assert.deepEqual(actual.events, [
		{ name: 'select', detail: { id: 'b', branchName: 'feature', repoPath: '/repo-b' }, cancelable: false },
	]);
	assert.deepEqual(actual.before, { selectedId: undefined, outlined: 0 });
	assert.equal(actual.after, 'b');
	assert.deepEqual(actual.tabStops, ['1']);
});

test('a jump leg fires a non-cancelable jump shaped like gl-graph-jumptocommit', async () => {
	const actual = await page.evaluate(async () => {
		bar.shadowRoot.querySelector('.pill__leg--jump[data-sha="up-a"]').click();
		await settle();
		return events;
	});
	assert.deepEqual(actual, [{ name: 'jump', detail: { sha: 'up-a', focus: true, flash: true }, cancelable: false }]);
});

test('without renderHover there is no popover and hovering never asks for stats', async () => {
	const unset = await page.evaluate(async () => {
		await focusPill(1);
		return { popovers: bar.shadowRoot.querySelectorAll('gl-popover').length, events: [...events] };
	});
	assert.deepEqual(unset, { popovers: 0, events: [] });

	const set = await page.evaluate(async () => {
		bar.renderHover = item => item.branchName;
		await settle();
		await focusPill(0);
		await focusPill(1);
		return { popovers: bar.shadowRoot.querySelectorAll('gl-popover').length, events: [...events] };
	});
	assert.equal(set.popovers, 3);
	assert.deepEqual(
		set.events.map(e => [e.name, e.detail.id]),
		[
			['statsneeded', 'a'],
			['statsneeded', 'b'],
		],
	);
	assert.deepEqual(errors, []);
});

test('a shortened pill shows its full branch as a tooltip, unless the host renders hovers', async () => {
	const probe = () =>
		page.evaluate(async () => {
			bar.items = bar.items.map(i =>
				i.id === 'a' ? { ...i, branchName: 'feature/long-branch-name', label: 'long-branch-name' } : i,
			);
			await settle();
			const main = bar.shadowRoot.querySelector('.pill__main[data-index="0"]');
			const tooltip = main.closest('gl-tooltip');
			return {
				tooltip: tooltip?.getAttribute('content') ?? null,
				text: main.textContent.trim(),
				ariaLabel: main.getAttribute('aria-label'),
				unlabelled:
					bar.shadowRoot.querySelectorAll('.pill__main[data-index="1"]')[0].closest('gl-tooltip') == null,
			};
		});
	const bare = await probe();
	assert.deepEqual(bare, {
		tooltip: 'feature/long-branch-name',
		text: 'long-branch-name',
		ariaLabel: 'feature/long-branch-name',
		unlabelled: true,
	});

	const withHover = await page.evaluate(async () => {
		bar.renderHover = item => item.branchName;
		await settle();
		return bar.shadowRoot.querySelector('.pill__main[data-index="0"]').closest('gl-tooltip') == null;
	});
	assert.equal(withHover, true);

	const same = await page.evaluate(async () => {
		bar.renderHover = undefined;
		bar.items = bar.items.map(i => (i.id === 'a' ? { ...i, label: i.branchName } : i));
		await settle();
		return bar.shadowRoot.querySelector('.pill__main[data-index="0"]').closest('gl-tooltip') == null;
	});
	assert.equal(same, true);
	assert.deepEqual(errors, []);
});

test('double-clicking a pill with a branchId asks the host to focus it, carrying the pill id', async () => {
	const actual = await page.evaluate(async () => {
		bar.shadowRoot
			.querySelector('.pill__main[data-index="1"]')
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
		return events;
	});
	assert.deepEqual(actual, [
		{
			name: 'focus',
			detail: { id: 'b', branchId: 'b-id', branchName: 'feature', repoPath: '/repo-b', isPrimary: false },
			cancelable: false,
		},
	]);
});

test('right-click reports the pill and copies its context onto the bar only', async () => {
	const actual = await page.evaluate(async () => {
		const pill = bar.shadowRoot.querySelector('.pill[data-id="c"]');
		const shadowContext = bar.shadowRoot.querySelectorAll('[data-vscode-context]').length;
		pill.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true, clientX: 5, clientY: 6 }),
		);
		return { events, shadowContext, hostContext: bar.dataset.vscodeContext };
	});
	assert.deepEqual(actual, {
		events: [
			{
				name: 'contextmenu',
				detail: {
					id: 'c',
					branchName: 'fix',
					branchId: undefined,
					repoPath: '/repo-c',
					isPrimary: false,
					clientX: 5,
					clientY: 6,
				},
				cancelable: true,
			},
		],
		shadowContext: 0,
		hostContext: '{"webviewItem":"wip"}',
	});
});

test('right-click inside the hover content reports its pill, even on a .pill of its own', async () => {
	const actual = await page.evaluate(async () => {
		await useHover();
		const content = await showHover('c');
		content
			.querySelector('.pill')
			.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true }));
		return {
			menus: events.filter(e => e.name === 'contextmenu').map(e => e.detail.id),
			hostContext: bar.dataset.vscodeContext,
		};
	});
	assert.deepEqual(actual, { menus: ['c'], hostContext: '{"webviewItem":"wip"}' });
	assert.deepEqual(errors, []);
});

test("right-click on a pill without context never opens the previous pill's menu", async () => {
	const actual = await page.evaluate(async () => {
		const contextMenu = id =>
			bar.shadowRoot
				.querySelector(`.pill[data-id="${id}"]`)
				.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true }));
		contextMenu('c');
		const afterContext = bar.dataset.vscodeContext;
		contextMenu('a');
		return { afterContext: afterContext, afterNone: bar.dataset.vscodeContext };
	});
	assert.deepEqual(actual, { afterContext: '{"webviewItem":"wip"}', afterNone: undefined });
});

test("Shift+F10 and the menu key each open the focused pill's menu exactly once", async () => {
	await page.evaluate(() => {
		globalThis.synthetic = 0;
		bar.addEventListener('contextmenu', e => {
			if (!e.isTrusted) {
				synthetic++;
			}
		});
		return focusPill(0);
	});
	for (const key of ['Shift+F10', 'ContextMenu']) {
		await page.keyboard.press(key);
		await page.evaluate(() => settle());
	}
	assert.equal(await page.evaluate(() => synthetic), 2);
	const menus = await page.evaluate(() =>
		events.filter(e => e.name === 'contextmenu').map(e => ({ id: e.detail.id, cancelable: e.cancelable })),
	);
	assert.deepEqual(menus, [
		{ id: 'a', cancelable: true },
		{ id: 'a', cancelable: true },
	]);
	assert.deepEqual(errors, []);
});

test('a wheel inside the hover content leaves the strip where it is', async () => {
	const actual = await page.evaluate(async () => {
		bar.style.display = 'flex';
		bar.style.width = '120px';
		await useHover();
		const content = await showHover('a');
		const strip = bar.shadowRoot.querySelector('.bar');
		const wheel = target => {
			const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, composed: true, cancelable: true });
			target.dispatchEvent(event);
			return event.defaultPrevented;
		};
		return {
			overflows: strip.scrollWidth > strip.clientWidth,
			hoverPanned: wheel(content.querySelector('.nested')),
			pillPanned: wheel(bar.shadowRoot.querySelector('.pill__main[data-index="1"]')),
		};
	});
	assert.deepEqual(actual, { overflows: true, hoverPanned: false, pillPanned: true });
	assert.deepEqual(errors, []);
});

test('a popover closing inside the hover content leaves the pill hover open', async () => {
	const actual = await page.evaluate(async () => {
		await useHover();
		const content = await showHover('a');
		content
			.querySelector('.nested')
			.dispatchEvent(new CustomEvent('gl-popover-after-hide', { bubbles: true, composed: true }));
		await settle();
		const afterNested = hoverCalls.at(-1);
		bar.shadowRoot
			.querySelector('gl-popover[data-id="a"]')
			.dispatchEvent(new CustomEvent('gl-popover-after-hide', { bubbles: true, composed: true }));
		await settle();
		return { afterNested: afterNested, afterOwn: hoverCalls.at(-1) };
	});
	assert.deepEqual(actual, { afterNested: ['a', true], afterOwn: ['a', false] });
	assert.deepEqual(errors, []);
});
