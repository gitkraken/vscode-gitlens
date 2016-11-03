/// <reference path="../../../node_modules/rxjs/Observable.d.ts" />
declare module "spawn-rx" {
    import { Observable } from 'rxjs/Observable';

    namespace spawnrx {
        function findActualExecutable(exe: string, args: Array<string>): { cmd: string, args: Array<string> };
        function spawnDetached(exe: string, params: Array<string>, opts: Object|undefined): Observable<string>;
        function spawn(exe: string, params: Array<string>, opts: Object|undefined): Observable<string>;
        function spawnDetachedPromise(exe: string, params: Array<string>, opts: Object|undefined): Promise<string>;
        function spawnPromise(exe: string, params: Array<string>, opts: Object|undefined): Promise<string>;
    }
    export = spawnrx;
}