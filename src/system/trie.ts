import { isLinux } from '@env/platform';
import type { Uri } from 'vscode';
import { filterMap } from './iterable';
import { normalizePath as _normalizePath } from './path';

const slash = 47; //CharCode.Slash;

function normalizePath(path: string): string {
	path = _normalizePath(path);
	if (path.charCodeAt(0) === slash) {
		path = path.slice(1);
	}

	return path;
}

export type UriEntry<T> = PathEntry<T>;

export class UriEntryTrie<T> {
	private readonly trie: PathEntryTrie<T>;

	constructor(private readonly normalize: (uri: Uri) => { path: string; ignoreCase: boolean }) {
		this.trie = new PathEntryTrie<T>();
	}

	clear(): void {
		this.trie.clear();
	}

	delete(uri: Uri): boolean {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.delete(path, ignoreCase);
	}

	get(uri: Uri): UriEntry<T> | undefined {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.get(path, ignoreCase);
	}

	getChildren(uri: Uri): UriEntry<T>[] {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.getChildren(path, ignoreCase);
	}

	getClosest(uri: Uri, excludeSelf?: boolean, predicate?: (value: T) => boolean): UriEntry<T> | undefined {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.getClosest(path, excludeSelf, predicate, ignoreCase);
	}

	getDescendants(uri?: Uri, predicate?: (value: T) => boolean): Generator<UriEntry<T>> {
		if (uri == null) return this.trie.getDescendants();

		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.getDescendants(path, predicate, ignoreCase);
	}

	has(uri: Uri): boolean {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.has(path, ignoreCase);
	}

	set(uri: Uri, value: T): boolean {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.set(path, value, ignoreCase);
	}
}

export class UriTrie<T> {
	private readonly trie: PathTrie<T>;

	constructor(private readonly normalize: (uri: Uri) => { path: string; ignoreCase: boolean }) {
		this.trie = new PathTrie<T>();
	}

	clear(): void {
		this.trie.clear();
	}

	delete(uri: Uri, dispose: boolean = true): boolean {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.delete(path, ignoreCase, dispose);
	}

	get(uri: Uri): T | undefined {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.get(path, ignoreCase);
	}

	getChildren(uri: Uri): T[] {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.getChildren(path, ignoreCase);
	}

	getClosest(uri: Uri, excludeSelf?: boolean, predicate?: (value: T) => boolean): T | undefined {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.getClosest(path, excludeSelf, predicate, ignoreCase);
	}

	getDescendants(uri?: Uri, predicate?: (value: T) => boolean): Generator<T> {
		if (uri == null) return this.trie.getDescendants();

		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.getDescendants(path, predicate, ignoreCase);
	}

	has(uri: Uri): boolean {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.has(path, ignoreCase);
	}

	set(uri: Uri, value: T): boolean {
		const { path, ignoreCase } = this.normalize(uri);
		return this.trie.set(path, value, ignoreCase);
	}
}

export interface PathEntry<T> {
	value: T;
	path: string;
	fullPath: string;
}

class PathNode<T> {
	value: T | undefined;
	children: Map<string, PathNode<T>> | undefined;

	constructor(public readonly path: string) {}
}

export class PathEntryTrie<T> {
	private root: PathNode<T>;

	constructor(private readonly normalize: (path: string) => string = normalizePath) {
		this.root = new PathNode<T>('');
	}

	clear(): void {
		this.root.children = undefined;
	}

	delete(path: string, ignoreCase?: boolean): boolean {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let node: PathNode<T> | undefined;
		let parent: PathNode<T> | undefined;

		for (const segment of path.split('/')) {
			const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
			if (n == null) return false;

			parent = node ?? this.root;
			node = n;
		}

		if (!node?.value) return false;

		node.value = undefined;
		if ((node.children == null || node.children.size === 0) && parent?.children != null) {
			parent.children.delete(ignoreCase ? node.path.toLowerCase() : node.path);
			if (parent.children.size === 0) {
				parent.children = undefined;
			}
		}

		return true;
	}

	get(path: string, ignoreCase?: boolean): PathEntry<T> | undefined {
		return this.getCore(path, ignoreCase);
	}

