import * as assert from 'assert';
import type { TreemapNode } from '../../../../../plus/treemap/protocol.js';
import { classifyTreemapZoom, countFileLeaves, getEffectiveVisualizationKey } from '../visualizations.utils.js';

suite('getEffectiveVisualizationKey', () => {
	test('flag off forces timeline regardless of persisted treemap state', () => {
		assert.strictEqual(getEffectiveVisualizationKey('treemap', 'commits', false), 'timeline');
		assert.strictEqual(getEffectiveVisualizationKey('treemap', 'activity', false), 'timeline');
		assert.strictEqual(getEffectiveVisualizationKey('timeline', 'files', false), 'timeline');
	});

	test('flag on returns timeline when the visualization mode is timeline', () => {
		assert.strictEqual(getEffectiveVisualizationKey('timeline', 'commits', true), 'timeline');
	});

	test('flag on maps each treemap sub-mode to its key', () => {
		assert.strictEqual(getEffectiveVisualizationKey('treemap', 'files', true), 'treemap-files');
		assert.strictEqual(getEffectiveVisualizationKey('treemap', 'commits', true), 'treemap-commits');
		assert.strictEqual(getEffectiveVisualizationKey('treemap', 'activity', true), 'treemap-activity');
	});

	test('defaults: undefined mode is timeline; undefined treemapMode is files', () => {
		assert.strictEqual(getEffectiveVisualizationKey(undefined, undefined, true), 'timeline');
		assert.strictEqual(getEffectiveVisualizationKey('treemap', undefined, true), 'treemap-files');
	});
});

suite('classifyTreemapZoom', () => {
	const folder = (path: string, children: TreemapNode[] = []): TreemapNode => ({
		name: path,
		path: path,
		size: 1,
		type: 'folder',
		children: children,
	});

	test('identical path (same depth + same leaf) is unchanged — the retry rehydration case', () => {
		const path = [folder('src'), folder('src/webviews')];
		const result = classifyTreemapZoom(path, [folder('src'), folder('src/webviews')]);
		assert.strictEqual(result.changed, false);
	});

	test('root → root is unchanged', () => {
		assert.strictEqual(classifyTreemapZoom([], []).changed, false);
	});

	test('drilling deeper is a changed zoom in', () => {
		const result = classifyTreemapZoom([folder('src')], [folder('src'), folder('src/webviews')]);
		assert.deepStrictEqual(result, { changed: true, direction: 'in', depth: 2 });
	});

	test('breadcrumb up is a changed zoom out', () => {
		const result = classifyTreemapZoom([folder('src'), folder('src/webviews')], [folder('src')]);
		assert.deepStrictEqual(result, { changed: true, direction: 'out', depth: 1 });
	});

	test('zoom all the way out to root reports depth 0', () => {
		const result = classifyTreemapZoom([folder('src')], []);
		assert.deepStrictEqual(result, { changed: true, direction: 'out', depth: 0 });
	});

	test('equal depth but different leaf counts as changed (push/pop makes this unreachable in practice)', () => {
		const result = classifyTreemapZoom([folder('src')], [folder('docs')]);
		assert.strictEqual(result.changed, true);
		assert.strictEqual(result.direction, 'in');
	});
});

suite('countFileLeaves', () => {
	const file = (name: string): TreemapNode => ({ name: name, path: name, size: 1, type: 'file' });
	const folder = (name: string, children: TreemapNode[]): TreemapNode => ({
		name: name,
		path: name,
		size: 1,
		type: 'folder',
		children: children,
	});

	test('undefined tree is 0', () => {
		assert.strictEqual(countFileLeaves(undefined), 0);
	});

	test('a lone file is 1', () => {
		assert.strictEqual(countFileLeaves(file('a.ts')), 1);
	});

	test('empty folder is 0', () => {
		assert.strictEqual(countFileLeaves(folder('src', [])), 0);
	});

	test('counts leaves across nested folders, ignoring folder nodes', () => {
		const tree = folder('root', [
			file('README.md'),
			folder('src', [file('a.ts'), file('b.ts'), folder('nested', [file('c.ts')])]),
			folder('empty', []),
		]);
		assert.strictEqual(countFileLeaves(tree), 4);
	});
});
