/**
 * Squarified-treemap layout — implements Bruls/Huijsen/Van Wijk (1999) so leaf rectangles trend
 * toward squares (rather than the long slivers that slice-and-dice produces). Self-contained: takes
 * a value-bearing tree and returns flat rectangles annotated with depth + parent so the renderer
 * can draw containers and leaves separately.
 *
 * Used by the embedded treemap visualization in the Commit Graph's Visual History view; we own the
 * algorithm here instead of pulling in `d3-hierarchy` to keep the webview bundle lean.
 */

export interface TreemapInput {
	readonly name: string;
	readonly path: string;
	readonly type: 'folder' | 'file';
	readonly children?: readonly TreemapInput[];
}

export interface TreemapRect<T extends TreemapInput = TreemapInput> {
	data: T;
	depth: number;
	parent: TreemapRect<T> | undefined;
	value: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	children: TreemapRect<T>[];
}

export interface SquarifyOptions {
	width: number;
	height: number;
	/** Padding around the entire children area inside a folder. */
	paddingOuter?: number;
	/** Reserved space at the top of a folder for its label. */
	paddingTop?: number;
	/** Padding between sibling rectangles. */
	paddingInner?: number;
	round?: boolean;
}

/** Build the value-summed rect tree, then run squarified layout into the given dimensions. */
export function squarify<T extends TreemapInput>(
	root: T,
	getValue: (leaf: T) => number,
	options: SquarifyOptions,
): TreemapRect<T> {
	const tree = buildHierarchy(root, getValue);
	layoutNode(tree, 0, 0, options.width, options.height, {
		paddingOuter: options.paddingOuter ?? 0,
		paddingTop: options.paddingTop ?? options.paddingOuter ?? 0,
		paddingInner: options.paddingInner ?? 0,
		round: options.round ?? false,
	});
	return tree;
}

/** Walk pre-order, depth-first. Yields every rect (including the root). */
export function* descendants<T extends TreemapInput>(root: TreemapRect<T>): Generator<TreemapRect<T>> {
	yield root;

	for (const child of root.children) {
		yield* descendants(child);
	}
}

/** Yields only leaf rects (no children). */
export function* leaves<T extends TreemapInput>(root: TreemapRect<T>): Generator<TreemapRect<T>> {
	if (root.children.length === 0) {
		yield root;
		return;
	}

	for (const child of root.children) {
		yield* leaves(child);
	}
}

function buildHierarchy<T extends TreemapInput>(
	data: T,
	getValue: (leaf: T) => number,
	depth = 0,
	parent?: TreemapRect<T>,
): TreemapRect<T> {
	const node: TreemapRect<T> = {
		data: data,
		depth: depth,
		parent: parent,
		value: 0,
		x0: 0,
		y0: 0,
		x1: 0,
		y1: 0,
		children: [],
	};

	const inputChildren = data.children;
	if (inputChildren != null && inputChildren.length > 0) {
		for (const child of inputChildren) {
			const childNode = buildHierarchy(child as T, getValue, depth + 1, node);
			node.children.push(childNode);
			node.value += childNode.value;
		}
		// Sort children by value descending — squarified layout works on largest-first.
		node.children.sort((a, b) => b.value - a.value);
	} else {
		node.value = Math.max(0, getValue(data));
	}

	return node;
}

interface ResolvedPadding {
	paddingOuter: number;
	paddingTop: number;
	paddingInner: number;
	round: boolean;
}

function layoutNode<T extends TreemapInput>(
	node: TreemapRect<T>,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	pad: ResolvedPadding,
): void {
	if (pad.round) {
		x0 = Math.round(x0);
		y0 = Math.round(y0);
		x1 = Math.round(x1);
		y1 = Math.round(y1);
	}

	node.x0 = x0;
	node.y0 = y0;
	node.x1 = x1;
	node.y1 = y1;

	if (node.children.length === 0) return;

	// Inset children area: outer padding on three sides, top padding on top (label space).
	const innerX0 = x0 + pad.paddingOuter;
	const innerY0 = y0 + (node.depth === 0 ? pad.paddingOuter : pad.paddingTop);
	const innerX1 = x1 - pad.paddingOuter;
	const innerY1 = y1 - pad.paddingOuter;
	const innerWidth = Math.max(0, innerX1 - innerX0);
	const innerHeight = Math.max(0, innerY1 - innerY0);
	if (innerWidth === 0 || innerHeight === 0) return;

	squarifyChildren(node.children, innerX0, innerY0, innerX1, innerY1, node.value, pad);

	// Recurse with inner padding between siblings already applied per-rectangle.
	for (const child of node.children) {
		layoutNode(child, child.x0, child.y0, child.x1, child.y1, pad);
	}
}

/** Squarified algorithm: pack children into rows along the shorter side; place a row when adding the
 *  next child would worsen the worst aspect ratio in the row. */
