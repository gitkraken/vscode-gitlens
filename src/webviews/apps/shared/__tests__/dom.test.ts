import * as assert from 'assert';
import { isTextEntryTarget } from '../dom.js';

/** Stands in for one entry of a composed path — the helper only reads `tagName`/`type`/`isContentEditable`. */
type PathEntry = { tagName?: string; type?: string; isContentEditable?: boolean };

function eventWithPath(...path: PathEntry[]): Event {
	// The composed path of a real keydown ends at the document and the window, neither of which is an
	// element — included here so the helper is exercised against those too.
	const composed = [...path, { tagName: undefined }, { tagName: undefined }];
	return { composedPath: () => composed } as unknown as Event;
}

suite('isTextEntryTarget', () => {
	test('matches text-entry controls', () => {
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'INPUT', type: 'text' })), true);
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'INPUT', type: 'search' })), true);
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'TEXTAREA' })), true);
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'SELECT' })), true);
	});

	test('matches an input with no resolvable type (defaults to text)', () => {
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'INPUT' })), true);
	});

	test('matches an unrecognized input type, erring toward keeping the keystroke', () => {
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'INPUT', type: 'datetime-local' })), true);
	});

	test('does not match checkbox / radio inputs', () => {
		// `gl-checkbox` and `gl-radio` delegate focus into a real `<input>`; a bare-key shortcut must
		// still fire while one of those holds focus.
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'INPUT', type: 'checkbox' })), false);
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'INPUT', type: 'radio' })), false);
	});

	test('does not match other non-text inputs or ordinary elements', () => {
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'INPUT', type: 'range' })), false);
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'INPUT', type: 'submit' })), false);
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'BUTTON' })), false);
		assert.strictEqual(isTextEntryTarget(eventWithPath({ tagName: 'DIV' })), false);
	});

	test('matches a contenteditable ancestor of the target', () => {
		assert.strictEqual(
			isTextEntryTarget(eventWithPath({ tagName: 'SPAN' }, { tagName: 'DIV', isContentEditable: true })),
			true,
		);
	});

	test('walks the whole path, so a shadow host above the input does not hide it', () => {
		// A `document`-level listener sees `event.target` retargeted to the outermost host — for the
		// commit search box, two shadow roots above the `<input>`.
		assert.strictEqual(
			isTextEntryTarget(
				eventWithPath(
					{ tagName: 'INPUT', type: 'text' },
					{ tagName: 'GL-SEARCH-INPUT' },
					{ tagName: 'GL-SEARCH-BOX' },
				),
			),
			true,
		);
	});

	test('does not match an empty path', () => {
		assert.strictEqual(isTextEntryTarget({ composedPath: () => [] } as unknown as Event), false);
	});
});
