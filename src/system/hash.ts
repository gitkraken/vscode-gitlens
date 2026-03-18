/**
 * FNV-1a 32-bit hash — fast, non-cryptographic hash with excellent distribution.
 * Pure integer math, no allocations.
 */
export function fnv1aHash(str: string): number {
	let hash = 0x811c9dc5; // FNV offset basis
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193); // FNV prime, true 32-bit multiply
	}
	return hash;
}

/**
 * FNV-1a 64-bit hash — fast, non-cryptographic hash with excellent distribution.
 * Uses split hi/lo 32-bit integers to avoid BigInt allocation overhead.
 * The 64-bit prime 0x100000001b3 decomposes as (0x100 << 32) + 0x1b3,
 * keeping all intermediate products under 2^41 (safe for JS number math).
 *
 * Why 64-bit instead of 32-bit:
 *
 * The probability of successful token regeneration without a hash collision is
 * P1 ≈ 1 - 2^-32, which is very high.
 * But if the token is updated hourly, then the probability for a user
 * of having a year without consecutive collisions:
 * PY = P1^hours
 * which measn that probability of having at least one collision is:
 * EY = 1 - PY = 2 * 10^-6
 * Which means that 2 users of 1M have a chance to have it.
 *
 * It does not mean that they open an issue, they probably won't even notice.
 * But it might happen with a real person in real life.
 *
 * By using fnv1aHash64 we reduce the chance to 0.
 */
export function fnv1aHash64(str: string): string {
	// FNV-1a 64-bit offset basis: 0xcbf29ce484222325
	let hi = 0xcbf29ce4;
	let lo = 0x84222325;

	for (let i = 0; i < str.length; i++) {
		lo = (lo ^ str.charCodeAt(i)) >>> 0;

		// Multiply (hi:lo) by prime 0x100000001b3 = (0x100:0x1b3)
		const loProduct = lo * 0x1b3;
		const newLo = loProduct >>> 0;
		const carry = (loProduct - newLo) / 0x100000000;
		hi = (hi * 0x1b3 + lo * 0x100 + carry) >>> 0;
		lo = newLo;
	}

	return (hi >>> 0).toString(16).padStart(8, '0') + (lo >>> 0).toString(16).padStart(8, '0');
}
