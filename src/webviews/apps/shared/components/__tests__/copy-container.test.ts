import * as assert from 'assert';
import type { TemplateResult } from 'lit';
import { nothing } from 'lit';
import { GlCopyContainer } from '../copy-container.js';

type Harness = {
	content?: string;
	disabled: boolean;
	copyLabel: string;
	ariaLabel: string | null;
	label: string;
	placement?: string;
	_resetTimer?: ReturnType<typeof setTimeout>;
	onClick: () => void;
	onKeydown: (e: KeyboardEvent) => void;
};

function harness(overrides?: Partial<Harness>): Harness {
	return {
		content: 'abc123',
		disabled: false,
		copyLabel: 'Copy SHA',
		ariaLabel: null,
		label: 'Copy SHA',
		placement: 'top',
		onClick: () => {},
		onKeydown: () => {},
		...overrides,
	};
}

/** What the control renders: the attributes bound on the focusable tooltip, and the status region's text. */
function render(panel: Harness): { attrs: Map<string, unknown>; status: unknown } {
	const fn: () => unknown = Reflect.get(GlCopyContainer.prototype, 'render');
	const template = fn.call(panel) as TemplateResult;
	// The bindings as markers, so each value can be told by the attribute it is bound to
	const markup = template.strings.reduce((acc, s, i) => `${acc}⟦${i - 1}⟧${s}`);
	const attrs = new Map<string, unknown>();
	for (const [, name, index] of markup.matchAll(/\s([\w.@-]+)="?⟦(\d+)⟧/g)) {
		attrs.set(name, template.values[Number(index)]);
	}
	const status = /role="status">⟦(\d+)⟧/.exec(markup);
	return { attrs: attrs, status: status != null ? template.values[Number(status[1])] : undefined };
}

suite('GlCopyContainer accessibility', () => {
	test('is named for its action, and says nothing until a copy is made', () => {
		const { attrs, status } = render(harness());
		assert.strictEqual(attrs.get('aria-label'), 'Copy SHA');
		assert.strictEqual(attrs.get('aria-disabled'), nothing, 'no attribute');
		assert.strictEqual(status, nothing);

		assert.strictEqual(
			render(harness({ ariaLabel: 'Copy Commit SHA' })).attrs.get('aria-label'),
			'Copy Commit SHA',
		);
	});

	test('speaks what a copy did from its status region, keeping the name of the action', () => {
		const { attrs, status } = render(harness({ label: 'Copied!', _resetTimer: setTimeout(() => {}, 0) }));
		assert.strictEqual(status, 'Copied!');
		assert.strictEqual(attrs.get('aria-label'), 'Copy SHA', 'the name does not change under focus');
		assert.strictEqual(attrs.get('.content'), 'Copied!', 'the tooltip shows it too');
	});

	test('says it is disabled, and does nothing from the keyboard then', () => {
		let clicks = 0;
		const panel = harness({ disabled: true, content: undefined, onClick: () => clicks++ });
		assert.strictEqual(render(panel).attrs.get('aria-disabled'), 'true');

		const onKeydown: (this: Harness, e: KeyboardEvent) => void = Reflect.get(
			GlCopyContainer.prototype,
			'onKeydown',
		);
		const enter = { key: 'Enter', preventDefault: () => {} } as unknown as KeyboardEvent;
		onKeydown.call(panel, enter);
		assert.strictEqual(clicks, 0);

		panel.disabled = false;
		onKeydown.call(panel, enter);
		assert.strictEqual(clicks, 1);
	});
});
