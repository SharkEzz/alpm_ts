import type { Command } from 'commander';
import type { GlobalOptions } from '../context.ts';
import { openAlpm, NotFoundError } from '../context.ts';
import { printJsonOk } from '../render/json.ts';

export function registerOwnsCommand(program: Command): void {
  program
    .command('owns')
    .description('find which installed package owns a file path')
    .argument('<path>', 'file path')
    .action(async function (this: Command, path: string) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      const owners = await alpm.owners(path);
      if (owners.length === 0) {
        throw new NotFoundError(`no package owns: ${path}`);
      }

      if (globalOpts.json) {
        printJsonOk(owners);
        return;
      }
      for (const pkg of owners) {
        console.log(`${path} is owned by ${pkg.name} ${pkg.version}`);
      }
    });
}
