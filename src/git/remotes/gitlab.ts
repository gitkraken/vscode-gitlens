'use strict';
import { GitHubService } from './github';

export class GitLabService extends GitHubService {

    constructor(public domain: string, public path: string, public custom: boolean = false) {
        super(domain, path);
    }

    get name() {
        return this.formatName('GitLab');
    }
}