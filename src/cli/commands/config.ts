import type { Command } from 'commander';
import type { GlobalOptions } from '../context.ts';
import { openAlpm } from '../context.ts';
import { printJsonOk } from '../render/json.ts';
import { bold } from '../render/color.ts';

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('show the effective configuration (parsed pacman.conf merged with libalpm handle state)')
    .action(async function (this: Command) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      const handleOptions = await alpm.options();
      const effective = {
        root: handleOptions.root,
        dbpath: handleOptions.dbpath,
        architectures: handleOptions.architectures,
        cachedirs:
          handleOptions.cachedirs.length > 0 ? handleOptions.cachedirs : alpm.config.options.cacheDirs,
        hookDirs: alpm.config.options.hookDirs,
        gpgDir: alpm.config.options.gpgDir,
        logFile: alpm.config.options.logFile,
        ignorePkgs: alpm.config.options.ignorePkgs,
        ignoreGroups: alpm.config.options.ignoreGroups,
        holdPkgs: alpm.config.options.holdPkgs,
        repos: alpm.config.repos.map((r) => r.name),
      };

      if (globalOpts.json) {
        printJsonOk(effective);
        return;
      }
      for (const [key, value] of Object.entries(effective)) {
        const shown = Array.isArray(value) ? value.join(' ') || '(none)' : value;
        console.log(`${bold(key.padEnd(14))}: ${shown}`);
      }
    });
}