function squarifyChildren<T extends TreemapInput>(
	children: TreemapRect<T>[],
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	totalValue: number,
	pad: ResolvedPadding,
): void {
	if (totalValue <= 0) {
		// All zero-value siblings — nothing meaningful to lay out, but still place them as zero-area.
		for (const child of children) {
			child.x0 = x0;
			child.y0 = y0;
			child.x1 = x0;
			child.y1 = y0;
		}
		return;
	}

	const area = (x1 - x0) * (y1 - y0);
	const valueScale = area / totalValue;

	let cursorX = x0;
	let cursorY = y0;
	let remainingW = x1 - x0;
	let remainingH = y1 - y0;

	let i = 0;
	while (i < children.length) {
		// Skip zero-value children — they'd produce zero-area rects regardless.
		if (children[i].value <= 0) {
			children[i].x0 = cursorX;
			children[i].y0 = cursorY;
			children[i].x1 = cursorX;
			children[i].y1 = cursorY;
			i++;
			continue;
		}

		const shorter = Math.min(remainingW, remainingH);
		if (shorter <= 0) {
			// No space left — place remaining children as zero-area at the cursor.
			for (let j = i; j < children.length; j++) {
				children[j].x0 = cursorX;
				children[j].y0 = cursorY;
				children[j].x1 = cursorX;
				children[j].y1 = cursorY;
			}
			return;
		}

		// Greedily extend the row while aspect ratio improves (or stays equal).
		let rowEnd = i + 1;
		let rowSum = children[i].value * valueScale;
		let rowMin = rowSum;
		let rowMax = rowSum;
		let bestRatio = worstRatio(rowMin, rowMax, rowSum, shorter);

		while (rowEnd < children.length && children[rowEnd].value > 0) {
			const next = children[rowEnd].value * valueScale;
			const newSum = rowSum + next;
			const newMin = Math.min(rowMin, next);
			const newMax = Math.max(rowMax, next);
			const newRatio = worstRatio(newMin, newMax, newSum, shorter);
			if (newRatio > bestRatio) break; // adding worsens it — stop here

			rowSum = newSum;
			rowMin = newMin;
			rowMax = newMax;
			bestRatio = newRatio;
			rowEnd++;
		}

		// Place [i, rowEnd) along the shorter side. Row depth = rowSum / shorter.
		const rowDepth = rowSum / shorter;
		const horizontal = remainingW <= remainingH;

		let placeCursor = horizontal ? cursorX : cursorY;
		const placeStart = placeCursor;
		const placeLimit = horizontal ? cursorX + shorter : cursorY + shorter;

		for (let j = i; j < rowEnd; j++) {
			const child = children[j];
			const childArea = child.value * valueScale;
			const childExtent = childArea / rowDepth;
			const next = j === rowEnd - 1 ? placeLimit : Math.min(placeLimit, placeCursor + childExtent);

			if (horizontal) {
				child.x0 = applyInnerPadStart(placeCursor, placeStart, pad.paddingInner);
				child.x1 = applyInnerPadEnd(next, placeLimit, pad.paddingInner);
				child.y0 = applyInnerPadStart(cursorY, y0, pad.paddingInner);
				child.y1 = applyInnerPadEnd(cursorY + rowDepth, y1, pad.paddingInner);
			} else {
				child.x0 = applyInnerPadStart(cursorX, x0, pad.paddingInner);
				child.x1 = applyInnerPadEnd(cursorX + rowDepth, x1, pad.paddingInner);
				child.y0 = applyInnerPadStart(placeCursor, placeStart, pad.paddingInner);
				child.y1 = applyInnerPadEnd(next, placeLimit, pad.paddingInner);
			}

			if (pad.round) {
				child.x0 = Math.round(child.x0);
				child.y0 = Math.round(child.y0);
				child.x1 = Math.round(child.x1);
				child.y1 = Math.round(child.y1);
			}

			placeCursor = next;
		}

		// Advance the cursor past the placed row.
		if (horizontal) {
			cursorY += rowDepth;
			remainingH -= rowDepth;
		} else {
			cursorX += rowDepth;
			remainingW -= rowDepth;
		}
		i = rowEnd;
	}
}

/** Inset rectangle starts/ends by half the inner-padding to create gutters between siblings, but
 *  never push outside the original bounds (preserves the grid alignment at row edges). */
function applyInnerPadStart(value: number, bound: number, inner: number): number {
	if (inner <= 0) return value;
	if (value <= bound) return value;
	return value + inner / 2;
}
function applyInnerPadEnd(value: number, bound: number, inner: number): number {
	if (inner <= 0) return value;
	if (value >= bound) return value;
	return value - inner / 2;
}

function worstRatio(min: number, max: number, sum: number, shorter: number): number {
	const sumSq = sum * sum;
	const shorterSq = shorter * shorter;
	// Guard against degenerate inputs: `sum === 0` and `min === 0` both blow up the formula
	// (NaN/Infinity), which corrupts the `newRatio > bestRatio` decision in the row-grow loop
	// and produces collapsed/inverted layouts. Treat them as "no ratio info available" → return
	// Infinity so the caller breaks out of the greedy grow.
	if (sumSq === 0 || min === 0) return Number.POSITIVE_INFINITY;

	// Standard squarified worst-case aspect ratio formula.
	return Math.max((shorterSq * max) / sumSq, sumSq / (shorterSq * min));
}
