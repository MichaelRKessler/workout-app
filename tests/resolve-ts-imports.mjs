/**
 * Node's test runner does not add .ts to extensionless imports. Convex files
 * omit the suffix, which is what `tsc -p convex` requires.
 */
export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);
  if (relative && !hasExtension) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {
      // Fall through when the sibling .ts file does not exist.
    }
  }
  return nextResolve(specifier, context);
}
