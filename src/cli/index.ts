#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { registerListCommand } from './commands/list.ts';
import { registerInfoCommand } from './commands/info.ts';
import { registerSearchCommand } from './commands/search.ts';
import { registerFilesCommand } from './commands/files.ts';
import { registerOwnsCommand } from './commands/owns.ts';
import { registerDepsCommand } from './commands/deps.ts';
import { registerOutdatedCommand } from './commands/outdated.ts';
import { registerGroupsCommand } from './commands/groups.ts';
import { registerReposCommand } from './commands/repos.ts';
import { registerConfigCommand } from './commands/config.ts';
import { setColorEnabled } from './render/color.ts';
import { printJsonError } from './render/json.ts';
import {
  NotFoundError,
  EXIT_OK,
  EXIT_NOT_FOUND,
  EXIT_USAGE,
  EXIT_ALPM_ERROR,
  type GlobalOptions,
} from './context.ts';
import { AlpmError } from '../core/errors.ts';

const program = new Command();
program
  .name('alpm')
  .description('Query the Arch package database directly through libalpm')
  .option('--json', 'output structured JSON instead of a table')
  .option('--root <dir>', 'alternate root directory')
  .option('--dbpath <dir>', 'alternate pacman database path')
  .option('--config <file>', 'alternate pacman.conf path')
  .option('--no-color', 'disable colored output')
  .exitOverride()
  // Suppress commander's own stderr write on errors - handleError() below
  // owns all error output (text or --json) so a usage error isn't printed
  // twice (once by commander, once by us).
  .configureOutput({ writeErr: () => {} });

registerListCommand(program);
registerInfoCommand(program);
registerSearchCommand(program);
registerFilesCommand(program);
registerOwnsCommand(program);
registerDepsCommand(program);
registerOutdatedCommand(program);
registerGroupsCommand(program);
registerReposCommand(program);
registerConfigCommand(program);

program.hook('preAction', (thisCommand) => {
  setColorEnabled(thisCommand.opts<GlobalOptions>().color !== false);
});

function wantsJson(): boolean {
  try {
    return program.opts<GlobalOptions>().json === true;
  } catch {
    return false;
  }
}

async function handleError(err: unknown): Promise<void> {
  const json = wantsJson();

  if (err instanceof CommanderError) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
      process.exitCode = EXIT_OK;
      return;
    }
    process.exitCode = EXIT_USAGE;
    if (json) printJsonError(EXIT_USAGE, 'UsageError', err.message);
    else console.error(err.message);
    return;
  }
  if (err instanceof NotFoundError) {
    process.exitCode = EXIT_NOT_FOUND;
    if (json) printJsonError(EXIT_NOT_FOUND, 'NotFound', err.message);
    else console.error(err.message);
    return;
  }
  if (err instanceof AlpmError) {
    process.exitCode = EXIT_ALPM_ERROR;
    if (json) printJsonError(err.code, err.name, err.message);
    else console.error(`${err.name}: ${err.message}`);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  process.exitCode = EXIT_ALPM_ERROR;
  if (json) printJsonError(EXIT_ALPM_ERROR, 'Error', message);
  else console.error(message);
}

try {
  await program.parseAsync(process.argv);
  process.exitCode ??= EXIT_OK;
} catch (err) {
  await handleError(err);
}