	private getCore(path: string, ignoreCase?: boolean): PathEntry<T> | undefined;
	private getCore(path: string, ignoreCase: boolean | undefined, existenceOnly: true): boolean;
	private getCore(
		path: string,
		ignoreCase: boolean | undefined,
		existenceOnly?: boolean,
	): (PathEntry<T> | undefined) | boolean {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let fullPath = '';
		let node: PathNode<T> | undefined;

		for (const segment of path.split('/')) {
			const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
			if (n == null) return existenceOnly ? false : undefined;

			node = n;
			if (!existenceOnly) {
				fullPath += `${n.path}/`;
			}
		}

		// Avoids allocations & garbage on `has` calls
		if (existenceOnly) return node?.value != null;
		if (!node?.value) return undefined;

		return {
			value: node.value,
			path: node.path,
			fullPath: fullPath.slice(0, -1),
		};
	}

	getChildren(path: string, ignoreCase?: boolean): PathEntry<T>[] {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let fullPath = '';
		let node: PathNode<T> | undefined;

		if (path) {
			for (const segment of path.split('/')) {
				const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
				if (n == null) return [];

				node = n;
				fullPath += `${n.path}/`;
			}
		} else {
			node = this.root;
		}

		if (node?.children == null) return [];
		return [
			...filterMap(node.children.values(), n =>
				n.value ? { value: n.value, path: n.path, fullPath: fullPath } : undefined,
			),
		];
	}

	getClosest(
		path: string,
		excludeSelf?: boolean,
		predicate?: (value: T) => boolean,
		ignoreCase?: boolean,
	): PathEntry<T> | undefined {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let fullPath = '';
		let fullAncestorPath!: string;
		let node: PathNode<T> | undefined;
		let ancestor: PathNode<T> | undefined;

		for (const segment of path.split('/')) {
			if (node?.value && (!predicate || predicate?.(node.value))) {
				ancestor = node;
				fullAncestorPath = fullPath;
			}

			const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
			if (n == null) break;

			node = n;
			fullPath += `${n.path}/`;
		}

		if (!excludeSelf && node?.value && (!predicate || predicate?.(node.value))) {
			return { value: node.value, path: node.path, fullPath: fullPath.slice(0, -1) };
		}

		return ancestor?.value
			? { value: ancestor.value, path: ancestor.path, fullPath: fullAncestorPath.slice(0, -1) }
			: undefined;
	}

	// getAncestors(
	// 	path: string,
	// 	predicate?: (value: T) => boolean,
	// 	ignoreCase?: boolean,
	// 	excludeSelf?: boolean,
	// ): PathEntry<T>[] {
	// 	path = this.normalize(path);
	// 	ignoreCase = ignoreCase ?? !isLinux;

	// 	const ancestors: PathEntry<T>[] = [];

	// 	let fullPath = '';
	// 	let node: PathNode<T> | undefined;

	// 	for (const segment of path.split('/')) {
	// 		if (node?.value && (!predicate || predicate?.(node.value))) {
	// 			ancestors.push({ value: node.value, path: node.path, fullPath: fullPath.slice(0, -1) });
	// 		}

	// 		const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
	// 		if (n == null) break;

	// 		node = n;
	// 		fullPath += `${n.path}/`;
	// 	}

	// 	if (!excludeSelf && node?.value && (!predicate || predicate?.(node.value))) {
	// 		ancestors.push({ value: node.value, path: node.path, fullPath: fullPath.slice(0, -1) });
	// 	}

	// 	return ancestors.reverse();
	// }

	*getDescendants(path?: string, predicate?: (value: T) => boolean, ignoreCase?: boolean): Generator<PathEntry<T>> {
		path = path ? this.normalize(path) : '';
		ignoreCase = ignoreCase ?? !isLinux;

		let fullPath = '';
		let node: PathNode<T> | undefined;

		if (path) {
			for (const segment of path.split('/')) {
				const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
				if (n == null) return;

				node = n;
				fullPath += `${n.path}/`;
			}
		} else {
			node = this.root;
		}

		if (node?.children == null) return;

		function* getDescendantsCore(
			children: NonNullable<PathNode<T>['children']>,
			path: string,
			fullPath: string,
		): Generator<PathEntry<T>> {
			for (const node of children.values()) {
				const relativePath = path ? `${path}/${node.path}` : node.path;
				if (node.value && (!predicate || predicate?.(node.value))) {
					yield {
						value: node.value,
						path: relativePath,
						fullPath: fullPath ? `${fullPath}/${relativePath}` : relativePath,
					};
				}

				if (node.children != null) {
					yield* getDescendantsCore(node.children, relativePath, fullPath);
				}
			}
		}

		yield* getDescendantsCore(node.children, '', fullPath);
	}

