import * as assert from 'assert';
import type { TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import * as sinon from 'sinon';
import type { AIReviewFinding, AIReviewFocusArea, AIReviewResult } from '@gitlens/ai/models/results.js';
import { withAgentFindings } from '../detailsWorkflowController.js';
import { deepReviewClickGuardMs, GlDetailsReviewModePanel } from '../gl-details-review-mode-panel.js';
import type { ReviewSession } from '../reviewSession.js';
import { agentFocusAreaId, emptyReviewSession, userFocusAreaId } from '../reviewSession.js';

/** Minimal `this` for {@link GlDetailsReviewModePanel.willUpdate} on a `result` change — the per-result
 *  state it resets or keeps, and what the findings index reads. */
type WillUpdateHarness = {
	result?: AIReviewResult;
	session: ReviewSession;
	_expandedAreas: Set<string>;
	_showClosedFindings: boolean;
	_loadingAreas: Set<string>;
	_errorAreas: Set<string>;
	_sessionRevision: number;
	_fileFindings?: unknown;
};

const willUpdate: (this: WillUpdateHarness, changedProperties: Map<string, unknown>) => void = Reflect.get(
	GlDetailsReviewModePanel.prototype,
	'willUpdate',
);

function setResult(panel: WillUpdateHarness, next: AIReviewResult | undefined): void {
	const prev = panel.result;
	panel.result = next;
	willUpdate.call(panel, new Map([['result', prev]]));
}

const twoPassResult: AIReviewResult = {
	overview: 'Two areas',
	mode: 'two-pass',
	focusAreas: [
		{ id: 'retry', label: 'Retry', rationale: '', severity: 'warning', files: ['src/retry.ts'] },
		{ id: 'service', label: 'Service', rationale: '', severity: 'critical', files: ['src/service.ts'] },
	],
};

const agentFinding: AIReviewFinding = {
	id: 'agent-1',
	severity: 'critical',
	title: 'Unhandled promise',
	description: 'The retry loop drops the rejection.',
	filePath: 'src/service.ts',
	lineRange: { start: 12, end: 14 },
	source: 'agent',
};

function makePanel(): WillUpdateHarness {
	const panel: WillUpdateHarness = {
		session: emptyReviewSession,
		_expandedAreas: new Set(),
		_showClosedFindings: false,
		_loadingAreas: new Set(),
		_errorAreas: new Set(),
		_sessionRevision: 0,
	};
	setResult(panel, twoPassResult);
	return panel;
}

suite('GlDetailsReviewModePanel per-result state', () => {
	test("the agent's first finding keeps the reader's state and an in-flight two-pass analysis", () => {
		const panel = makePanel();
		panel._expandedAreas = new Set(['retry']);
		panel._showClosedFindings = true;
		panel._loadingAreas = new Set(['retry']);
		panel._errorAreas = new Set(['service']);

		setResult(panel, withAgentFindings(panel.result, [agentFinding]));

		assert.deepStrictEqual([...panel._expandedAreas], ['retry', agentFocusAreaId]);
		assert.strictEqual(panel._showClosedFindings, true);
		assert.deepStrictEqual([...panel._loadingAreas], ['retry']);
		assert.deepStrictEqual([...panel._errorAreas], ['service']);
	});

	test("the agent's later findings leave its area as the reader set it", () => {
		const panel = makePanel();
		setResult(panel, withAgentFindings(panel.result, [agentFinding]));
		panel._expandedAreas = new Set(['retry']);

		setResult(panel, withAgentFindings(panel.result, [{ ...agentFinding, id: 'agent-2' }]));

		assert.deepStrictEqual([...panel._expandedAreas], ['retry']);
	});

	test('the agent area alone opens, as a single-area result does', () => {
		const panel = makePanel();
		setResult(panel, undefined);

		setResult(panel, withAgentFindings(undefined, [agentFinding]));

		assert.deepStrictEqual([...panel._expandedAreas], [agentFocusAreaId]);
	});

	test('a new run still resets the per-result state', () => {
		const panel = makePanel();
		setResult(panel, withAgentFindings(panel.result, [agentFinding]));
		panel._showClosedFindings = true;
		panel._loadingAreas = new Set(['retry']);

		setResult(panel, {
			...twoPassResult,
			focusAreas: [{ ...twoPassResult.focusAreas[0], id: 'timeouts' }, twoPassResult.focusAreas[1]],
		});

		assert.strictEqual(panel._expandedAreas.size, 0);
		assert.strictEqual(panel._showClosedFindings, false);
		assert.strictEqual(panel._loadingAreas.size, 0);
	});
});

/** Minimal `this` for the Review in Repo button: what disables it, and the click guard's state. */
type DeepReviewButtonHarness = {
	deepReview?: { active: boolean; done: boolean; count: number; purpose?: 'review' | 'ask' };
	deepReviewUnavailableReason?: string;
	_deepReviewClickGuard: boolean;
	_deepReviewClickTimer?: ReturnType<typeof setTimeout>;
};

const isDeepReviewDisabled: (this: DeepReviewButtonHarness, hasSelectedFiles: boolean) => boolean = Reflect.get(
	GlDetailsReviewModePanel.prototype,
	'isDeepReviewDisabled',
);
const takeDeepReviewClick: (this: DeepReviewButtonHarness) => boolean = Reflect.get(
	GlDetailsReviewModePanel.prototype,
	'takeDeepReviewClick',
);

suite('GlDetailsReviewModePanel Review in Repo button', () => {
	let clock: sinon.SinonFakeTimers | undefined;

	teardown(() => {
		clock?.restore();
		clock = undefined;
	});

	test('stays enabled while a review in the repository runs and the agent has not said it is done', () => {
		const panel: DeepReviewButtonHarness = {
			deepReview: { active: true, done: false, count: 2, purpose: 'review' },
			_deepReviewClickGuard: false,
		};

		assert.strictEqual(isDeepReviewDisabled.call(panel, true), false);
	});

	test('is disabled only where it cannot start', () => {
		const panel: DeepReviewButtonHarness = { _deepReviewClickGuard: false };
		assert.strictEqual(isDeepReviewDisabled.call(panel, false), true, 'no files selected');

		panel.deepReviewUnavailableReason = 'no agent';
		assert.strictEqual(isDeepReviewDisabled.call(panel, true), true, 'the host said it is unavailable');
	});

	test('a click turns it off for a moment, absorbs the second click, and turns it back on', () => {
		clock = sinon.useFakeTimers();
		const panel: DeepReviewButtonHarness = { _deepReviewClickGuard: false };

		assert.strictEqual(takeDeepReviewClick.call(panel), true, 'the first click starts a review');
		assert.strictEqual(isDeepReviewDisabled.call(panel, true), true);
		assert.strictEqual(takeDeepReviewClick.call(panel), false, 'a double click does not start another');

		clock.tick(deepReviewClickGuardMs - 1);
		assert.strictEqual(isDeepReviewDisabled.call(panel, true), true);

		clock.tick(1);
		assert.strictEqual(isDeepReviewDisabled.call(panel, true), false, 'back on, whatever the channel did');
		assert.strictEqual(takeDeepReviewClick.call(panel), true, 'and the next click starts a new review');
	});
});

/** Minimal `this` for {@link GlDetailsReviewModePanel.renderContent} in the error state: the panes and the
 *  focus area render to markers, so what is checked is what the error state puts together. */
type ErrorStateHarness = {
	status: 'error';
	errorMessage?: string;
	result?: AIReviewResult;
	session: ReviewSession;
	renderWithChecklist: (aiContent: TemplateResult) => TemplateResult;
	renderDeepReviewStrip: () => typeof nothing;
	renderFocusArea: (area: AIReviewFocusArea) => string;
};

const renderContent: (this: ErrorStateHarness) => TemplateResult = Reflect.get(
	GlDetailsReviewModePanel.prototype,
	'renderContent',
);

/** Every template in `value`, nested ones included, outermost first. */
function collectTemplates(value: unknown, into: TemplateResult[] = []): TemplateResult[] {
	if (Array.isArray(value)) {
		for (const v of value) {
			collectTemplates(v, into);
		}
	} else if (value != null && typeof value === 'object' && 'strings' in value && 'values' in value) {
		const template = value as TemplateResult;
		into.push(template);
		collectTemplates(template.values, into);
	}
	return into;
}

function renderErrorPane(result: AIReviewResult | undefined): { templates: TemplateResult[]; areas: string[] } {
	const areas: string[] = [];
	const panel: ErrorStateHarness = {
		status: 'error',
		errorMessage: 'rate limited',
		result: result,
		session: emptyReviewSession,
		renderWithChecklist: aiContent => aiContent,
		renderDeepReviewStrip: () => nothing,
		renderFocusArea: area => {
			areas.push(area.id);
			return `area:${area.id}`;
		},
	};
	return { templates: collectTemplates(renderContent.call(panel)), areas: areas };
}

/** The events the buttons in `templates` send when each is clicked. */
function clickButtons(templates: TemplateResult[]): string[] {
	const sent: string[] = [];
	const currentTarget = { dispatchEvent: (e: Event) => sent.push(e.type) };
	for (const template of templates) {
		template.strings.forEach((s, i) => {
			const handler = template.values[i];
			if (s.trimEnd().endsWith('@click=') && typeof handler === 'function') {
				(handler as (e: unknown) => void)({ currentTarget: currentTarget });
			}
		});
	}
	return sent.sort();
}

suite('GlDetailsReviewModePanel error state', () => {
	const comment: AIReviewFinding = {
		id: 'user-1',
		severity: 'suggestion',
		title: '',
		description: 'why here?',
		filePath: 'src/service.ts',
		lineRange: { start: 3, end: 3 },
		source: 'user',
	};

	test("keeps the reader's comments below the error, with Retry and Go Back", () => {
		const { templates, areas } = renderErrorPane({
			overview: '',
			mode: 'single-pass',
			focusAreas: [
				{
					id: userFocusAreaId,
					label: 'Your comments',
					rationale: '',
					severity: 'suggestion',
					files: ['src/service.ts'],
					findings: [comment],
				},
			],
		});

		const error = templates.findIndex(t => t.strings.some(s => s.includes('class="panel-error"')));
		const comments = templates.findIndex(t => t.values.includes(`area:${userFocusAreaId}`));
		assert.notStrictEqual(error, -1, 'the error shows');
		assert.ok(comments > error, 'the comments show, below the error');
		assert.ok(templates[error].values.includes('rate limited'));
		assert.deepStrictEqual(areas, [userFocusAreaId]);
		assert.deepStrictEqual(clickButtons(templates), ['review-error-back', 'review-error-retry']);
	});

	test('without comments shows the error alone', () => {
		const { templates, areas } = renderErrorPane(undefined);

		assert.ok(templates.some(t => t.strings.some(s => s.includes('class="panel-error"'))));
		assert.deepStrictEqual(areas, []);
		assert.deepStrictEqual(clickButtons(templates), ['review-error-back', 'review-error-retry']);
	});
});

/** The icon-only `gl-button`s and `gl-copy-container`s in `templates` that have no accessible name, by
 *  their icon. A `tooltip` is not a name — gl-tooltip only shows the text — so the name is the bound
 *  `aria-label`, or for a copy control its `copyLabel`, which it falls back to. */
function unnamedIconButtons(templates: TemplateResult[]): string[] {
	const unnamed: string[] = [];
	for (const template of templates) {
		// The bindings as markers, so a tag's attributes can be told from its content
		const markup = template.strings.reduce((acc, s, i) => `${acc}\u0000${i - 1}\u0000${s}`);
		const bound = (attrs: string, name: string): unknown => {
			const binding = new RegExp(`\\s${name}=\\u0000(\\d+)\\u0000`).exec(attrs);
			return binding != null ? template.values[Number(binding[1])] : undefined;
		};
		// A lookahead, so a button wrapped in a copy control is checked too
		for (const [, tag, attrs, content] of markup.matchAll(
			/<(gl-button|gl-copy-container)\b(?=([^>]*)>([\s\S]*?)<\/\1>)/g,
		)) {
			if (content.replace(/<code-icon\b[^>]*><\/code-icon>/g, '').trim()) continue;

			const name =
				bound(attrs, 'aria-label') ?? (tag === 'gl-copy-container' ? bound(attrs, 'copyLabel') : undefined);
			if (typeof name !== 'string' || !name) {
				const icons = Array.from(content.matchAll(/\sicon="([^"]*)"/g), m => m[1]);
				unnamed.push(`${tag} ${icons.join(',')}`);
			}
		}
	}
	return unnamed;
}

suite('GlDetailsReviewModePanel icon-only buttons', () => {
	const area: AIReviewFocusArea = {
		id: 'service',
		label: 'Service',
		rationale: '',
		severity: 'critical',
		files: ['src/service.ts'],
		findings: [agentFinding],
	};
	const result: AIReviewResult = { overview: '', mode: 'single-pass', focusAreas: [area] };
	const note = { id: 'note-1', author: 'user' as const, text: 'why?', at: 0 };

	function render(method: string, panel: object, ...args: unknown[]): TemplateResult[] {
		const fn: (...a: unknown[]) => unknown = Reflect.get(GlDetailsReviewModePanel.prototype, method);
		return collectTemplates(fn.apply(panel, args));
	}

	/** A `this` for a finding's card: its notes render for real, so their delete button is checked too. */
	function makeCardPanel(dismissed: boolean): object {
		const panel = {
			session: {
				...emptyReviewSession,
				findingStates: new Map(dismissed ? [[agentFinding.id, 'dismissed' as const]] : []),
				notes: new Map([[agentFinding.id, [note]]]),
			},
			_replyingTo: undefined,
			renderFindingNotes: (id: string) => render('renderFindingNotes', panel, id),
		};
		return panel;
	}

	test('have a name: the finding card, open and dismissed, its notes and the reply card', () => {
		const templates = [
			...render('renderFinding', makeCardPanel(false), agentFinding, area),
			...render('renderFinding', makeCardPanel(true), agentFinding, area),
			...render('renderReply', makeCardPanel(false), { finding: agentFinding, note: note }),
		];

		assert.deepStrictEqual(unnamedIconButtons(templates), []);
	});

	test('have a name: the findings header, the footer, the focus areas and their actions', () => {
		const panel = {
			result: result,
			session: emptyReviewSession,
			hasReviewFindings: true,
			_expandedAreas: new Set<string>(),
			formatOptions: () => ({}),
			renderFocusArea: () => nothing,
		};
		const templates = [
			...render('renderFindingsHeaderActions', panel, result),
			...render('renderReadyActions', panel),
			...render('renderFocusAreas', panel),
			...render('renderFocusAreaActions', panel, area, { isAnalyzed: true }),
			// Not reviewed yet: the tooltips are cleared, the names stay
			...render('renderFocusAreaActions', panel, area, { isAnalyzed: false }),
		];

		assert.deepStrictEqual(unnamedIconButtons(templates), []);
	});

	test('have a name: the reading steps and the Review in Repo strip', () => {
		const templates = [
			...render('renderReadingActions', { withReadingShortcut: (label: string) => label }, 'src/service.ts'),
			...render('renderDeepReviewStrip', { deepReview: { active: true, done: false, count: 1 } }),
		];

		assert.deepStrictEqual(unnamedIconButtons(templates), []);
	});

	test('a tooltip alone is no name', () => {
		const templates = collectTemplates(
			html`<gl-button tooltip=${'Delete'}><code-icon icon="trash"></code-icon></gl-button>`,
		);

		assert.deepStrictEqual(unnamedIconButtons(templates), ['gl-button trash']);
	});
});

suite('GlDetailsReviewModePanel Review in Repo strip', () => {
	const renderStrip: (this: object) => unknown = Reflect.get(
		GlDetailsReviewModePanel.prototype,
		'renderDeepReviewStrip',
	);

	/** The strip's icon and text, as bound into its template. */
	function strip(deepReview: object): string[] {
		const [template] = collectTemplates(renderStrip.call({ deepReview: deepReview }));
		return template.values.filter((v): v is string => typeof v === 'string');
	}

	test('says the agent is starting until it has the prompt — nothing runs yet', () => {
		assert.deepStrictEqual(strip({ active: true, done: false, count: 0, handOff: 'pending' }).slice(0, 2), [
			'loading',
			'Starting the agent…',
		]);
	});

	test("says the agent didn't start while a failed hand-over's Retry waits in a notification", () => {
		assert.deepStrictEqual(strip({ active: true, done: false, count: 0, handOff: 'failed' }).slice(0, 2), [
			'warning',
			"The agent didn't start — see the notification",
		]);
	});

	test('runs once the prompt got through — and reads so when the state predates the hand-over', () => {
		for (const handOff of ['delivered', undefined]) {
			assert.deepStrictEqual(strip({ active: true, done: false, count: 2, handOff: handOff }).slice(0, 2), [
				'loading',
				'Review in Repo running · 2 findings so far',
			]);
		}
	});
});

suite('GlDetailsReviewModePanel reading plan order', () => {
	const treeOrder: PropertyDescriptor['get'] = Object.getOwnPropertyDescriptor(
		GlDetailsReviewModePanel.prototype,
		'treeOrder',
	)!.get;

	function panel(panes: { label: string; files: string[] }[], orders: [string, string[]][]): string[] | undefined {
		return treeOrder!.call({
			orient: {},
			_orientPanes: {
				panes: panes.map((p, i) => ({
					key: `orient:${i}`,
					label: p.label,
					files: p.files.map(f => ({ path: f })),
				})),
			},
			_treeOrders: new Map(orders),
		}) as string[] | undefined;
	}

	test('keeps two groups with the same label apart, each in the order its pane shows', () => {
		assert.deepStrictEqual(
			panel(
				[
					{ label: 'Changes', files: ['b.ts', 'a.ts'] },
					{ label: 'Changes', files: ['d.ts', 'c.ts'] },
				],
				[
					['orient:0', ['a.ts', 'b.ts']],
					['orient:1', ['c.ts', 'd.ts']],
				],
			),
			['a.ts', 'b.ts', 'c.ts', 'd.ts'],
		);
	});

	test('a pane keeps its key when a group before it empties out of the scope', () => {
		const getOrientPanes: (orient: object, files: readonly { path: string }[]) => { key: string; label: string }[] =
			Reflect.get(GlDetailsReviewModePanel.prototype, 'getOrientPanes');
		const panel = { _orientPanes: undefined };
		const plan = {
			groups: [
				{ label: 'Core', files: [{ path: 'a.ts' }] },
				{ label: 'Tests', files: [{ path: 't.ts' }] },
			],
		};
		assert.deepStrictEqual(
			getOrientPanes.call(panel, plan, [{ path: 'a.ts' }, { path: 't.ts' }]).map(p => p.key),
			['orient:0', 'orient:1'],
		);
		// a.ts was reverted: its group is gone, the next keeps its place
		assert.deepStrictEqual(
			getOrientPanes.call(panel, plan, [{ path: 't.ts' }, { path: 'x.ts' }]).map(p => p.key),
			['orient:1', 'orient:-1'],
		);
	});

	test("each plan keeps its own panes' layouts, and has them back when shown again", () => {
		const proto = GlDetailsReviewModePanel.prototype as unknown as Record<string, unknown>;
		const planA = { groups: [] };
		const planB = { groups: [] };
		const panel = {
			orient: planA as object,
			fileLayout: 'tree',
			_orientPaneLayouts: new WeakMap(),
			requestUpdate: () => {},
			getOrientPaneLayouts: proto.getOrientPaneLayouts,
		};
		const layout = (key: string) =>
			(proto.orientPaneLayout as (key: string) => { layout: string }).call(panel, key).layout;
		const set = (key: string, value: string) =>
			(proto.setOrientPaneLayout as (key: string, layout: string) => void).call(panel, key, value);

		set('orient:0', 'list');
		assert.strictEqual(layout('orient:0'), 'list');

		panel.orient = planB;
		assert.strictEqual(layout('orient:0'), 'tree', "another plan's pane at that place starts from the checklist's");

		panel.orient = planA;
		assert.strictEqual(layout('orient:0'), 'list');
	});

	test("an order an earlier plan's pane left in that place can't pull a file out of its group", () => {
		assert.deepStrictEqual(
			panel(
				[
					{ label: 'Core', files: ['a.ts'] },
					{ label: 'Tests', files: ['t.ts'] },
				],
				[['orient:0', ['t.ts', 'a.ts']]],
			),
			['a.ts'],
		);
	});
});

suite('GlDetailsReviewModePanel scope presets', () => {
	const renderPresets: (this: object) => unknown = Reflect.get(
		GlDetailsReviewModePanel.prototype,
		'renderScopePresets',
	);
	const scopeSelectionIds: () => unknown = Reflect.get(GlDetailsReviewModePanel.prototype, 'scopeSelectionIds');

	const row = (id: string, state: string) => ({ id: id, label: id, state: state });
	const wip = [row('unstaged', 'uncommitted'), row('staged', 'uncommitted')];
	const mergeBase = row('merge-base:m', 'merge-base');

	/** The presets shown — label and whether it is the scope now — and the ids each one picks. */
	function presets(items: object[], includeShas: string[] = []) {
		const panel = {
			scopeItems: items,
			scope: { type: 'wip', includeStaged: true, includeUnstaged: true, includeShas: includeShas },
			scopeSelectionIds: scopeSelectionIds,
			selectScopePreset: () => {},
		};
		const result = renderPresets.call(panel);
		if (result === nothing) return [];

		// Each preset's template binds its tooltip, whether it is pressed, its click handler and its label
		return collectTemplates(result)
			.filter(t => t.strings.join('').includes('class="scope-preset"'))
			.map(t => [t.values[3], t.values[1]]);
	}

	test('offers the uncommitted changes, the unpushed commits with them, and the whole branch', () => {
		const items = [
			...wip,
			row('c3', 'unpushed'),
			row('c2', 'pushed'),
			row('c1', 'pushed'),
			row('load-more', 'load-more'),
			mergeBase,
		];
		assert.deepStrictEqual(presets(items), [
			['Uncommitted', 'true'],
			['Unpushed', 'false'],
			['Branch', 'false'],
		]);
		assert.deepStrictEqual(
			presets(items, ['c3', 'c2', 'c1']).map(([, pressed]) => pressed),
			['false', 'false', 'true'],
		);
	});

	test('leaves out a preset that picks what another does, and shows nothing for a single choice', () => {
		// No upstream: nothing is pushed, so the unpushed commits are the branch
		const unpublished = [...wip, row('c2', 'unpushed'), row('c1', 'unpushed'), mergeBase];
		assert.deepStrictEqual(
			presets(unpublished).map(([label]) => label),
			['Uncommitted', 'Branch'],
		);

		// No merge base: the list is only the latest commits, not the branch
		const noBase = [...wip, row('c2', 'unpushed'), row('c1', 'pushed'), row('load-more', 'load-more')];
		assert.deepStrictEqual(
			presets(noBase).map(([label]) => label),
			['Uncommitted', 'Unpushed'],
		);

		// Only uncommitted changes on a branch with nothing of its own
		assert.deepStrictEqual(presets([...wip]), []);
	});
});
