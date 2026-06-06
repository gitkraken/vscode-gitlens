import * as assert from 'assert';
import type { ReactiveControllerHost } from 'lit';
import { CollectionIndexController } from '../collection-index.js';

function fakeHost(): ReactiveControllerHost {
	return {
		addController: () => undefined,
		removeController: () => undefined,
		requestUpdate: () => undefined,
		updateComplete: Promise.resolve(true),
	};
}

interface Row {
	path: string;
}

suite('CollectionIndexController', () => {
	test('builds id<->index lookups over the current items', () => {
		const items: Row[] = [{ path: 'a' }, { path: 'b' }, { path: 'c' }];
		const index = new CollectionIndexController<Row>(fakeHost(), {
			getItems: () => items,
			getItemId: r => r.path,
		});
		index.rebuild();

		assert.strictEqual(index.size, 3);
		assert.strictEqual(index.indexOf('b'), 1);
		assert.strictEqual(index.indexOf('missing'), -1);
		assert.strictEqual(index.has('a'), true);
		assert.strictEqual(index.has('z'), false);
		assert.strictEqual(index.idAt(2), 'c');
		assert.strictEqual(index.idAt(99), undefined);
		assert.deepStrictEqual(index.itemFor('b'), { path: 'b' });
		assert.strictEqual(index.itemFor('z'), undefined);
		assert.deepStrictEqual(index.ids(), ['a', 'b', 'c']);
	});

	test('reflects a new item list after rebuild', () => {
		let items: Row[] = [{ path: 'a' }, { path: 'b' }];
		const index = new CollectionIndexController<Row>(fakeHost(), {
			getItems: () => items,
			getItemId: r => r.path,
		});
		index.rebuild();
		assert.strictEqual(index.indexOf('b'), 1);

		items = [{ path: 'x' }, { path: 'a' }, { path: 'b' }];
		index.rebuild();
		assert.strictEqual(index.indexOf('b'), 2);
		assert.strictEqual(index.indexOf('x'), 0);
		assert.deepStrictEqual(index.ids(), ['x', 'a', 'b']);
	});

	test('handles an undefined item list', () => {
		const index = new CollectionIndexController<Row>(fakeHost(), {
			getItems: () => undefined,
			getItemId: r => r.path,
		});
		index.rebuild();
		assert.strictEqual(index.size, 0);
		assert.deepStrictEqual(index.ids(), []);
		assert.strictEqual(index.indexOf('a'), -1);
	});
});
