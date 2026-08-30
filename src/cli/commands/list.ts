import type { Command } from "commander";
import type { GlobalOptions } from "../context.ts";
import { openAlpm } from "../context.ts";
import { renderTable } from "../render/table.ts";
import { printJsonOk } from "../render/json.ts";
import type { Package } from "../../core/types.ts";

interface ListCommandOptions extends GlobalOptions {
  explicit?: boolean;
  deps?: boolean;
  unrequired?: boolean;
  foreign?: boolean;
  repo?: string;
}

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("list installed packages (local db), or a sync repo with --repo")
    .option("--explicit", "only explicitly installed packages")
    .option("--deps", "only packages installed as a dependency")
    .option("--unrequired", "only packages nothing depends on (orphans)")
    .option("--foreign", "only packages not present in any registered sync repo")
    .option("--repo <name>", "list a sync repo instead of the local db")
    .action(async function (this: Command, opts: ListCommandOptions) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      let pkgs = await alpm.list({ repo: opts.repo });

      if (opts.explicit) pkgs = pkgs.filter((p) => p.reason === "explicit");
      if (opts.deps) pkgs = pkgs.filter((p) => p.reason === "dependency");

      if (opts.foreign) {
        const syncNames = new Set<string>();
        for (const repo of alpm.config.repos) {
          for (const p of await alpm.list({ repo: repo.name })) syncNames.add(p.name);
        }
        pkgs = pkgs.filter((p) => !syncNames.has(p.name));
      }

      if (opts.unrequired) {
        // Matches pacman -Qdt: a dependency-installed package is only an
        // orphan if nothing requires it AND nothing optionally uses it -
        // requiredBy alone isn't enough (e.g. `tk` has no hard dependents
        // but is Optional For several installed packages).
        const kept: Package[] = [];
        for (const p of pkgs) {
          if (p.reason !== "dependency") continue;
          const requiredBy = await alpm.deps(p.name, { reverse: true });
          if (requiredBy.length > 0) continue;
          const optionalFor = await alpm.deps(p.name, { reverse: true, optional: true });
          if (optionalFor.length === 0) kept.push(p);
        }
        pkgs = kept;
      }

      if (globalOpts.json) {
        printJsonOk(pkgs);
        return;
      }
      console.log(
        renderTable(pkgs, [
          { header: "NAME", value: (p) => p.name },
          { header: "VERSION", value: (p) => p.version },
          { header: "REPO", value: (p) => p.db },
        ]),
      );
    });
}
