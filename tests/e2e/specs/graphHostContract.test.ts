import * as process from 'node:process';
import { test as base, createTmpDir, expect, GitFixture } from '../baseTest.js';
import { ensureGraphRowsRendered } from '../graphHelpers.js';

type GraphInstanceProbe = {
	rowId: string | undefined;
	rowIdCount: number;
	activeDescendantInside: boolean;
	activeRowLookupInside: boolean;
};

type HostRequestProbe = {
	contextMenu: { cancelled: boolean; detail: unknown; nativePrevented: boolean }[];
	copies: { cancelled: boolean; detail: unknown; announced: string[] }[];
};

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();
				await git.commit('Add first module\n\nExplains the module', 'first.ts', 'export const first = 1;');
				await git.commit('Add latest module', 'latest.ts', 'export const latest = 2;');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Graph — embedding host contract', () => {
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('keeps row ids and the active descendant distinct across two graphs on one page', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graph = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
		expect(graph).not.toBeNull();
		await ensureGraphRowsRendered(vscode, graph!);

		const probes = await graph!
			.locator('gl-commit-graph')
			.first()
			.evaluate(async (original): Promise<GraphInstanceProbe[]> => {
				type ReactiveCtor = { elementProperties: Map<PropertyKey, { state?: boolean }> };
				type ReactiveGraph = HTMLElement &
					Record<PropertyKey, unknown> & { activeRowElement(): HTMLElement | null };

				const ctor = original.constructor as unknown as ReactiveCtor;
				const first = original as ReactiveGraph;
				const second = document.createElement(original.localName) as ReactiveGraph;
				for (const [key, options] of ctor.elementProperties) {
					if (options.state || key === 'keymap') continue;

					second[key] = first[key];
				}
				second.style.cssText = 'position: absolute; top: 0; left: 0; width: 800px; height: 240px;';
				original.after(second);

				try {
					const sha = original.querySelector<HTMLElement>('.gl-graph__row[data-sha]')?.dataset.sha;
					if (sha == null) throw new Error('Expected the mounted graph to render a row');

					const rowSelector = `.gl-graph__row[data-sha="${CSS.escape(sha)}"]`;
					const deadline = Date.now() + 10000;
					while (second.querySelector(rowSelector) == null) {
						if (Date.now() > deadline) throw new Error('Expected the second graph to render the same row');

						await new Promise(resolve => requestAnimationFrame(resolve));
					}

					const root = original.getRootNode() as Document | ShadowRoot;
					return [first, second].map(element => {
						const rowId = element.querySelector(rowSelector)?.id;
						const activeId = element.querySelector('[role="tree"]')?.getAttribute('aria-activedescendant');
						const active = activeId ? root.getElementById(activeId) : null;
						const lookup = element.activeRowElement();
						return {
							rowId: rowId,
							rowIdCount: rowId ? root.querySelectorAll(`[id="${CSS.escape(rowId)}"]`).length : 0,
							activeDescendantInside: active != null && element.contains(active),
							activeRowLookupInside: lookup != null && element.contains(lookup),
						};
					});
				} finally {
					second.remove();
				}
			});

		expect(probes).toHaveLength(2);
		const [first, second] = probes;
		expect(first.rowId).toBeTruthy();
		expect(second.rowId).toBeTruthy();
		expect(first.rowId).not.toBe(second.rowId);
		for (const probe of probes) {
			expect(probe.rowIdCount).toBe(1);
			expect(probe.activeDescendantInside).toBe(true);
			expect(probe.activeRowLookupInside).toBe(true);
		}
	});

	test('lets a host claim or leave the context-menu, copy and jump requests', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graph = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
		expect(graph).not.toBeNull();
		await ensureGraphRowsRendered(vscode, graph!);
		const element = graph!.locator('gl-commit-graph').first();

		const contextMenu = await element.evaluate((original): HostRequestProbe['contextMenu'] => {
			const pill = [...original.querySelectorAll<HTMLElement>('.gl-graph__ref-pill[data-ref-name="main"]')].find(
				candidate => candidate.closest('.gl-graph__wip-branch-pill') == null,
			);
			if (pill == null) throw new Error('Expected the HEAD row to render the main branch pill');

			const results: HostRequestProbe['contextMenu'] = [];
			for (const cancel of [true, false]) {
				let detail: unknown;
				let nativePrevented = false;
				const onRequest = (e: Event): void => {
					detail = (e as CustomEvent).detail;
					if (cancel) {
						e.preventDefault();
					}
				};
				const onNative = (e: Event): void => {
					nativePrevented = e.defaultPrevented;
				};
				original.addEventListener('gl-graph-contextmenu', onRequest);
				original.addEventListener('contextmenu', onNative);
				pill.dispatchEvent(
					new MouseEvent('contextmenu', {
						bubbles: true,
						cancelable: true,
						composed: true,
						clientX: 7,
						clientY: 9,
					}),
				);
				original.removeEventListener('gl-graph-contextmenu', onRequest);
				original.removeEventListener('contextmenu', onNative);
				results.push({ cancelled: cancel, detail: detail, nativePrevented: nativePrevented });
			}
			return results;
		});
		await vscode.page.keyboard.press('Escape');

		const [claimedMenu, nativeMenu] = contextMenu;
		expect(claimedMenu.detail).toMatchObject({
			zone: 'ref',
			clientX: 7,
			clientY: 9,
			ref: { name: 'main', kind: 'head', id: expect.stringMatching(/\|heads\/main$/) },
		});
		expect(claimedMenu.nativePrevented).toBe(true);
		expect(nativeMenu.detail).toMatchObject({ zone: 'ref', ref: { name: 'main' } });
		expect(nativeMenu.nativePrevented).toBe(false);

		await graph!.getByRole('tree', { name: 'Commit graph' }).focus();
		const copies: HostRequestProbe['copies'] = [];
		for (const cancel of [true, false]) {
			await element.evaluate((original, cancel) => {
				type Probe = { detail?: unknown; announced: string[]; restore?: () => void };
				const graphElement = original as HTMLElement & { announce(message: string): void };
				const announce = graphElement.announce;
				const probe: Probe = { announced: [] };
				const onRequest = (e: Event): void => {
					probe.detail = (e as CustomEvent).detail;
					if (cancel) {
						e.preventDefault();
					}
				};
				probe.restore = () => {
					graphElement.announce = announce;
					original.removeEventListener('gl-graph-copyrequest', onRequest);
				};
				graphElement.announce = (message: string) => {
					probe.announced.push(message);
					announce.call(graphElement, message);
				};
				original.addEventListener('gl-graph-copyrequest', onRequest);
				(globalThis as unknown as { __glCopyProbe: Probe }).__glCopyProbe = probe;
			}, cancel);
			await vscode.page.keyboard.press('ControlOrMeta+c');
			const result = await element.evaluate(() => {
				const probe = (
					globalThis as unknown as {
						__glCopyProbe: { detail?: unknown; announced: string[]; restore?: () => void };
					}
				).__glCopyProbe;
				probe.restore?.();
				return { detail: probe.detail, announced: probe.announced };
			});
			copies.push({ cancelled: cancel, ...result });
		}

		const [claimedCopy, nativeCopy] = copies;
		expect(claimedCopy.detail).toMatchObject({ sha: expect.any(String), vscodeContext: expect.any(String) });
		expect(claimedCopy.announced).toEqual([]);
		expect(nativeCopy.detail).toMatchObject({ sha: (claimedCopy.detail as { sha: string }).sha });
		expect(nativeCopy.announced).toEqual(['Copied.']);

		const jumps = await element.evaluate(async original => {
			type JumpingGraph = HTMLElement &
				Record<PropertyKey, unknown> & {
					jumpToRefRow(sha: string, options?: { focus?: boolean; flash?: boolean }): void;
				};
			type ReactiveCtor = { elementProperties: Map<PropertyKey, { state?: boolean }> };

			const first = original as JumpingGraph;
			const target = original.querySelector<HTMLElement>('.gl-graph__row[data-sha]:not([aria-selected="true"])')
				?.dataset.sha;
			if (target == null) throw new Error('Expected an unselected loaded row to jump to');

			let claimedByGitLens: CustomEvent | undefined;
			const onFirstJump = (e: Event): void => {
				claimedByGitLens = e as CustomEvent;
			};
			original.addEventListener('gl-graph-jumptocommit', onFirstJump);
			first.jumpToRefRow(target, { focus: false, flash: true });
			original.removeEventListener('gl-graph-jumptocommit', onFirstJump);

			const ctor = original.constructor as unknown as ReactiveCtor;
			const second = document.createElement(original.localName) as JumpingGraph;
			for (const [key, options] of ctor.elementProperties) {
				if (options.state || key === 'keymap') continue;

				second[key] = first[key];
			}
			second.style.cssText = 'position: absolute; top: 0; left: 0; width: 800px; height: 240px;';
			let unclaimed: CustomEvent | undefined;
			second.addEventListener('gl-graph-jumptocommit', e => {
				unclaimed = e as CustomEvent;
				e.stopPropagation();
			});
			original.after(second);
			try {
				const unselected = '.gl-graph__row[data-sha]:not([aria-selected="true"])';
				const deadline = Date.now() + 10000;
				while (second.querySelector(unselected) == null) {
					if (Date.now() > deadline) throw new Error('Expected the second graph to render an unselected row');

					await new Promise(resolve => requestAnimationFrame(resolve));
				}
				const secondTarget = second.querySelector<HTMLElement>(unselected)!.dataset.sha!;
				const selector = `.gl-graph__row[data-sha="${CSS.escape(secondTarget)}"]`;

				const focusedBefore = document.activeElement;
				second.jumpToRefRow(secondTarget, { focus: false, flash: true });
				await new Promise(resolve => requestAnimationFrame(resolve));
				await new Promise(resolve => requestAnimationFrame(resolve));
				return {
					gitLensClaimed: claimedByGitLens?.cancelable === true && claimedByGitLens.defaultPrevented,
					unclaimedCancelable: unclaimed?.cancelable === true && !unclaimed.defaultPrevented,
					landedSelected: second.querySelector(selector)?.getAttribute('aria-selected') === 'true',
					focusKept: document.activeElement === focusedBefore,
				};
			} finally {
				second.remove();
			}
		});

		expect(jumps).toEqual({
			gitLensClaimed: true,
			unclaimedCancelable: true,
			landedSelected: true,
			focusKept: true,
		});
	});

	test('drives a graph mounted without a host keymap from the keyboard', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graph = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
		expect(graph).not.toBeNull();
		await ensureGraphRowsRendered(vscode, graph!);
		const element = graph!.locator('gl-commit-graph').first();

		type KeyboardProbe = { activeDescendant: string | null; usesDefaultKeymap: boolean };
		type ProbeGlobals = { __glKeyboardGraph?: HTMLElement };

		const before = await element.evaluate(async (original): Promise<KeyboardProbe[]> => {
			type ReactiveCtor = { elementProperties: Map<PropertyKey, { state?: boolean }> };
			type ReactiveGraph = HTMLElement & Record<PropertyKey, unknown>;

			const ctor = original.constructor as unknown as ReactiveCtor;
			const first = original as ReactiveGraph;
			const second = document.createElement(original.localName) as ReactiveGraph;
			for (const [key, options] of ctor.elementProperties) {
				if (options.state || key === 'keymap') continue;

				second[key] = first[key];
			}
			second.style.cssText = 'position: absolute; top: 0; left: 0; width: 800px; height: 240px;';
			original.after(second);
			(globalThis as ProbeGlobals).__glKeyboardGraph = second;

			const deadline = Date.now() + 10000;
			while (second.querySelectorAll('.gl-graph__row[data-sha]').length < 2) {
				if (Date.now() > deadline) throw new Error('Expected the second graph to render two rows');

				await new Promise(resolve => requestAnimationFrame(resolve));
			}

			second.querySelector<HTMLElement>('[role="tree"]')!.focus();
			return [first, second].map(graphElement => ({
				activeDescendant: graphElement.querySelector('[role="tree"]')!.getAttribute('aria-activedescendant'),
				usesDefaultKeymap: graphElement._defaultKeymap != null,
			}));
		});

		await vscode.page.keyboard.press('ArrowDown');

		const after = await element.evaluate(async (original): Promise<KeyboardProbe[]> => {
			const second = (globalThis as ProbeGlobals).__glKeyboardGraph!;
			try {
				await new Promise(resolve => requestAnimationFrame(resolve));
				return [original, second].map(graphElement => ({
					activeDescendant: graphElement
						.querySelector('[role="tree"]')!
						.getAttribute('aria-activedescendant'),
					usesDefaultKeymap:
						(graphElement as HTMLElement & Record<PropertyKey, unknown>)._defaultKeymap != null,
				}));
			} finally {
				second.remove();
				delete (globalThis as ProbeGlobals).__glKeyboardGraph;
			}
		});

		const [gitLensBefore, defaultBefore] = before;
		const [gitLensAfter, defaultAfter] = after;
		expect(gitLensBefore.usesDefaultKeymap).toBe(false);
		expect(defaultBefore.usesDefaultKeymap).toBe(true);
		expect(defaultAfter.activeDescendant).not.toBe(defaultBefore.activeDescendant);
		expect(gitLensAfter.activeDescendant).toBe(gitLensBefore.activeDescendant);
	});

	test('renders host row adornments and only the built-in row actions the host serves', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graph = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
		expect(graph).not.toBeNull();
		await ensureGraphRowsRendered(vscode, graph!);
		const element = graph!.locator('gl-commit-graph').first();

		type HostGlobals = {
			__glHostGraph?: HTMLElement & { focusRow(sha: string): boolean };
			__glHostClicks?: string[];
			__glHostSetLabel?: (label: string) => void;
		};

		const mounted = await element.evaluate(async original => {
			type ReactiveCtor = { elementProperties: Map<PropertyKey, { state?: boolean }> };
			type ReactiveGraph = HTMLElement & Record<PropertyKey, unknown> & { focusRow(sha: string): boolean };
			type Row = { sha: string; kind: string };

			const globals = globalThis as HostGlobals;
			const clicks: string[] = [];
			let label = 'Agent one';
			const invalidate = new EventTarget();
			const provider = {
				invalidate: invalidate,
				provideRowAdornment: (row: Row) => (row.kind === 'workdir' ? undefined : { visibility: true }),
				resolveAdornment: (row: Row) => {
					const chip = document.createElement('button');
					chip.type = 'button';
					chip.tabIndex = -1;
					chip.className = 'e2e-host-chip';
					chip.dataset.rowControl = '';
					chip.dataset.tooltip = label;
					chip.setAttribute('aria-label', label);
					chip.textContent = label;
					chip.addEventListener('click', () => clicks.push(row.sha));
					return chip;
				},
				describeForA11y: () => `host ${label}`,
			};
			globals.__glHostClicks = clicks;
			globals.__glHostSetLabel = next => {
				label = next;
				invalidate.dispatchEvent(new CustomEvent('invalidate', { detail: { type: 'all' } }));
			};

			const ctor = original.constructor as unknown as ReactiveCtor;
			const first = original as ReactiveGraph;
			const second = document.createElement(original.localName) as ReactiveGraph;
			for (const [key, options] of ctor.elementProperties) {
				if (options.state || key === 'keymap') continue;

				second[key] = first[key];
			}
			second.profile = Object.freeze({ ...(first.profile as object), rowAdornments: [provider] });
			second.supportedRowActions = [];
			second.style.cssText = 'position: absolute; top: 0; left: 0; width: 800px; height: 240px;';
			original.after(second);
			globals.__glHostGraph = second;

			const deadline = Date.now() + 10000;
			while (second.querySelectorAll('.e2e-host-chip').length < 3) {
				if (Date.now() > deadline) throw new Error('Expected the host chips on every commit row');

				await new Promise(resolve => requestAnimationFrame(resolve));
			}

			const rows = [...second.querySelectorAll<HTMLElement>('.gl-graph__row[data-sha]')].filter(
				row => row.querySelector('.e2e-host-chip') != null,
			);
			const headRow = rows.find(row => row.querySelector('.gl-graph__ref-pill') != null) ?? rows[0];
			const otherRow = rows.find(row => row !== headRow)!;
			const otherChip = otherRow.querySelector<HTMLElement>('.e2e-host-chip')!;
			otherChip.click();

			return {
				labelled: rows.every(row => row.getAttribute('aria-label')?.includes('host Agent one') === true),
				hostRowActions: rows.reduce((n, row) => n + row.querySelectorAll('.gl-graph__row-action').length, 0),
				gitLensOpenChanges: original.querySelectorAll('[data-row-action="open-changes"]').length,
				clicked: clicks.includes(otherRow.dataset.sha!),
				clickSelected: otherRow.getAttribute('aria-selected') === 'true',
				headSha: headRow.dataset.sha!,
			};
		});

		expect(mounted).toMatchObject({
			labelled: true,
			hostRowActions: 0,
			clicked: true,
			clickSelected: false,
		});
		expect(mounted.gitLensOpenChanges).toBeGreaterThan(0);

		try {
			await element.evaluate(() => (globalThis as HostGlobals).__glHostSetLabel!('Agent two'));
			await expect
				.poll(() =>
					element.evaluate(() =>
						Array.from(
							(globalThis as HostGlobals).__glHostGraph!.querySelectorAll('.e2e-host-chip'),
							chip => chip.textContent,
						),
					),
				)
				.toEqual(['Agent two', 'Agent two', 'Agent two']);

			await element.evaluate((_, sha) => {
				const second = (globalThis as HostGlobals).__glHostGraph!;
				second.querySelector<HTMLElement>('[role="tree"]')!.focus();
				second.focusRow(sha);
			}, mounted.headSha);
			let focusedChip = false;
			for (let i = 0; i < 4 && !focusedChip; i++) {
				await vscode.page.keyboard.press('Tab');
				focusedChip = await element.evaluate(() => {
					const active = (globalThis as HostGlobals).__glHostGraph!.ownerDocument.activeElement;
					return active?.classList.contains('e2e-host-chip') === true;
				});
			}
			expect(focusedChip).toBe(true);
			await expect
				.poll(() =>
					element.evaluate(() => {
						const second = (globalThis as HostGlobals).__glHostGraph!;
						const popover = second.querySelector<HTMLElement & { open?: boolean }>(
							'gl-popover.gl-graph__tooltip',
						);
						return popover?.open === true
							? (second.querySelector('.gl-graph__tooltip-content')?.textContent?.trim() ?? '')
							: '';
					}),
				)
				.toBe('Agent two');
		} finally {
			await element.evaluate(() => {
				const globals = globalThis as HostGlobals;
				globals.__glHostGraph?.remove();
				delete globals.__glHostGraph;
				delete globals.__glHostClicks;
				delete globals.__glHostSetLabel;
			});
		}
	});

	test('lets a host own the header settings button and hangs header geometry from its height', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graph = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
		expect(graph).not.toBeNull();
		await ensureGraphRowsRendered(vscode, graph!);

		const header = await graph!
			.locator('gl-commit-graph')
			.first()
			.evaluate(async original => {
				type ReactiveCtor = { elementProperties: Map<PropertyKey, { state?: boolean }> };
				type ReactiveGraph = HTMLElement & Record<PropertyKey, unknown> & { updateComplete: Promise<boolean> };
				const frame = () => new Promise(resolve => requestAnimationFrame(resolve));

				const ctor = original.constructor as unknown as ReactiveCtor;
				const first = original as ReactiveGraph;
				const second = document.createElement(original.localName) as ReactiveGraph;
				for (const [key, options] of ctor.elementProperties) {
					if (options.state || key === 'keymap') continue;

					second[key] = first[key];
				}
				second.vscode = { ...(first.vscode as object), settingsContext: undefined };
				second.headerMenu = { label: 'Columns', open: false };
				second.config = { ...(first.config as object), placementControls: false, showCommitMessageBody: false };
				second.style.cssText = 'position: absolute; top: 0; left: 0; width: 800px; height: 240px;';
				original.after(second);

				try {
					const deadline = Date.now() + 10000;
					while (
						second.querySelector('.gl-graph__header-settings') == null ||
						second.style.getPropertyValue('--gl-graph-header-height') === ''
					) {
						if (Date.now() > deadline) throw new Error('Expected the second graph to render its header');

						await frame();
					}

					const gear = second.querySelector<HTMLElement>('.gl-graph__header-settings')!;
					const closed = gear.getAttribute('aria-expanded');
					second.headerMenu = { label: 'Columns', open: true };
					await second.updateComplete;
					const opened = gear.getAttribute('aria-expanded');

					const nativeMenus: EventTarget[] = [];
					second.addEventListener('contextmenu', e => nativeMenus.push(e.target!));
					let anchor: DOMRect | undefined;
					const claim = (e: Event): void => {
						anchor = (e as CustomEvent<{ anchor: DOMRect }>).detail.anchor;
						e.preventDefault();
					};
					second.addEventListener('gl-graph-headermenu', claim);
					gear.click();
					second.removeEventListener('gl-graph-headermenu', claim);
					const claimedNativeMenus = nativeMenus.length;
					gear.click();

					const cell = second.querySelector<HTMLElement>('.gl-graph__header-cell')!;
					const cellRect = cell.getBoundingClientRect();
					const rightClick = (): MouseEvent => {
						const event = new MouseEvent('contextmenu', {
							bubbles: true,
							cancelable: true,
							composed: true,
							button: 2,
							clientX: Math.round(cellRect.left) + 3,
							clientY: Math.round(cellRect.top) + 4,
						});
						cell.dispatchEvent(event);
						return event;
					};
					let rightClickMenus = 0;
					const countMenu = (): void => {
						rightClickMenus++;
					};
					let rightClickAnchor: DOMRect | undefined;
					const claimRightClick = (e: Event): void => {
						rightClickAnchor = (e as CustomEvent<{ anchor: DOMRect }>).detail.anchor;
						e.preventDefault();
					};
					const pageMenus: Event[] = [];
					const onPageMenu = (e: Event): void => {
						pageMenus.push(e);
					};
					document.addEventListener('contextmenu', onPageMenu);
					second.addEventListener('gl-graph-headermenu', countMenu);
					second.addEventListener('gl-graph-headermenu', claimRightClick);
					const claimedRightClick = rightClick();
					second.removeEventListener('gl-graph-headermenu', claimRightClick);
					const unclaimedRightClick = rightClick();
					second.removeEventListener('gl-graph-headermenu', countMenu);
					document.removeEventListener('contextmenu', onPageMenu);

					const headerEl = second.querySelector<HTMLElement>('.gl-graph__header')!;
					headerEl.style.height = '40px';
					const resizeDeadline = Date.now() + 5000;
					while (
						second.style.getPropertyValue('--gl-graph-header-height') !== `${headerEl.offsetHeight}px` &&
						Date.now() < resizeDeadline
					) {
						await frame();
					}
					await frame();
					// KEEP: a just-drawn graph dates its rows now, while GitLens's redraws its relative dates on a timer.
					document.dispatchEvent(new Event('visibilitychange'));
					await Promise.all([first.updateComplete, second.updateComplete]);
					await frame();
					const sameLabels = [...second.querySelectorAll<HTMLElement>('.gl-graph__row[data-sha]')].every(
						row =>
							row.getAttribute('aria-label') ===
							original
								.querySelector(`.gl-graph__row[data-sha="${CSS.escape(row.dataset.sha!)}"]`)
								?.getAttribute('aria-label'),
					);
					const rail = second.querySelector<HTMLElement>('.gl-graph__scroll-markers');
					return {
						label: gear.getAttribute('aria-label'),
						tooltip: gear.dataset.tooltip,
						popup: gear.getAttribute('aria-haspopup'),
						closed: closed,
						opened: opened,
						anchorWidth: anchor?.width ?? 0,
						rightClickAnchor: rightClickAnchor && {
							x: rightClickAnchor.x,
							y: rightClickAnchor.y,
							width: rightClickAnchor.width,
							height: rightClickAnchor.height,
						},
						cellPointer: { x: Math.round(cellRect.left) + 3, y: Math.round(cellRect.top) + 4 },
						claimedRightClickPrevented: claimedRightClick.defaultPrevented,
						claimedRightClickReachedPage: pageMenus.includes(claimedRightClick),
						unclaimedRightClickReachedPage: pageMenus.includes(unclaimedRightClick),
						rightClickMenus: rightClickMenus,
						claimedNativeMenus: claimedNativeMenus,
						unclaimedNativeMenu: nativeMenus[claimedNativeMenus] === gear,
						placementToggles: second.querySelectorAll('[data-roving-key^="placement:"]').length,
						gitLensPlacementToggles: original.querySelectorAll('[data-roving-key^="placement:"]').length,
						gitLensHeaderHeight: (original as HTMLElement).style.getPropertyValue(
							'--gl-graph-header-height',
						),
						headerHeight: second.style.getPropertyValue('--gl-graph-header-height'),
						renderedHeaderHeight: `${headerEl.offsetHeight}px`,
						railTop: rail != null ? getComputedStyle(rail).top : undefined,
						messageBodies: second.querySelectorAll('.gl-graph__message-body, .gl-graph__message-sep')
							.length,
						gitLensMessageBodies: original.querySelectorAll('.gl-graph__message-body').length,
						sameLabels: sameLabels,
					};
				} finally {
					second.remove();
				}
			});
		await vscode.page.keyboard.press('Escape');

		expect(header).toMatchObject({
			label: 'Columns',
			tooltip: 'Columns',
			popup: 'menu',
			closed: 'false',
			opened: 'true',
			claimedNativeMenus: 0,
			unclaimedNativeMenu: true,
			claimedRightClickPrevented: true,
			claimedRightClickReachedPage: false,
			unclaimedRightClickReachedPage: true,
			rightClickMenus: 2,
			placementToggles: 0,
			gitLensHeaderHeight: '25px',
			messageBodies: 0,
			sameLabels: true,
		});
		expect(header.gitLensMessageBodies).toBeGreaterThan(0);
		expect(header.anchorWidth).toBeGreaterThan(0);
		expect(header.rightClickAnchor).toEqual({
			x: header.cellPointer.x,
			y: header.cellPointer.y,
			width: 0,
			height: 0,
		});
		expect(header.gitLensPlacementToggles).toBeGreaterThan(0);
		expect(header.headerHeight).toBe(header.renderedHeaderHeight);
		expect(header.headerHeight).not.toBe('25px');
		if (header.railTop != null) {
			expect(header.railTop).toBe(header.headerHeight);
		}
	});

	test('lands a reveal whose rows change mid-travel, and drops one whose row goes away', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graph = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
		expect(graph).not.toBeNull();
		await ensureGraphRowsRendered(vscode, graph!);

		const reveal = await graph!
			.locator('gl-commit-graph')
			.first()
			.evaluate(async original => {
				type ReactiveCtor = { elementProperties: Map<PropertyKey, { state?: boolean }> };
				type RevealingGraph = HTMLElement &
					Record<PropertyKey, unknown> & {
						scrollToSha(sha: string, options?: { mode?: 'always' | 'if-changed'; flash?: boolean }): void;
						activeRevealSha: string | undefined;
					};
				const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
				const sha = (n: number) => n.toString(16).padStart(40, '0');
				const commit = (n: number, parents: string[]) => ({
					sha: sha(n),
					parents: parents,
					author: 'Ada',
					email: 'ada@example.com',
					date: Date.now() - n * 3_600_000,
					message: `Synthetic ${n}`,
					kind: 'commit',
				});
				const rows = Array.from({ length: 300 }, (_, n) => commit(n, n < 299 ? [sha(n + 1)] : []));

				const ctor = original.constructor as unknown as ReactiveCtor;
				const first = original as RevealingGraph;
				const second = document.createElement(original.localName) as RevealingGraph;
				for (const [key, options] of ctor.elementProperties) {
					if (options.state || key === 'keymap') continue;

					second[key] = first[key];
				}
				second.rows = rows;
				second.style.cssText = 'position: absolute; top: 0; left: 0; width: 800px; height: 240px;';
				original.after(second);

				try {
					const deadline = Date.now() + 10000;
					while (second.querySelector(`.gl-graph__row[data-sha="${sha(0)}"]`) == null) {
						if (Date.now() > deadline) throw new Error('Expected the synthetic rows to render');

						await frame();
					}

					const target = sha(280);
					second.scrollToSha(target, { mode: 'always' });
					await frame();
					await frame();
					const travelling = second.activeRevealSha === target;
					second.rows = [commit(1000, [sha(0)]), ...rows];
					await new Promise(resolve => setTimeout(resolve, 1500));

					const scroller = second.querySelector<HTMLElement>('lit-virtualizer')!.getBoundingClientRect();
					const row = second.querySelector(`.gl-graph__row[data-sha="${target}"]`)?.getBoundingClientRect();
					const landed = row != null && row.top >= scroller.top && row.bottom <= scroller.bottom;

					second.scrollToSha(sha(10), { mode: 'always' });
					await frame();
					await frame();
					second.rows = rows.slice(0, 5);
					await frame();
					await frame();
					return { travelling: travelling, landed: landed, dropped: second.activeRevealSha === undefined };
				} finally {
					second.remove();
				}
			});

		expect(reveal).toEqual({ travelling: true, landed: true, dropped: true });
	});

	test('merges ref metadata answers without dropping earlier ones', async ({ vscode }) => {
		await using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graph = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
		expect(graph).not.toBeNull();
		await ensureGraphRowsRendered(vscode, graph!);

		const metadata = await graph!
			.locator('gl-commit-graph')
			.first()
			.evaluate(original => {
				type MetadataGraph = HTMLElement & {
					refsMetadata: Record<string, unknown> | null | undefined;
					addRefsMetadata(metadata: Record<string, unknown>): void;
				};
				const second = document.createElement(original.localName) as MetadataGraph;
				const upstream = { upstream: { name: 'origin/a', owner: 'origin', ahead: 1, behind: 0 } };

				second.refsMetadata = { a: upstream };
				second.addRefsMetadata({ b: null });
				second.addRefsMetadata({ a: { ...upstream, pullRequest: null } });
				const merged = second.refsMetadata;

				second.refsMetadata = null;
				second.addRefsMetadata({ c: null });
				const off = second.refsMetadata;

				return { merged: merged, off: off };
			});

		expect(metadata).toEqual({
			merged: {
				a: { upstream: { name: 'origin/a', owner: 'origin', ahead: 1, behind: 0 }, pullRequest: null },
				b: null,
			},
			off: null,
		});
	});
});
