import http from "node:http";
import { execa } from "execa";
import type { CropConfig } from "@streamclipper/shared";
import { DEFAULT_CROP_CONFIG } from "@streamclipper/shared";

export interface PreviewCropResult {
  config: CropConfig;
}

/**
 * Launch an interactive browser crop window.
 * Shows the live frame, draggable content & webcam boxes,
 * unzoomed 9:16 fit preview, webcam preview, and a confirm button.
 */
export async function launchPreviewWindow(opts: {
  frameBase64: string;
  sourceWidth: number;
  sourceHeight: number;
  initialConfig?: CropConfig;
  port?: number;
}): Promise<CropConfig> {
  const port = opts.port ?? 4444;
  const initialConfig = opts.initialConfig ?? DEFAULT_CROP_CONFIG;

  return new Promise((resolve) => {
    let resolved = false;

    const server = http.createServer((req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      if (req.method === "POST" && req.url === "/api/confirm") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const data = JSON.parse(body) as CropConfig;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));

            if (!resolved) {
              resolved = true;
              setTimeout(() => {
                server.close();
                resolve(data);
              }, 400);
            }
          } catch (err) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
        });
        return;
      }

      // Serve the interactive HTML editor
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getEditorHtml(opts.frameBase64, opts.sourceWidth, opts.sourceHeight, initialConfig));
    });

    server.listen(port, async () => {
      const url = `http://localhost:${port}`;
      try {
        if (process.platform === "win32") {
          await execa("cmd", ["/c", "start", url]);
        } else if (process.platform === "darwin") {
          await execa("open", [url]);
        } else {
          await execa("xdg-open", [url]);
        }
      } catch {
        // Browser opening is best-effort
      }
    });
  });
}

