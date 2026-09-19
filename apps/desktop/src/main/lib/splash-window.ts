import { BrowserWindow, app } from 'electron';
import { join } from 'path';
import fs from 'fs';

let splashWindow: BrowserWindow | null = null;

/**
 * Creates a lightweight, native, React-independent splash window to show immediately during app launch.
 */
export function createSplashWindow(): void {
  let iconBase64 = '';
  try {
    const iconPath = join(__dirname, '../../resources/icon.png');
    if (fs.existsSync(iconPath)) {
      iconBase64 = fs.readFileSync(iconPath).toString('base64');
    }
  } catch (err) {
    // fallback
  }

  // Obtain version from package.json or app version
  const appVersion = app.getVersion() || '1.0.0';

  splashWindow = new BrowserWindow({
    width: 440,
    height: 360,
    frame: false,
    transparent: true,
    show: true,
    center: true,
    resizable: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#05070a'
  });

  const splashHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body {
            margin: 0;
            padding: 0;
            background-color: #05070a;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            overflow: hidden;
            -webkit-app-region: drag;
            position: relative;
          }
          /* Ambient glow elements */
          .glow-1 {
            position: absolute;
            top: -30%;
            left: -20%;
            width: 75%;
            height: 75%;
            background: rgba(250, 113, 37, 0.18); /* HUNTARA Orange */
            filter: blur(90px);
            pointer-events: none;
          }
          .glow-2 {
            position: absolute;
            bottom: -20%;
            right: -20%;
            width: 65%;
            height: 65%;
            background: rgba(0, 191, 255, 0.08); /* Info Cyan */
            filter: blur(80px);
            pointer-events: none;
          }
          .card {
            width: 360px;
            background: rgba(10, 12, 16, 0.85);
            border: 1px solid rgba(255, 255, 255, 0.08);
            padding: 36px;
            display: flex;
            flex-direction: column;
            align-items: center;
            text-align: center;
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.6);
            position: relative;
          }
          /* corner dot grids */
          .dots {
            position: absolute;
            width: 36px;
            height: 36px;
            opacity: 0.2;
          }
          .dots-tl {
            top: 14px;
            left: 14px;
          }
          .dots-br {
            bottom: 14px;
            right: 14px;
          }
          .logo-frame {
            width: 56px;
            height: 56px;
            background: rgba(250, 113, 37, 0.08);
            border: 1px solid rgba(250, 113, 37, 0.25);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
            position: relative;
          }
          .logo-frame img {
            width: 36px;
            height: 36px;
            object-fit: contain;
            position: relative;
            z-index: 2;
          }
          .logo-frame svg {
            width: 28px;
            height: 28px;
            color: #FA7125;
            position: relative;
            z-index: 2;
          }
          .title {
            font-size: 15px;
            font-weight: 800;
            letter-spacing: 0.25em;
            text-transform: uppercase;
            margin: 0;
            color: #ffffff;
          }
          .subtitle {
            font-size: 10px;
            color: #a1a1aa;
            font-weight: 600;
            letter-spacing: 0.06em;
            margin-top: 6px;
          }
          .version {
            font-size: 10px;
            font-family: monospace;
            color: #52525b;
            margin-top: 14px;
          }
          .segments {
            display: flex;
            justify-content: space-between;
            gap: 6px;
            width: 220px;
            margin-top: 24px;
          }
          .status {
            font-size: 9px;
            color: #a1a1aa;
            margin-top: 14px;
            font-family: monospace;
            height: 12px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 260px;
          }
        </style>
      </head>
      <body>
        <div class="glow-1"></div>
        <div class="glow-2"></div>

        <div class="card">
          <!-- top-left dots -->
          <svg class="dots dots-tl" viewBox="0 0 100 100" fill="currentColor" style="color: #FA7125;">
            <circle cx="10" cy="10" r="7"/><circle cx="50" cy="10" r="7"/><circle cx="90" cy="10" r="7"/>
            <circle cx="10" cy="50" r="7"/><circle cx="50" cy="50" r="7"/><circle cx="90" cy="50" r="7"/>
            <circle cx="10" cy="90" r="7"/><circle cx="50" cy="90" r="7"/><circle cx="90" cy="90" r="7"/>
          </svg>
          <!-- bottom-right dots -->
          <svg class="dots dots-br" viewBox="0 0 100 100" fill="currentColor" style="color: #00bfff;">
            <circle cx="10" cy="10" r="7"/><circle cx="50" cy="10" r="7"/><circle cx="90" cy="10" r="7"/>
            <circle cx="10" cy="50" r="7"/><circle cx="50" cy="50" r="7"/><circle cx="90" cy="50" r="7"/>
            <circle cx="10" cy="90" r="7"/><circle cx="50" cy="90" r="7"/><circle cx="90" cy="90" r="7"/>
          </svg>

          <div class="logo-frame">
            ${
              iconBase64
                ? `<img src="data:image/png;base64,${iconBase64}" />`
                : `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/>
            </svg>
            `
            }
          </div>

          <div class="title">HUNTARA</div>
          <div class="subtitle">Find the companies worth selling to.</div>
          <div class="version">v. ${appVersion}</div>

          <div class="segments" id="segments-container"></div>
          <div class="status" id="status-label">Initializing system...</div>
        </div>

        <script>
          const totalSegments = 12;
          const segments = [];
          const container = document.getElementById('segments-container');
          for (let i = 0; i < totalSegments; i++) {
            const div = document.createElement('div');
            div.style.flex = '1';
            div.style.height = '4px';
            div.style.backgroundColor = '#18181b';
            div.style.transition = 'background-color 0.15s ease';
            container.appendChild(div);
            segments.push(div);
          }

          window.updateProgress = (stepId, label) => {
            document.getElementById('status-label').innerText = label;
            let filled = 0;
            if (stepId === 'session') filled = 2;
            else if (stepId === 'database:open') filled = 4;
            else if (stepId === 'database:migrations') filled = 6;
            else if (stepId === 'scheduler:start') filled = 8;
            else if (stepId === 'sync:start') filled = 10;
            else if (stepId === 'automation:start') filled = 11;
            else if (stepId === 'ready') filled = 12;

            for (let i = 0; i < totalSegments; i++) {
              segments[i].style.backgroundColor = i < filled ? '#FA7125' : '#18181b';
            }
          };
        </script>
      </body>
    </html>
  `;

  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

/**
 * Cleanly closes and destroys the native splash window.
 */
export function destroySplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

/**
 * Feeds progress to the native splash window DOM directly.
 */
export function updateSplashProgress(step: string, label: string): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    const escapedLabel = label.replace(/'/g, "\\'");
    splashWindow.webContents
      .executeJavaScript(`if (window.updateProgress) window.updateProgress('${step}', '${escapedLabel}');`)
      .catch(() => {});
  }
}
