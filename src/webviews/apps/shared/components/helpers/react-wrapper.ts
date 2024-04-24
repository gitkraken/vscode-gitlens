/* eslint-disable @typescript-eslint/ban-types */
import type { EventName, Options } from '@lit/react';
import { createComponent } from '@lit/react';
import React from 'react';

type Constructor<T> = new () => T;
type EventNames = Record<string, EventName | string>;
type Opts<I extends HTMLElement, E extends EventNames = {}> = Omit<Options<I, E>, 'elementClass' | 'react'>;

export function reactWrapper<I extends HTMLElement, E extends EventNames = {}>(
	elementClass: Constructor<I>,
	options: Opts<I, E>,
) {
	return createComponent<I, E>({
		...options,
		elementClass: elementClass,
		react: React,
	});
}