function getEditorHtml(
  frameBase64: string,
  srcW: number,
  srcH: number,
  initialConfig: CropConfig
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>StreamClipper // Studio</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: #09090b;
      color: #f4f4f5;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      height: 100vh;
      overflow: hidden;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #27272a;
      padding-bottom: 8px;
      flex-shrink: 0;
    }
    .header-left { display: flex; align-items: baseline; gap: 12px; }
    h1 { font-size: 13px; font-weight: 700; color: #22d3ee; letter-spacing: 0.05em; }
    .header-sub { font-size: 11px; color: #71717a; }
    .badge {
      font-size: 10px;
      padding: 3px 8px;
      border-radius: 4px;
      background: #18181b;
      border: 1px solid #3f3f46;
      color: #a1a1aa;
    }
    .layout {
      display: flex;
      gap: 14px;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .editor-pane {
      flex: 1;
      min-width: 0;
      background: #121215;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: hidden;
    }
    .legend-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #a1a1aa;
      flex-shrink: 0;
    }
    .legend-group { display: flex; gap: 14px; align-items: center; }
    .legend-item { display: flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 2px; }
    .dot.cyan { background: #22d3ee; }
    .dot.yellow { background: #f59e0b; }

    .video-mode-selector {
      display: flex;
      align-items: center;
      gap: 4px;
      background: #18181b;
      border: 1px solid #3f3f46;
      border-radius: 4px;
      padding: 2px;
    }
    .btn-vmode {
      font-size: 10px;
      padding: 2px 8px;
      background: transparent;
      border: none;
      color: #a1a1aa;
      cursor: pointer;
      font-family: inherit;
      font-weight: 600;
      border-radius: 3px;
    }
    .btn-vmode.active {
      background: #22d3ee;
      color: #000;
      font-weight: 700;
    }

    .canvas-wrapper {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      border: 1px solid #27272a;
      border-radius: 6px;
      overflow: hidden;
      position: relative;
    }
    .canvas-container {
      position: relative;
      display: inline-block;
      max-width: 100%;
      max-height: 100%;
    }
    #frame-img {
      display: block;
      max-width: 100%;
      max-height: calc(100vh - 150px);
      width: auto;
      height: auto;
      pointer-events: none;
    }
    .crop-box {
      position: absolute;
      cursor: move;
      box-sizing: border-box;
      z-index: 10;
    }
    #content-box {
      border: 2px dashed #22d3ee;
      background: rgba(34, 211, 238, 0.08);
      box-shadow: 0 0 10px rgba(34, 211, 238, 0.15);
      pointer-events: none; /* disabled by default in Full Stream mode */
    }
    #content-box:not(.interactive) .handle {
      display: none;
    }
    #content-box.interactive {
      pointer-events: auto;
      border-style: solid;
      background: rgba(34, 211, 238, 0.14);
    }
    #webcam-box {
      border: 2px solid #f59e0b;
      background: rgba(245, 158, 11, 0.18);
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.25);
      z-index: 20;
    }
    .box-label {
      position: absolute;
      top: -19px;
      left: 0;
      font-size: 9px;
      font-weight: 700;
      padding: 1px 5px;
      border-radius: 3px 3px 0 0;
      white-space: nowrap;
      pointer-events: none;
    }
    #content-box .box-label { background: #22d3ee; color: #000; }
    #webcam-box .box-label { background: #f59e0b; color: #000; }

    .handle {
      position: absolute;
      width: 12px;
      height: 12px;
      background: #ffffff;
      border: 2px solid #000;
      border-radius: 2px;
      z-index: 30;
    }
    .handle.tl { top: -6px; left: -6px; cursor: nwse-resize; }
    .handle.tr { top: -6px; right: -6px; cursor: nesw-resize; }
    .handle.bl { bottom: -6px; left: -6px; cursor: nesw-resize; }
    .handle.br { bottom: -6px; right: -6px; cursor: nwse-resize; }

    /* Right Preview Sidebar */
    .preview-pane {
      width: 290px;
      min-width: 290px;
      background: #121215;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      overflow-y: auto;
      flex-shrink: 0;
    }
    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid #27272a;
      padding-bottom: 6px;
    }
    .preview-title { font-size: 11px; font-weight: 700; color: #e4e4e7; }
    .preview-sub { font-size: 10px; color: #10b981; font-weight: 600; }

    .preview-card {
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 6px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: center;
    }
    .card-top {
      width: 100%;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 10px;
      font-weight: 700;
    }
    .card-label.cyan { color: #22d3ee; }
    .card-label.yellow { color: #f59e0b; }

    /* 9:16 Social Mockup */
    .phone-mockup {
      width: 120px;
      height: 213px; /* 9:16 aspect */
      background: #000;
      border: 2px solid #22d3ee;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 14px rgba(34, 211, 238, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #preview-content-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    /* Webcam Mockup */
    .webcam-mockup {
      width: 180px;
      height: 100px;
      background: #000;
      border: 2px solid #f59e0b;
      border-radius: 6px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(245, 158, 11, 0.2);
    }
    #preview-webcam-canvas {
      max-width: 100%;
      max-height: 100%;
      display: block;
    }

    .card-footer {
      font-size: 9px;
      color: #71717a;
      text-align: center;
    }

    .btn-confirm {
      width: 100%;
      padding: 10px;
      background: #10b981;
      border: none;
      color: #000;
      font-weight: 800;
      font-size: 11px;
      font-family: inherit;
      cursor: pointer;
      border-radius: 6px;
      transition: all 0.15s;
      letter-spacing: 0.05em;
      margin-top: auto;
    }
    .btn-confirm:hover { background: #34d399; transform: translateY(-1px); }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <h1>STREAMCLIPPER // STUDIO</h1>
      <span class="header-sub">Full Video (No Zoom) + Isolated Webcam. Drag yellow box to position webcam.</span>
    </div>
    <div class="badge" id="source-badge">Source: ${srcW}x${srcH}</div>
  </header>

  <div class="layout">
    <div class="editor-pane">
      <div class="legend-bar">
        <div class="legend-group">
          <div class="legend-item">
            <span class="dot cyan"></span>
            <span style="color:#22d3ee; font-weight:600;">1. VIDEO:</span>
            <div class="video-mode-selector">
              <button class="btn-vmode active" id="btn-full-video" title="Full stream, unzoomed, 100% of video preserved">FULL STREAM (NO ZOOM)</button>
              <button class="btn-vmode" id="btn-crop-video" title="Custom crop area">CUSTOM CROP</button>
            </div>
          </div>
          <div class="legend-item">
            <span class="dot yellow"></span>
            <span style="color:#f59e0b; font-weight:600;">2. WEBCAM</span>
            <span style="color:#71717a;">(Drag over face cam)</span>
          </div>
        </div>
        <div style="font-size: 10px; color:#71717a;">
          Drag yellow box over webcam
        </div>
      </div>

      <div class="canvas-wrapper">
        <div class="canvas-container" id="container">
          <img id="frame-img" src="data:image/jpeg;base64,${frameBase64}" alt="Live stream frame">
          
          <!-- Content Box -->
          <div class="crop-box" id="content-box">
            <div class="box-label" id="content-label">FULL STREAM (NO ZOOM)</div>
            <div class="handle tl" data-corner="tl"></div>
            <div class="handle tr" data-corner="tr"></div>
            <div class="handle bl" data-corner="bl"></div>
            <div class="handle br" data-corner="br"></div>
          </div>

          <!-- Webcam Box -->
          <div class="crop-box" id="webcam-box">
            <div class="box-label">WEBCAM (DRAG ME)</div>
            <div class="handle tl" data-corner="tl"></div>
            <div class="handle tr" data-corner="tr"></div>
            <div class="handle bl" data-corner="bl"></div>
            <div class="handle br" data-corner="br"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right Side: Dual Previews -->
    <div class="preview-pane">
      <div class="preview-header">
        <span class="preview-title">OUTPUT PREVIEWS</span>
        <span class="preview-sub">2 CLIPS READY</span>
      </div>

      <!-- Preview 1: 9:16 Video -->
      <div class="preview-card">
        <div class="card-top">
          <div class="card-label cyan">
            <span class="dot cyan"></span>
            <span>CLIP 1: 9:16 VIDEO</span>
          </div>
        </div>
        <div class="phone-mockup">
          <canvas id="preview-content-canvas"></canvas>
        </div>
        <div class="card-footer" id="content-footer-text">1080x1920 • Full Stream (No Zoom)</div>
      </div>

      <!-- Preview 2: Free-size Webcam Video -->
      <div class="preview-card">
        <div class="card-top">
          <div class="card-label yellow">
            <span class="dot yellow"></span>
            <span>CLIP 2: WEBCAM CLIP</span>
          </div>
        </div>
        <div class="webcam-mockup">
          <canvas id="preview-webcam-canvas"></canvas>
        </div>
        <div class="card-footer" id="webcam-info">Webcam Cut</div>
      </div>

      <button class="btn-confirm" id="btn-confirm">
        ✓ CONFIRM & START CLIPPING
      </button>
      <div style="font-size: 9px; color: #71717a; text-align: center;">
        Exports unzoomed 9:16 video + webcam clip to ./clips
      </div>
    </div>
  </div>

  <script>
    const img = document.getElementById("frame-img");
    const container = document.getElementById("container");
    const contentBox = document.getElementById("content-box");
    const webcamBox = document.getElementById("webcam-box");
    const contentLabel = document.getElementById("content-label");
    const btnConfirm = document.getElementById("btn-confirm");
    const webcamInfo = document.getElementById("webcam-info");
    const contentFooterText = document.getElementById("content-footer-text");
    const sourceBadge = document.getElementById("source-badge");

    const btnFullVideo = document.getElementById("btn-full-video");
    const btnCropVideo = document.getElementById("btn-crop-video");

    const prevContentCanvas = document.getElementById("preview-content-canvas");
    const prevWebcamCanvas = document.getElementById("preview-webcam-canvas");
    const prevContentCtx = prevContentCanvas.getContext("2d");
    const prevWebcamCtx = prevWebcamCanvas.getContext("2d");

    let isCustomCrop = false;

    let config = {
      content: { x: 0.0, y: 0.0, w: 1.0, h: 1.0 },
      webcam: { x: 0.72, y: 0.05, w: 0.25, h: 0.28 },
      webcamLockRatio: false,
      contentMode: "fit",
      contentHeight: 1344,
      webcamHeight: 576,
    };

    function getScale() {
      const rect = img.getBoundingClientRect();
      const nw = img.naturalWidth || 1920;
      const nh = img.naturalHeight || 1080;
      return {
        nw,
        nh,
        dispW: rect.width,
        dispH: rect.height,
        scaleX: rect.width / nw,
        scaleY: rect.height / nh,
      };
    }

    function renderBoxes() {
      const { dispW, dispH } = getScale();
      if (!dispW || !dispH) return;

      // Content box (Cyan)
      if (!isCustomCrop) {
        config.content = { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
        contentBox.classList.remove("interactive");
        contentLabel.textContent = "FULL STREAM (NO ZOOM)";
      } else {
        contentBox.classList.add("interactive");
        contentLabel.textContent = "CUSTOM CROP";
      }

      contentBox.style.left = (config.content.x * dispW) + "px";
      contentBox.style.top = (config.content.y * dispH) + "px";
      contentBox.style.width = (config.content.w * dispW) + "px";
      contentBox.style.height = (config.content.h * dispH) + "px";

      // Webcam box (Yellow)
      webcamBox.style.left = (config.webcam.x * dispW) + "px";
      webcamBox.style.top = (config.webcam.y * dispH) + "px";
      webcamBox.style.width = (config.webcam.w * dispW) + "px";
      webcamBox.style.height = (config.webcam.h * dispH) + "px";
    }

    function updatePreview() {
      const { nw, nh } = getScale();
      if (!nw || !nh) return;

      // ── CLIP 1: 9:16 Video Rendering (Exact Match with FFmpeg Output) ──
      prevContentCanvas.width = 1080;
      prevContentCanvas.height = 1920;

      // Dark background fill
      prevContentCtx.fillStyle = "#09090b";
      prevContentCtx.fillRect(0, 0, 1080, 1920);

      const sx = Math.max(0, config.content.x * nw);
      const sy = Math.max(0, config.content.y * nh);
      const sw = Math.min(nw - sx, config.content.w * nw);
      const sh = Math.min(nh - sy, config.content.h * nh);

      if (sw > 0 && sh > 0) {
        // Unzoomed Fit Mode: preserve aspect ratio, fit inside 1080x1920
        const cropRatio = sw / sh;
        const targetRatio = 1080 / 1920; // 9:16 = 0.5625

        let dw, dh, dx, dy;
        if (cropRatio > targetRatio) {
          // Standard 16:9 gameplay: fit width 1080, calculate proportional height
          dw = 1080;
          dh = 1080 / cropRatio;
          dx = 0;
          dy = (1920 - dh) / 2;
        } else {
          dh = 1920;
          dw = 1920 * cropRatio;
          dx = (1080 - dw) / 2;
          dy = 0;
        }

        // Crisp unzoomed video centered
        prevContentCtx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        contentFooterText.textContent = isCustomCrop
          ? "1080x1920 • Custom Fit (No Zoom)"
          : "1080x1920 • Full Stream (No Zoom)";
      }

      // ── CLIP 2: Free-size Webcam Rendering ──
      const wx = Math.max(0, config.webcam.x * nw);
      const wy = Math.max(0, config.webcam.y * nh);
      const ww = Math.min(nw - wx, Math.max(10, config.webcam.w * nw));
      const wh = Math.min(nh - wy, Math.max(10, config.webcam.h * nh));

      if (ww > 0 && wh > 0) {
        prevWebcamCanvas.width = ww;
        prevWebcamCanvas.height = wh;
        prevWebcamCtx.drawImage(img, wx, wy, ww, wh, 0, 0, ww, wh);
        webcamInfo.textContent = Math.round(ww) + "x" + Math.round(wh) + " px (Webcam)";
      }
    }

    // Toggle Mode
    btnFullVideo.onclick = () => {
      isCustomCrop = false;
      btnFullVideo.classList.add("active");
      btnCropVideo.classList.remove("active");
      config.content = { x: 0.0, y: 0.0, w: 1.0, h: 1.0 };
      config.contentMode = "fit";
      renderBoxes();
      updatePreview();
    };

    btnCropVideo.onclick = () => {
      isCustomCrop = true;
      btnCropVideo.classList.add("active");
      btnFullVideo.classList.remove("active");
      config.content = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      config.contentMode = "fit";
      renderBoxes();
      updatePreview();
    };

    // Smooth Drag & 4-Corner Resizing for boxes
    function makeInteractive(boxEl, boxKey) {
      let isDragging = false;
      let isResizing = false;
      let currentCorner = null;
      let startX = 0, startY = 0;
      let orig = null;

      boxEl.addEventListener("mousedown", (e) => {
        if (boxKey === "content" && !isCustomCrop) return; // Full stream is locked

        const handle = e.target.closest(".handle");
        if (handle) {
          isResizing = true;
          currentCorner = handle.dataset.corner;
        } else {
          isDragging = true;
        }
        startX = e.clientX;
        startY = e.clientY;
        orig = { ...config[boxKey] };
        e.preventDefault();
        e.stopPropagation();
      });

      window.addEventListener("mousemove", (e) => {
        if (!isDragging && !isResizing) return;
        const { dispW, dispH } = getScale();
        if (!dispW || !dispH) return;

        const dx = (e.clientX - startX) / dispW;
        const dy = (e.clientY - startY) / dispH;

        if (isDragging) {
          let newX = Math.max(0, Math.min(1 - orig.w, orig.x + dx));
          let newY = Math.max(0, Math.min(1 - orig.h, orig.y + dy));
          config[boxKey].x = newX;
          config[boxKey].y = newY;
        } else if (isResizing) {
          let newX = orig.x;
          let newY = orig.y;
          let newW = orig.w;
          let newH = orig.h;

          if (currentCorner === "br") {
            newW = Math.max(0.04, Math.min(1 - orig.x, orig.w + dx));
            newH = Math.max(0.04, Math.min(1 - orig.y, orig.h + dy));
          } else if (currentCorner === "bl") {
            const maxL = orig.x + orig.w - 0.04;
            newX = Math.max(0, Math.min(maxL, orig.x + dx));
            newW = orig.w - (newX - orig.x);
            newH = Math.max(0.04, Math.min(1 - orig.y, orig.h + dy));
          } else if (currentCorner === "tr") {
            const maxT = orig.y + orig.h - 0.04;
            newY = Math.max(0, Math.min(maxT, orig.y + dy));
            newH = orig.h - (newY - orig.y);
            newW = Math.max(0.04, Math.min(1 - orig.x, orig.w + dx));
          } else if (currentCorner === "tl") {
            const maxL = orig.x + orig.w - 0.04;
            const maxT = orig.y + orig.h - 0.04;
            newX = Math.max(0, Math.min(maxL, orig.x + dx));
            newY = Math.max(0, Math.min(maxT, orig.y + dy));
            newW = orig.w - (newX - orig.x);
            newH = orig.h - (newY - orig.y);
          }

          config[boxKey].x = newX;
          config[boxKey].y = newY;
          config[boxKey].w = newW;
          config[boxKey].h = newH;
        }

        renderBoxes();
        updatePreview();
      });

      window.addEventListener("mouseup", () => {
        isDragging = false;
        isResizing = false;
      });
    }

    makeInteractive(contentBox, "content");
    makeInteractive(webcamBox, "webcam");

    function init() {
      if (img.naturalWidth && img.naturalHeight) {
        sourceBadge.textContent = "Source: " + img.naturalWidth + "x" + img.naturalHeight;
      }
      renderBoxes();
      updatePreview();
    }

    img.onload = () => init();
    window.addEventListener("resize", () => init());
    setTimeout(init, 50);

    btnConfirm.onclick = async () => {
      btnConfirm.innerText = "✓ CONFIRMED! CLIPPING NOW...";
      btnConfirm.style.background = "#059669";
      btnConfirm.disabled = true;

      config.contentMode = "fit";

      await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      setTimeout(() => {
        window.close();
      }, 500);
    };
  </script>
</body>
</html>`;
}
