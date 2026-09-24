declare module 'fs-extra' {
  interface FsExtraModule {
    copy(src: string, dest: string): Promise<void>;
    mkdtemp(prefix: string): Promise<string>;
    move(src: string, dest: string): Promise<void>;
    pathExists(path: string): Promise<boolean>;
    remove(path: string): Promise<void>;
  }

  const fsExtra: FsExtraModule;
  export default fsExtra;
}
