import fs from 'node:fs';

import { flock } from 'fs-ext-extra-prebuilt';

const lockPath = process.argv[2];
const descriptor = fs.openSync(lockPath, 'a+');

flock(descriptor, 'exnb', (error) => {
  if (error) {
    process.stderr.write(`LOCK_FAILED:${error.code || 'UNKNOWN'}\n`);
    process.exit(2);
  }
  process.stdout.write('LOCKED\n');
});

setInterval(() => undefined, 1_000);
