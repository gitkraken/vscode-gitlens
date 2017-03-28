'use strict';
import { GitHubService } from './github';

export class GitLabService extends GitHubService {

    constructor(public domain: string, public path: string) {
        super(domain, path);
    }

    get name() {
        return 'GitLab';
    }
}