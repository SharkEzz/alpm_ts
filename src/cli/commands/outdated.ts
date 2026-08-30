import type { Command } from 'commander';
import type { GlobalOptions } from '../context.ts';
import { openAlpm } from '../context.ts';
import { renderTable } from '../render/table.ts';
import { printJsonOk } from '../render/json.ts';

export function registerOutdatedCommand(program: Command): void {
  program
    .command('outdated')
    .description('list installed packages with a newer version in a registered sync repo')
    .action(async function (this: Command) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      const entries = await alpm.outdated();

      if (globalOpts.json) {
        printJsonOk(entries);
        return;
      }
      console.log(
        renderTable(entries, [
          { header: 'NAME', value: (e) => e.name },
          { header: 'CURRENT', value: (e) => e.currentVersion },
          { header: 'NEW', value: (e) => e.newVersion },
          { header: 'REPO', value: (e) => e.db },
        ]),
      );
    });
}
