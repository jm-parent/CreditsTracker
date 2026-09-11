import fs from 'node:fs';
import path from 'node:path';

function getSquirrelSevenZipBinarySuffix(arch: NodeJS.Architecture): 'arm64' | 'x64' {
  return arch === 'arm64' ? 'arm64' : 'x64';
}

export function ensureSquirrelSevenZipAlias(
  vendorDir: string = path.join(process.cwd(), 'node_modules', 'electron-winstaller', 'vendor'),
  arch: NodeJS.Architecture = process.arch,
): void {
  const suffix = getSquirrelSevenZipBinarySuffix(arch);

  for (const extension of ['exe', 'dll'] as const) {
    const aliasPath = path.join(vendorDir, `7z.${extension}`);
    if (fs.existsSync(aliasPath)) {
      continue;
    }

    const sourcePath = path.join(vendorDir, `7z-${suffix}.${extension}`);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Squirrel vendor helper is missing: ${sourcePath}`);
    }

    fs.copyFileSync(sourcePath, aliasPath);
  }
}
