import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureSquirrelSevenZipAlias } from './ensureSquirrelSevenZipAlias';

const tempDirs: string[] = [];

function createVendorDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'credits-tracker-squirrel-'));
  const vendorDir = path.join(dir, 'vendor');
  fs.mkdirSync(vendorDir, { recursive: true });
  tempDirs.push(dir);
  return vendorDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ensureSquirrelSevenZipAlias', () => {
  it('copies the architecture-specific Squirrel 7-Zip helper to 7z.exe when the alias is missing', () => {
    const vendorDir = createVendorDir();
    const exeSourcePath = path.join(vendorDir, '7z-x64.exe');
    const dllSourcePath = path.join(vendorDir, '7z-x64.dll');
    const exeAliasPath = path.join(vendorDir, '7z.exe');
    const dllAliasPath = path.join(vendorDir, '7z.dll');

    fs.writeFileSync(exeSourcePath, 'x64-helper');
    fs.writeFileSync(dllSourcePath, 'x64-module');

    ensureSquirrelSevenZipAlias(vendorDir, 'x64');

    expect(fs.readFileSync(exeAliasPath, 'utf8')).toBe('x64-helper');
    expect(fs.readFileSync(dllAliasPath, 'utf8')).toBe('x64-module');
  });

  it('leaves an existing 7z.exe alias untouched', () => {
    const vendorDir = createVendorDir();
    const exeSourcePath = path.join(vendorDir, '7z-x64.exe');
    const dllSourcePath = path.join(vendorDir, '7z-x64.dll');
    const exeAliasPath = path.join(vendorDir, '7z.exe');
    const dllAliasPath = path.join(vendorDir, '7z.dll');

    fs.writeFileSync(exeSourcePath, 'replacement-helper');
    fs.writeFileSync(dllSourcePath, 'replacement-module');
    fs.writeFileSync(exeAliasPath, 'existing-helper');
    fs.writeFileSync(dllAliasPath, 'existing-module');

    ensureSquirrelSevenZipAlias(vendorDir, 'x64');

    expect(fs.readFileSync(exeAliasPath, 'utf8')).toBe('existing-helper');
    expect(fs.readFileSync(dllAliasPath, 'utf8')).toBe('existing-module');
  });

  it('throws when the expected architecture-specific helper files are missing', () => {
    const vendorDir = createVendorDir();

    expect(() => ensureSquirrelSevenZipAlias(vendorDir, 'x64')).toThrow(
      `Squirrel vendor helper is missing: ${path.join(vendorDir, '7z-x64.exe')}`,
    );
  });
});