	has(path: string, ignoreCase?: boolean): boolean {
		return this.getCore(path, ignoreCase, true);
	}

	set(path: string, value: T, ignoreCase?: boolean): boolean {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let node = this.root;

		for (const segment of path.split('/')) {
			const key = ignoreCase ? segment.toLowerCase() : segment;

			let n = node.children?.get(key);
			if (n == null) {
				if (node.children == null) {
					node.children = new Map<string, PathNode<T>>();
				}

				n = new PathNode(segment);
				node.children.set(key, n);
			}

			node = n;
		}

		const added = node.value == null;
		node.value = value;
		return added;
	}
}

export class PathTrie<T> {
	private root: PathNode<T>;

	constructor(private readonly normalize: (path: string) => string = normalizePath) {
		this.root = new PathNode<T>('');
	}

	clear(): void {
		this.root.children = undefined;
	}

	delete(path: string, ignoreCase?: boolean, dispose: boolean = true): boolean {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let node: PathNode<T> | undefined;
		let parent: PathNode<T> | undefined;

		for (const segment of path.split('/')) {
			const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
			if (n == null) return false;

			parent = node ?? this.root;
			node = n;
		}

		if (!node?.value) return false;

		if (dispose) {
			disposeValue(node.value);
		}
		node.value = undefined;

		if ((node.children == null || node.children.size === 0) && parent?.children != null) {
			parent.children.delete(ignoreCase ? node.path.toLowerCase() : node.path);
			if (parent.children.size === 0) {
				parent.children = undefined;
			}
		}

		return true;
	}

	get(path: string, ignoreCase?: boolean): T | undefined {
		return this.getCore(path, ignoreCase);
	}

	private getCore(path: string, ignoreCase?: boolean): T | undefined {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let node: PathNode<T> | undefined;

		for (const segment of path.split('/')) {
			const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
			if (n == null) return undefined;

			node = n;
		}

		return node?.value;
	}

	getChildren(path: string, ignoreCase?: boolean): T[] {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let node: PathNode<T> | undefined;

		if (path) {
			for (const segment of path.split('/')) {
				const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
				if (n == null) return [];

				node = n;
			}
		} else {
			node = this.root;
		}

		if (node?.children == null) return [];
		return [...filterMap(node.children.values(), n => n.value || undefined)];
	}

	getClosest(
		path: string,
		excludeSelf?: boolean,
		predicate?: (value: T) => boolean,
		ignoreCase?: boolean,
	): T | undefined {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let node: PathNode<T> | undefined;
		let ancestor: PathNode<T> | undefined;

		for (const segment of path.split('/')) {
			if (node?.value && (!predicate || predicate?.(node.value))) {
				ancestor = node;
			}

			const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
			if (n == null) break;

			node = n;
		}

		if (!excludeSelf && node?.value && (!predicate || predicate?.(node.value))) {
			return node.value;
		}

		return ancestor?.value;
	}

	*getDescendants(path?: string, predicate?: (value: T) => boolean, ignoreCase?: boolean): Generator<T> {
		path = path ? this.normalize(path) : '';
		ignoreCase = ignoreCase ?? !isLinux;

		let fullPath = '';
		let node: PathNode<T> | undefined;

		if (path) {
			for (const segment of path.split('/')) {
				const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
				if (n == null) return;

				node = n;
				fullPath += `${n.path}/`;
			}
		} else {
			node = this.root;
		}

		if (node?.children == null) return;

		function* getDescendantsCore(
			children: NonNullable<PathNode<T>['children']>,
			path: string,
			fullPath: string,
		): Generator<T> {
			for (const node of children.values()) {
				const relativePath = path ? `${path}/${node.path}` : node.path;
				if (node.value && (!predicate || predicate?.(node.value))) {
					yield node.value;
				}

				if (node.children != null) {
					yield* getDescendantsCore(node.children, relativePath, fullPath);
				}
			}
		}

		yield* getDescendantsCore(node.children, '', fullPath);
	}

