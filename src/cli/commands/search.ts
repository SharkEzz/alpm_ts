import type { Command } from "commander";
import type { GlobalOptions } from "../context.ts";
import { openAlpm } from "../context.ts";
import { renderTable } from "../render/table.ts";
import { printJsonOk } from "../render/json.ts";

interface SearchCommandOptions extends GlobalOptions {
  repo?: string;
  local?: boolean;
}

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .description("search sync repos (or the local db with --local) by regex")
    .argument("<patterns...>", "regular expressions to match against name/description")
    .option("--repo <name>", "restrict the search to one sync repo")
    .option("--local", "search the local db instead of sync repos")
    .action(async function (this: Command, patterns: string[], opts: SearchCommandOptions) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      const results = await alpm.search(patterns, { repo: opts.repo, local: opts.local });

      if (globalOpts.json) {
        printJsonOk(results);
        return;
      }
      console.log(
        renderTable(results, [
          { header: "NAME", value: (p) => p.name },
          { header: "VERSION", value: (p) => p.version },
          { header: "REPO", value: (p) => p.db },
        ]),
      );
    });
}
