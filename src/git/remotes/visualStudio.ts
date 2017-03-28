'use strict';
import { RemoteProvider } from './provider';

export class VisualStudioService extends RemoteProvider {

    constructor(public domain: string, public path: string) {
        super(domain, path);
    }

    get name() {
        return 'Visual Studio Team Services';
    }

    protected getUrlForBranch(branch: string): string {
        return `${this.baseUrl}/?version=GB${branch}&_a=history`;
    }

    protected getUrlForCommit(sha: string): string {
        return `${this.baseUrl}/commit/${sha}`;
    }

    protected getUrlForFile(fileName: string, branch?: string, sha?: string): string {
        if (sha) return `${this.baseUrl}/commit/${sha}/?_a=contents&path=%2F${fileName}`;
        if (branch) return `${this.baseUrl}/?path=%2F${fileName}&version=GB${branch}&_a=contents`;
        return `${this.baseUrl}?path=%2F${fileName}`;
    }
}