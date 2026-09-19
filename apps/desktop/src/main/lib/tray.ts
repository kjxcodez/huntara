import { Tray, Menu, nativeImage, app, BrowserWindow } from 'electron';
import { join } from 'path';
import fs from 'fs';

let tray: Tray | null = null;

/**
 * Initializes the system tray icon and context menu for HUNTARA.
 *
 * - macOS: Uses template-style monochrome asset (HUNTARA-Template.png) for Dark/Light menu bar support.
 * - Windows/Linux: Uses HUNTARA orange tray icon (HUNTARA-tray-orange-16.png).
 * - Context menu and single-click to restore/focus mainWindow.
 */
export function setupTray(getMainWindow: () => BrowserWindow | null): Tray | null {
  if (tray) return tray;

  try {
    let iconPath = '';
    const isMac = process.platform === 'darwin';

    if (isMac) {
      iconPath = join(__dirname, '../../resources/tray/HUNTARA-Template.png');
    } else {
      iconPath = join(__dirname, '../../resources/tray/HUNTARA-tray-orange-16.png');
    }

    if (!fs.existsSync(iconPath)) {
      iconPath = join(__dirname, '../../resources/icon.png');
    }

    if (!fs.existsSync(iconPath)) {
      return null;
    }

    const image = nativeImage.createFromPath(iconPath);
    if (isMac) {
      image.setTemplateImage(true);
    }

    tray = new Tray(image);
    tray.setToolTip('HUNTARA — Find the companies worth selling to.');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open HUNTARA',
        click: () => {
          const win = getMainWindow();
          if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit HUNTARA',
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
      const win = getMainWindow();
      if (win) {
        if (win.isVisible() && !win.isMinimized() && win.isFocused()) {
          // Keep focused
        } else {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
      }
    });

    return tray;
  } catch (err) {
    console.error('Failed to initialize HUNTARA system tray:', err);
    return null;
  }
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
