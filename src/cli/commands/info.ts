import type { Command } from "commander";
import type { GlobalOptions } from "../context.ts";
import { openAlpm, formatDependency, NotFoundError, EXIT_NOT_FOUND } from "../context.ts";
import { printJsonOk } from "../render/json.ts";
import { bold } from "../render/color.ts";
import type { Package } from "../../core/types.ts";

interface InfoCommandOptions extends GlobalOptions {
  sync?: boolean;
  repo?: string;
}

function renderInfo(pkg: Package): string {
  const lines: string[] = [];
  const field = (label: string, value: string) => lines.push(`${bold(label.padEnd(15))}: ${value}`);

  field("Name", pkg.name);
  field("Version", pkg.version);
  field("Repository", pkg.db);
  if (pkg.desc !== undefined) field("Description", pkg.desc);
  if (pkg.url !== undefined) field("URL", pkg.url);
  if (pkg.licenses !== undefined) field("Licenses", pkg.licenses.join(" ") || "none");
  if (pkg.groups !== undefined) field("Groups", pkg.groups.join(" ") || "none");
  if (pkg.depends !== undefined) field("Depends On", pkg.depends.map(formatDependency).join("  ") || "none");
  if (pkg.optdepends !== undefined) {
    field("Optional Deps", pkg.optdepends.length === 0 ? "none" : "");
    for (const dep of pkg.optdepends) {
      lines.push(`  ${formatDependency(dep)}${dep.desc ? `: ${dep.desc}` : ""}`);
    }
  }
  if (pkg.provides !== undefined) field("Provides", pkg.provides.join("  ") || "none");
  if (pkg.conflicts !== undefined) field("Conflicts With", pkg.conflicts.join("  ") || "none");
  if (pkg.replaces !== undefined) field("Replaces", pkg.replaces.join("  ") || "none");
  field("Installed Size", `${pkg.isize} bytes`);
  field("Reason", pkg.reason === "explicit" ? "Explicitly installed" : "Installed as a dependency");
  if (pkg.packager !== undefined) field("Packager", pkg.packager);
  if (pkg.builddate !== undefined) field("Build Date", pkg.builddate.toISOString());
  if (pkg.installdate !== undefined) field("Install Date", pkg.installdate.toISOString());
  if (pkg.validation !== undefined) field("Validated By", pkg.validation.join(" ") || "none");

  return lines.join("\n");
}

export function registerInfoCommand(program: Command): void {
  program
    .command("info")
    .description("show full details for one or more packages")
    .argument("<packages...>", "package names")
    .option("--sync", "look up in registered sync repos instead of the local db")
    .option("--repo <name>", "restrict a --sync lookup to one repo")
    .action(async function (this: Command, names: string[], opts: InfoCommandOptions) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      const found: Package[] = [];
      const missing: string[] = [];
      for (const name of names) {
        const pkg = await alpm.info(name, { sync: opts.sync, repo: opts.repo });
        if (pkg) found.push(pkg);
        else missing.push(name);
      }

      const notFoundMessage = missing.length > 0 ? `package(s) not found: ${missing.join(", ")}` : undefined;

      if (globalOpts.json) {
        // A --json consumer needs exactly one parseable document, so a
        // partial-miss still gets one envelope (with both the results found
        // and the error) rather than a success envelope followed by a
        // separate error one.
        printJsonOk(found);
        if (notFoundMessage) process.exitCode = EXIT_NOT_FOUND;
        return;
      }

      console.log(found.map(renderInfo).join("\n\n"));
      if (notFoundMessage) {
        throw new NotFoundError(notFoundMessage);
      }
    });
}
