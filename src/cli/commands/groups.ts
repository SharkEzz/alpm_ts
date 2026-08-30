import type { Command } from 'commander';
import type { GlobalOptions } from '../context.ts';
import { openAlpm, NotFoundError } from '../context.ts';
import { printJsonOk } from '../render/json.ts';

interface GroupsCommandOptions extends GlobalOptions {
  repo?: string;
}

export function registerGroupsCommand(program: Command): void {
  program
    .command('groups')
    .description('list package groups, or the members of one group')
    .argument('[name]', 'group name')
    .option('--repo <name>', 'look in a sync repo instead of the local db')
    .action(async function (this: Command, name: string | undefined, opts: GroupsCommandOptions) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      const groups = await alpm.groups(name, opts.repo ? { repo: opts.repo } : undefined);
      if (name !== undefined && groups.length === 0) {
        throw new NotFoundError(`no such group: ${name}`);
      }

      if (globalOpts.json) {
        printJsonOk(groups);
        return;
      }
      if (name !== undefined) {
        for (const pkg of groups[0]?.packages ?? []) console.log(pkg);
      } else {
        for (const group of groups) console.log(group.name);
      }
    });
}
