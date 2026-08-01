/**
 * Outlier-aware Y scale shared by the Graph minimap's activity curve and the timeline's volume panel.
 * The `min(max, max(p95, fence))` hybrid keeps the axis tight on smooth distributions while protecting
 * against single-spike domination on heavy-tailed ones.
 */
export function computeYScale(values: Float32Array | readonly number[]): number {
	// Typed-array scratch avoids boxing per non-zero value, and typed-array `.sort()` is numeric by
	// default — skipping both the JS array allocation and the per-comparison comparator closure.
	const sorted = new Float32Array(values.length);
	let length = 0;
	for (const v of values) {
		if (v === 0) continue;

		sorted[length++] = v;
	}

	if (length === 0) return 1;

	const subset = sorted.subarray(0, length);
	subset.sort();

	// Linear-interpolated quantile — handles small-n without the bias that `subset[floor(length*q)]`
	// introduces (e.g. length=4 would otherwise return the max as Q3, inflating the IQR fence).
	const quantile = (q: number) => {
		const pos = (length - 1) * q;
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		return subset[lo] + (subset[hi] - subset[lo]) * (pos - lo);
	};

	const q1 = quantile(0.25);
	const q3 = quantile(0.75);
	// P95 uses nearest-rank (not interpolation) so an extreme spike at the top of the sorted array
	// cannot drag P95 up via interpolation — e.g. `[3,4,5,6,7,10000]` must not pull P95 toward 10000.
	const p95 = subset[Math.floor((length - 1) * 0.95)];
	const max = subset[length - 1];
	// Tukey upper fence guards the scale on tight distributions where P95 ≈ max would leave no room
	// for the occasional taller-than-typical bar; P95 handles heavy tails where the fence sits too
	// high against the body of the data.
	const fence = q3 + 1.5 * (q3 - q1);
	const cap = Math.min(max, Math.max(p95, fence));

	return Math.max(1, Math.ceil(cap * 1.1));
}
