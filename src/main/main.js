const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { registerAllHandlers } = require('./ipc-handlers');
const ResourceLocator = require('./utils/resource-locator');
const Logger = require('./utils/logger');

// 启动时记录环境信息（用于调试）
const debugInfo = {
  time: new Date().toISOString(),
  userProfile: process.env.USERPROFILE,
  home: process.env.HOME,
  appData: process.env.APPDATA,
  localAppData: process.env.LOCALAPPDATA,
  osHomedir: os.homedir(),
  cwd: process.cwd(),
  execPath: process.execPath,
  resourcesPath: process.resourcesPath,
  platform: process.platform,
  arch: process.arch,
  isPackaged: app.isPackaged
};
console.log('=== DEBUG INFO ===', debugInfo);

// 使用 ResourceLocator 检查资源文件
console.log('=== RESOURCE CHECK ===');
try {
  const resourceCheck = ResourceLocator.checkAllResources();
  resourceCheck.forEach(r => {
    console.log(`${r.name}: ${r.exists ? 'EXISTS' : 'MISSING'} (${r.path || 'N/A'})`);
  });
} catch (e) {
  console.error('Resource check failed:', e);
}

// 尝试写入调试文件
try {
  const debugPath = path.join(os.homedir(), 'openclaw-installer-debug.json');
  fs.writeFileSync(debugPath, JSON.stringify(debugInfo, null, 2));
  console.log('Debug info written to:', debugPath);
} catch (e) {
  console.error('Failed to write debug info:', e);
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenClaw 安装管理器 v1.0.0',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false,
    backgroundColor: '#1e1e2e'
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Minimal menu
  const menuTemplate = [
    {
      label: '文件',
      submenu: [
        { label: '退出', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '开发者工具', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '关于 OpenClaw', click: () => { require('electron').shell.openExternal('https://openclaw.ai'); } }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  registerAllHandlers(mainWindow);
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    app.quit();
  });
}
