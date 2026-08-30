import type { Command } from "commander";
import type { GlobalOptions } from "../context.ts";
import { openAlpm } from "../context.ts";
import { renderTable } from "../render/table.ts";
import { printJsonOk } from "../render/json.ts";

export function registerReposCommand(program: Command): void {
  program
    .command("repos")
    .description("list registered sync repos, in resolution priority order")
    .action(async function (this: Command) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      if (globalOpts.json) {
        printJsonOk(alpm.config.repos);
        return;
      }
      console.log(
        renderTable(alpm.config.repos, [
          { header: "NAME", value: (r) => r.name },
          { header: "SERVERS", value: (r) => String(r.servers.length) },
        ]),
      );
    });
}
