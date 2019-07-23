'use strict';
/*global document*/

type DOMEvent = Event;

export namespace DOM {
    export type Event = DOMEvent;

    export function getElementById<T extends HTMLElement>(id: string): T {
        return document.getElementById(id) as T;
    }

    // export function query<T extends HTMLElement>(selectors: string): T;
    // export function query<T extends HTMLElement>(element: HTMLElement, selectors: string): T;
    // export function query<T extends HTMLElement>(elementOrselectors: string | HTMLElement, selectors?: string): T {
    //     let element: Document | HTMLElement;
    //     if (typeof elementOrselectors === 'string') {
    //         element = document;
    //         selectors = elementOrselectors;
    //     }
    //     else {
    //         element = elementOrselectors;
    //     }

    //     return element.querySelector(selectors) as T;
    // }

    // export function queryAll<T extends Element>(selectors: string): T;
    // export function queryAll<T extends Element>(element: HTMLElement, selectors: string): T;
    // export function queryAll<T extends Element>(elementOrselectors: string | HTMLElement, selectors?: string): T {
    //     let element: Document | HTMLElement;
    //     if (typeof elementOrselectors === 'string') {
    //         element = document;
    //         selectors = elementOrselectors;
    //     }
    //     else {
    //         element = elementOrselectors;
    //     }

    //     return element.querySelectorAll(selectors) as NodeList<T>;
    // }

    export function listenAll(selector: string, name: string, listener: EventListener) {
        const els = (document.querySelectorAll(selector) as unknown) as Element[];
        for (const el of els) {
            el.addEventListener(name, listener, false);
        }
    }
}
