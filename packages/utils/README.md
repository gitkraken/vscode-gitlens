# `@gitlens/utils`

Browser- and Node-compatible utility modules shared by GitLens packages. Consumers import explicit
subpaths so bundlers include only the requested implementation.

```ts
import { formatDate } from '@gitlens/utils/date.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { getBranchNameWithoutRemote } from '@gitlens/utils/gitRefs.js';
import { LruMap } from '@gitlens/utils/lruMap.js';
```

Environment-dependent modules resolve through package import conditions. Browser consumers are verified
from the packed tarball to ensure their selected subpaths do not pull in Node-only code.

## License

MIT; see `LICENSE`.
