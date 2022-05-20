const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const createWindow = () => {
    const win = new BrowserWindow({
        width: 1920,
        height: 720,
        icon: path.join(__dirname, 'frontend/favicon.ico'),
        zoomToPageWidth: true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
        }

    })
    win.webContents.on('did-create-window', (window) => {
        window.on('close', (e) => {
            e.preventDefault()
            window.destroy()
        })
    })
    win.webContents.setWindowOpenHandler(({}) => {
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                closable: true,
                icon: path.join(__dirname, 'frontend/favicon.ico'),
                autoHideMenuBar: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    enableRemoteModule: true,
                    sandbox: true,

                }
            }
        }
    })
    win.maximize();
    win.loadFile('./frontend/index.html')
}

app.whenReady().then(() => {
    createWindow()
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

let backend;
backend = path.join(__dirname, 'backend.exe')
var execfile = require('child_process').execFile;
execfile(
 backend,
 {
  windowsHide: true,
 }, (err, stdout, stderr) => {  if (err) {
  console.log(err);
  }  if (stdout) {
  console.log(stdout);
  }  if (stderr) {
  console.log(stderr);
  }
 }
)