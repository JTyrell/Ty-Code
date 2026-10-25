const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Disable hardware acceleration and GPU for headless CI/CD execution
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST_CAMPAIGN = path.join(ROOT, 'dist', 'campaign');

const TARGETS = [
  'README',
  'ENTERPRISE-WHITEPAPER',
  'INVESTOR-PITCH-DECK',
  'MARKETING-LANDING-PAGE-COPY',
];

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      webPreferences: {
        offscreen: true,
      },
    });

    for (const id of TARGETS) {
      const htmlPath = path.join(DIST_CAMPAIGN, `${id}.html`);
      const pdfPath = path.join(DIST_CAMPAIGN, `${id}.pdf`);

      if (!fs.existsSync(htmlPath)) {
        throw new Error(`Required HTML source missing: ${htmlPath}`);
      }

      await win.loadFile(htmlPath);

      // Allow DOM and font layout to settle
      await new Promise((resolve) => setTimeout(resolve, 300));

      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: {
          marginType: 'default',
        },
      });

      fs.writeFileSync(pdfPath, pdfBuffer);
      console.log(`[build-pdf]   ✓ Generated ${id}.pdf (${pdfBuffer.length.toLocaleString()} bytes)`);
    }

    console.log('[build-pdf] All campaign PDF deliverables generated successfully.\n');
    app.exit(0);
  } catch (err) {
    console.error('[build-pdf] FATAL ERROR during Electron PDF generation:', err);
    app.exit(1);
  }
});
