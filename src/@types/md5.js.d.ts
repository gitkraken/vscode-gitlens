/// <reference types="node" />

declare module 'md5.js' {
	import type { Hash } from 'crypto';

	export = MD5;

	interface MD5 extends Hash {
		new (): MD5;
	}

	declare const MD5: MD5;
}
