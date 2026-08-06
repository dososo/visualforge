# VisualForge minimal install guide

## Three-step install

### 1. Download one package for your system

Open [VisualForge Releases](https://github.com/dososo/visualforge/releases/latest):

- macOS: `VisualForge-0.5.8-macos-universal.dmg`
- Windows 10／11 x64: `VisualForge-0.5.8-windows-x64.zip`
- Linux x64: `VisualForge-0.5.8-linux-x64.tar.gz`

Install and sign in to Codex first. VisualForge uses your current Codex session and does not require an API key.

### 2. Install the connector and Chrome extension

**macOS**

1. Open the DMG, then double-click `Install.command`.
2. Extract `VisualForge-extension.zip` from the DMG into a folder you will not move.

**Windows**

1. Extract the download, right-click `Install.ps1`, and choose “Run with PowerShell.”
2. Extract `VisualForge-extension.zip` into a folder you will not move.

**Linux**

1. Extract the download and run `./install.sh` in its folder.
2. Extract `VisualForge-extension.zip` into a folder you will not move.

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable “Developer mode.”
3. Click “Load unpacked” and choose the extracted extension folder.

### 3. Check the connection

Open VisualForge from the Chrome toolbar. In Settings, click “Check connection again.” You are ready when the header says “Codex connected.”

## First creation

1. Upload or paste a reference, or click VisualForge on an image on a regular HTTPS page.
2. Review what VisualForge understands about the visual.
3. Use “Replace with mine” to add a person or product when needed. Replacement is optional.
4. Create one image, a set, or a grid; inspect each result and choose your final version.

## Update

Download the new version and run its installer again. In `chrome://extensions`, remove the old extension and load the new extracted folder. Updating the connector does not delete browser projects.

## Uninstall

- Connector only: VisualForge Settings → “Uninstall local connector.” Projects and subject assets remain.
- Extension: open `chrome://extensions`, find VisualForge, and click “Remove.”
- Everything: clear all local data in VisualForge Settings first, then perform both steps above.

See the [support page](https://dososo.github.io/visualforge/support.html) if you get stuck.
