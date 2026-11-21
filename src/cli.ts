#!/usr/bin/env node
import * as p from '@clack/prompts';
import { run } from './run';
import { UserError } from './utils/errors';

run(process.argv.slice(2), process.cwd()).catch((err) => {
  if (err instanceof UserError) p.cancel(err.message);
  else console.error(err);
  process.exitCode = 1;
});
