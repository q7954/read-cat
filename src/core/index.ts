import { Logger } from './logger';
import { EventCode } from '../../events';
import { Plugins } from './plugins';
import { Database } from './database';
import { IpcRenderer } from './ipc-renderer';
import path from 'path';
import metadata from '../../metadata.json';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../store/settings';
import { createUpdater } from './updater';
import { Updater } from './updater/updater';
import Module from 'module';
import { isPluginContext, newError } from './utils';

export class Core {
  static logger: Logger;
  static ipc: IpcRenderer;
  static plugins: Plugins;
  static database: Database;
  static userDataPath: string;
  static isDev: boolean;
  static updater: Updater;

  static async init(): Promise<Error[] | undefined> {
    const load = (<any>Module)._load;
    (<any>Module)._load = (requests: string, parent: any, isMain: boolean) => {
      if (isPluginContext()) {
        throw newError(`Illegal function call require('${requests}')`);
      }
      return load(requests, parent, isMain);
    }
    Core.setValue(window, 'process', {
      platform: process.platform,
      cwd: process.cwd,
      versions: process.versions
    });
    Core.setValue(window, 'module', {});
    const error: Error[] = [];
    Core.setValue(window, 'METADATA', metadata);
    Core.initUpdater();
    Core.initLogger();
    await Core.initDatabase().catch(e => {
      error.push(e);
      return Promise.resolve();
    });
    await Core.initPlugins().catch(e => {
      error.push(e);
      return Promise.resolve();
    });

    GLOBAL_DB.store.bookshelfStore.read();
    Core.setValue(window, 'Core', Core);
    if (error.length > 0) {
      return Promise.reject(error);
    }
  }

  public static setValue(obj: any, key: string, value: any) {
    Object.defineProperty(obj, key, {
      get() {
        if (isPluginContext()) {
          throw newError(`Permission denied to access property or function [${String(key)}]`);
        }
        return value;
      },
      configurable: false,
    });
  }

  public static initLogger() {
    Core.setValue(Core, 'logger', new Logger({
      enableWriteToFile: !Core.isDev,
      savePath: `${path.join(Core.userDataPath, 'logs')}`,
      debug: Core.isDev
    }));
    Core.setValue(window, 'GLOBAL_LOG', Core.logger);
  }

  public static initUpdater() {
    const { updateSource } = storeToRefs(useSettingsStore());
    const updater = createUpdater(updateSource.value);
    Core.setValue(Core, 'updater', updater);
    Core.setValue(window, 'GLOBAL_UPDATER', Core.updater);
  }

  public static initIpcRenderer() {
    Core.setValue(Core, 'ipc', new IpcRenderer());
    Core.setValue(window, 'GLOBAL_IPC', Core.ipc);
    const userDataPath = Core.ipc.sendSync<string>(EventCode.SYNC_GET_USER_DATA_PATH);
    if (!userDataPath) {
      throw newError('user data path is null');
    }
    Core.setValue(Core, 'userDataPath', userDataPath);
    Core.setValue(Core, 'isDev', Core.ipc.sendSync<boolean>(EventCode.SYNC_IS_DEV));
  }

  public static async initPlugins() {

    Core.setValue(Core, 'plugins', new Plugins());
    Core.setValue(window, 'GLOBAL_PLUGINS', Core.plugins);
    await Core.plugins.importPool();
  }

  public static async initDatabase() {
    const db = new Database();
    await db.open();
    Core.setValue(Core, 'database', db);
    Core.setValue(window, 'GLOBAL_DB', Core.database);
  }
}