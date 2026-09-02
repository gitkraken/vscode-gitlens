type CharCodeMap = {
	readonly Hash: 35;
	readonly Slash: 47;
	readonly Digit0: 48;
	readonly Digit1: 49;
	readonly Digit2: 50;
	readonly Digit3: 51;
	readonly Digit4: 52;
	readonly Digit5: 53;
	readonly Digit6: 54;
	readonly Digit7: 55;
	readonly Digit8: 56;
	readonly Digit9: 57;
	readonly Backslash: 92;
	readonly A: 65;
	readonly B: 66;
	readonly C: 67;
	readonly D: 68;
	readonly E: 69;
	readonly F: 70;
	readonly Z: 90;
	readonly a: 97;
	readonly b: 98;
	readonly c: 99;
	readonly d: 100;
	readonly e: 101;
	readonly f: 102;
	readonly z: 122;
};

export const CharCode: CharCodeMap = {
	/**
	 * The `#` character.
	 */
	Hash: 35,
	/**
	 * The `/` character.
	 */
	Slash: 47,
	Digit0: 48,
	Digit1: 49,
	Digit2: 50,
	Digit3: 51,
	Digit4: 52,
	Digit5: 53,
	Digit6: 54,
	Digit7: 55,
	Digit8: 56,
	Digit9: 57,
	/**
	 * The `\` character.
	 */
	Backslash: 92,
	A: 65,
	B: 66,
	C: 67,
	D: 68,
	E: 69,
	F: 70,
	Z: 90,
	a: 97,
	b: 98,
	c: 99,
	d: 100,
	e: 101,
	f: 102,
	z: 122,
} as const satisfies Record<string, number>;
