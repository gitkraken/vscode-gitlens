/**
 * FNV-1a 32-bit hash — fast, non-cryptographic hash with excellent distribution.
 * Pure integer math, no allocations.
 */
export function fnv1aHash(str: string): number {
	let hash = 0x811c9dc5; // FNV offset basis
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = (hash * 0x01000193) | 0; // FNV prime, keep 32-bit
	}
	return hash;
}