	has(path: string, ignoreCase?: boolean): boolean {
		return this.getCore(path, ignoreCase) != null;
	}

	set(path: string, value: T, ignoreCase?: boolean): boolean {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let node = this.root;

		for (const segment of path.split('/')) {
			const key = ignoreCase ? segment.toLowerCase() : segment;

			let n = node.children?.get(key);
			if (n == null) {
				if (node.children == null) {
					node.children = new Map<string, PathNode<T>>();
				}

				n = new PathNode(segment);
				node.children.set(key, n);
			}

			node = n;
		}

		const added = node.value == null;
		if (!added && node.value !== value) {
			disposeValue(node.value);
		}
		node.value = value;
		return added;
	}
}

function disposeValue(obj: unknown): void {
	if (obj != null && typeof obj === 'object' && 'dispose' in obj && typeof obj.dispose === 'function') {
		obj.dispose();
	}
}

class VisitedPathNode {
	children: Map<string, VisitedPathNode> | undefined;

	constructor(public readonly path: string) {}
}

export class VisitedPathsTrie {
	private root: VisitedPathNode;

	constructor(private readonly normalize: (path: string) => string = normalizePath) {
		this.root = new VisitedPathNode('');
	}

	clear(): void {
		this.root.children = undefined;
	}

	// delete(path: string, ignoreCase?: boolean): boolean {
	// 	path = this.normalize(path);
	// 	ignoreCase = ignoreCase ?? !isLinux;

	// 	let node: SeenPathNode | undefined;
	// 	let parent: SeenPathNode | undefined;

	// 	for (const segment of path.split('/')) {
	// 		const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
	// 		if (n == null) return false;

	// 		parent = node ?? this.root;
	// 		node = n;
	// 	}

	// 	if (node == null) return false;

	// 	if ((node.children == null || node.children.size === 0) && parent?.children != null) {
	// 		parent.children.delete(ignoreCase ? node.path.toLowerCase() : node.path);
	// 		if (parent.children.size === 0) {
	// 			parent.children = undefined;
	// 		}
	// 	}

	// 	return true;
	// }

	// getClosest(path: string, excludeSelf?: boolean, ignoreCase?: boolean): string | undefined {
	// 	path = this.normalize(path);
	// 	ignoreCase = ignoreCase ?? !isLinux;

	// 	let fullPath = '';
	// 	let fullAncestorPath!: string;
	// 	let node: SeenPathNode | undefined;
	// 	let ancestor: SeenPathNode | undefined;

	// 	for (const segment of path.split('/')) {
	// 		ancestor = node;
	// 		fullAncestorPath = fullPath;

	// 		const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
	// 		if (n == null) break;

	// 		node = n;
	// 		fullPath += `${n.path}/`;
	// 	}

	// 	if (!excludeSelf && node != null) return fullPath.slice(0, -1);
	// 	return ancestor != null ? fullAncestorPath.slice(0, -1) : undefined;
	// }

	has(path: string, ignoreCase?: boolean): boolean {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let node: VisitedPathNode | undefined;

		for (const segment of path.split('/')) {
			const n = (node ?? this.root).children?.get(ignoreCase ? segment.toLowerCase() : segment);
			if (n == null) return false;

			node = n;
		}

		return node != null;
	}

	set(path: string, ignoreCase?: boolean): void {
		path = this.normalize(path);
		ignoreCase = ignoreCase ?? !isLinux;

		let node = this.root;

		for (const segment of path.split('/')) {
			const key = ignoreCase ? segment.toLowerCase() : segment;

			let n = node.children?.get(key);
			if (n == null) {
				if (node.children == null) {
					node.children = new Map<string, VisitedPathNode>();
				}

				n = new VisitedPathNode(segment);
				node.children.set(key, n);
			}

			node = n;
		}
	}
}
