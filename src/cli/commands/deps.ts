import type { Command } from "commander";
import type { GlobalOptions } from "../context.ts";
import { openAlpm, formatDependency } from "../context.ts";
import { printJsonOk } from "../render/json.ts";
import type { Alpm } from "../../core/alpm.ts";
import type { Dependency } from "../../core/types.ts";

interface DepsCommandOptions extends GlobalOptions {
  reverse?: boolean;
  optional?: boolean;
  tree?: boolean;
}

interface TreeNode {
  name: string;
  children: TreeNode[];
}

const MAX_TREE_DEPTH = 15;

async function childNamesOf(alpm: Alpm, name: string, opts: DepsCommandOptions): Promise<string[]> {
  if (opts.reverse) {
    return alpm.deps(name, { reverse: true, optional: opts.optional }) as Promise<string[]>;
  }
  const deps = (await alpm.deps(name, { optional: opts.optional })) as Dependency[];
  return deps.map((d) => d.name);
}

/**
 * Cycle-guarded via `path` (the current ancestor chain): a diamond
 * dependency reached through two different branches is expanded twice,
 * same as real dependency trees; only a genuine cycle back to an ancestor
 * on the current path is cut short.
 */
async function buildTree(
  alpm: Alpm,
  name: string,
  opts: DepsCommandOptions,
  path: Set<string>,
  depth: number,
): Promise<TreeNode> {
  if (path.has(name) || depth >= MAX_TREE_DEPTH) {
    return { name, children: [] };
  }
  path.add(name);
  try {
    let names: string[];
    try {
      names = await childNamesOf(alpm, name, opts);
    } catch (err) {
      // The root must be a real, installed package - anything else fails
      // loudly. A deeper name that doesn't resolve to a literal installed
      // package (e.g. a soname-style dependency like "libreadline.so",
      // which is a virtual `provides` name rather than a package name) is
      // rendered as a leaf instead of aborting the whole tree.
      if (depth === 0) throw err;
      names = [];
    }
    const children = await Promise.all(names.map((childName) => buildTree(alpm, childName, opts, path, depth + 1)));
    return { name, children };
  } finally {
    path.delete(name);
  }
}

function renderTree(node: TreeNode, prefix = ""): string {
  const lines = [node.name];
  node.children.forEach((child, i) => {
    const isLast = i === node.children.length - 1;
    lines.push(renderTreeLines(child, prefix, isLast));
  });
  return lines.join("\n");
}

function renderTreeLines(node: TreeNode, parentPrefix: string, isLast: boolean): string {
  const branch = isLast ? "└── " : "├── ";
  const childPrefix = parentPrefix + (isLast ? "    " : "│   ");
  const lines = [`${parentPrefix}${branch}${node.name}`];
  node.children.forEach((child, i) => {
    lines.push(renderTreeLines(child, childPrefix, i === node.children.length - 1));
  });
  return lines.join("\n");
}

export function registerDepsCommand(program: Command): void {
  program
    .command("deps")
    .description("show a package's dependencies, or what depends on it with --reverse")
    .argument("<package>", "package name")
    .option("--reverse", "show packages that depend on this one instead")
    .option("--optional", "use optional dependencies instead of required ones")
    .option("--tree", "recursively expand the dependency graph")
    .action(async function (this: Command, name: string, opts: DepsCommandOptions) {
      const globalOpts = this.optsWithGlobals<GlobalOptions>();
      await using alpm = await openAlpm(globalOpts);

      if (opts.tree) {
        const tree = await buildTree(alpm, name, opts, new Set(), 0);
        if (globalOpts.json) {
          printJsonOk(tree);
        } else {
          console.log(renderTree(tree));
        }
        return;
      }

      const result = await alpm.deps(name, { reverse: opts.reverse, optional: opts.optional });

      if (globalOpts.json) {
        printJsonOk(result);
        return;
      }
      if (opts.reverse) {
        for (const pkgName of result as string[]) console.log(pkgName);
      } else {
        for (const dep of result as Dependency[]) console.log(formatDependency(dep));
      }
    });
}
