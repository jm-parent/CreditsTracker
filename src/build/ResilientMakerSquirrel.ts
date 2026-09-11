import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { convertVersion, createWindowsInstaller } from 'electron-winstaller';
import fs from 'fs-extra';
import {
  buildSquirrelRceditArgs,
  isRecoverableSquirrelResourceEditFailure,
  retryRceditUntilReady,
} from './squirrelRceditRecovery';

const execFileAsync = promisify(execFile);

type MakeOptions = Parameters<MakerSquirrel['make']>[0];

type PackageAuthor = string | { name?: string } | undefined;

interface PackageJsonLike {
  author?: PackageAuthor;
  description?: string;
  name: string;
  version: string;
}

interface WinstallerConfig {
  appDirectory: string;
  authors?: string;
  copyright?: string;
  exe: string;
  fixUpPaths?: boolean;
  name?: string;
  noDelta?: boolean;
  noMsi?: boolean;
  outputDirectory: string;
  remoteReleases?: string;
  setupExe?: string;
  setupIcon?: string;
  setupMsi?: string;
  title: string;
}

function resolveAuthors(authors: string | undefined, author: PackageAuthor): string {
  if (authors) {
    return authors;
  }

  if (typeof author === 'string') {
    return author;
  }

  return author?.name ?? '';
}

export class ResilientMakerSquirrel extends MakerSquirrel {
  override async make({ dir, makeDir, targetArch, packageJSON, appName, forgeConfig }: MakeOptions) {
    const outPath = path.resolve(makeDir, `squirrel.windows/${targetArch}`);
    await this.ensureDirectory(outPath);

    const tmpFolder = await fs.mkdtemp(path.resolve(os.tmpdir(), 'squirrel-maker-'));
    await fs.copy(dir, tmpFolder);

    try {
      const winstallerConfig: WinstallerConfig = {
        name:
          typeof packageJSON.name === 'string'
            ? packageJSON.name.replace(/-/g, '_')
            : undefined,
        title: appName,
        noMsi: true,
        exe: `${forgeConfig.packagerConfig.executableName || appName}.exe`,
        setupExe: `${appName}-${packageJSON.version} Setup.exe`,
        ...(this.config as object),
        appDirectory: tmpFolder,
        outputDirectory: outPath,
      } as WinstallerConfig;

      try {
        await createWindowsInstaller(winstallerConfig);
      } catch (error) {
        const recovered = await this.recoverFailedResourceEdit(error, outPath, packageJSON, winstallerConfig);
        if (!recovered) {
          throw error;
        }
      }

      return this.resolveArtifacts(outPath, packageJSON.version, appName, winstallerConfig);
    } finally {
      await fs.remove(tmpFolder);
    }
  }

  private async recoverFailedResourceEdit(
    error: unknown,
    outPath: string,
    packageJSON: PackageJsonLike,
    winstallerConfig: WinstallerConfig,
  ): Promise<boolean> {
    if (!isRecoverableSquirrelResourceEditFailure(error)) {
      return false;
    }

    const setupExePath = path.join(outPath, 'Setup.exe');
    const fullNupkgPath = path.join(
      outPath,
      `${winstallerConfig.name}-${convertVersion(packageJSON.version)}-full.nupkg`,
    );
    const releasesPath = path.join(outPath, 'RELEASES');

    if (!(await fs.pathExists(setupExePath)) || !(await fs.pathExists(fullNupkgPath)) || !(await fs.pathExists(releasesPath))) {
      return false;
    }
    const rceditPath = path.join(process.cwd(), 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
    await retryRceditUntilReady(() =>
      execFileAsync(
        rceditPath,
        buildSquirrelRceditArgs({
          setupExePath,
          authors: resolveAuthors(winstallerConfig.authors, packageJSON.author),
          copyright: winstallerConfig.copyright,
          description: packageJSON.description,
          iconPath: winstallerConfig.setupIcon ? path.resolve(winstallerConfig.setupIcon) : undefined,
          id: winstallerConfig.name ?? packageJSON.name,
          version: packageJSON.version,
        }),
      ),
    );

    if (winstallerConfig.fixUpPaths !== false) {
      const fixedSetupPath = path.join(
        outPath,
        winstallerConfig.setupExe ?? `${winstallerConfig.title}Setup.exe`,
      );

      if (fixedSetupPath !== setupExePath) {
        await fs.remove(fixedSetupPath);
        await fs.move(setupExePath, fixedSetupPath);
      }
    }

    return true;
  }

  private async resolveArtifacts(
    outPath: string,
    version: string,
    appName: string,
    winstallerConfig: WinstallerConfig,
  ) {
    const nupkgVersion = convertVersion(version);
    const artifacts = [
      path.resolve(outPath, 'RELEASES'),
      path.resolve(outPath, winstallerConfig.setupExe || `${appName}Setup.exe`),
      path.resolve(outPath, `${winstallerConfig.name}-${nupkgVersion}-full.nupkg`),
    ];

    const deltaPath = path.resolve(outPath, `${winstallerConfig.name}-${nupkgVersion}-delta.nupkg`);
    if (winstallerConfig.remoteReleases && !winstallerConfig.noDelta && (await fs.pathExists(deltaPath))) {
      artifacts.push(deltaPath);
    }

    const msiPath = path.resolve(outPath, winstallerConfig.setupMsi || `${appName}Setup.msi`);
    if (!winstallerConfig.noMsi && (await fs.pathExists(msiPath))) {
      artifacts.push(msiPath);
    }

    return artifacts;
  }
}
