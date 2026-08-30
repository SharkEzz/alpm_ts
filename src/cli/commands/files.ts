import type { Command } from "commander";
import type { GlobalOptions } from "../context.ts";
import { openAlpm, NotFoundError } from "../context.ts";
import { printJsonOk } from "../render/json.ts";

export function registerFilesCommand(program: Command): void {
  program
    .command("files")
    .description("list the files owned by an installed package")
    .argument("<package>", "package name")
    .action(async function (this: Command, name: string) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      const files = await alpm.files(name);
      if (files === null) {
        throw new NotFoundError(`package not found: ${name}`);
      }

      if (globalOpts.json) {
        printJsonOk(files);
        return;
      }
      for (const file of files) {
        console.log(`/${file.name}`);
      }
    });
}
