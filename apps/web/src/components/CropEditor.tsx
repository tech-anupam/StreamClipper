import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Stage, Layer, Rect, Image as KonvaImage, Transformer } from "react-konva";
import type Konva from "konva";
import {
  type NormalizedRect,
  type CropConfig,
  DEFAULT_CROP_CONFIG,
  normalizedToPixel,
} from "@streamclipper/shared";
import { cn } from "../lib/utils.ts";

interface CropEditorProps {
  frameBase64: string | null;
  frameWidth: number;
  frameHeight: number;
  initialConfig?: CropConfig;
  onConfigChange: (config: CropConfig) => void;
}

export function CropEditor({
  frameBase64,
  frameWidth,
  frameHeight,
  initialConfig,
  onConfigChange,
}: CropEditorProps) {
  const [config, setConfig] = useState<CropConfig>(
    initialConfig ?? DEFAULT_CROP_CONFIG
  );
  const [selectedBox, setSelectedBox] = useState<"content" | "webcam" | null>(
    null
  );
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const contentRef = useRef<Konva.Rect>(null);
  const webcamRef = useRef<Konva.Rect>(null);
  const contentTrRef = useRef<Konva.Transformer>(null);
  const webcamTrRef = useRef<Konva.Transformer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 640, height: 360 });

  // Load frame image
  useEffect(() => {
    if (!frameBase64) return;
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = `data:image/jpeg;base64,${frameBase64}`;
  }, [frameBase64]);

  // Calculate canvas size based on container
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const containerWidth = containerRef.current.clientWidth;
      const maxWidth = Math.min(containerWidth, 800);
      const scale = maxWidth / frameWidth;
      setCanvasSize({
        width: Math.round(frameWidth * scale),
        height: Math.round(frameHeight * scale),
      });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [frameWidth, frameHeight]);

  const scale = canvasSize.width / frameWidth;

  // Attach transformers
  useEffect(() => {
    if (selectedBox === "content" && contentRef.current && contentTrRef.current) {
      contentTrRef.current.nodes([contentRef.current]);
      contentTrRef.current.getLayer()?.batchDraw();
    }
    if (selectedBox === "webcam" && webcamRef.current && webcamTrRef.current) {
      webcamTrRef.current.nodes([webcamRef.current]);
      webcamTrRef.current.getLayer()?.batchDraw();
    }
  }, [selectedBox]);

  const normalizedToCanvas = (rect: NormalizedRect) => ({
    x: rect.x * canvasSize.width,
    y: rect.y * canvasSize.height,
    width: rect.w * canvasSize.width,
    height: rect.h * canvasSize.height,
  });

  const canvasToNormalized = (
    x: number,
    y: number,
    width: number,
    height: number
  ): NormalizedRect => ({
    x: Math.max(0, Math.min(1, x / canvasSize.width)),
    y: Math.max(0, Math.min(1, y / canvasSize.height)),
    w: Math.max(0.01, Math.min(1, width / canvasSize.width)),
    h: Math.max(0.01, Math.min(1, height / canvasSize.height)),
  });

  const handleDragEnd = (
    box: "content" | "webcam",
    e: Konva.KonvaEventObject<DragEvent>
  ) => {
    const node = e.target;
    const norm = canvasToNormalized(
      node.x(),
      node.y(),
      node.width(),
      node.height()
    );
    const newConfig = { ...config, [box]: norm };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  const handleTransformEnd = (
    box: "content" | "webcam",
    e: Konva.KonvaEventObject<Event>
  ) => {
    const node = e.target as Konva.Rect;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Reset scale and apply to width/height
    node.scaleX(1);
    node.scaleY(1);

    const norm = canvasToNormalized(
      node.x(),
      node.y(),
      node.width() * scaleX,
      node.height() * scaleY
    );

    node.width(norm.w * canvasSize.width);
    node.height(norm.h * canvasSize.height);

    const newConfig = { ...config, [box]: norm };
    setConfig(newConfig);
    onConfigChange(newConfig);
  };

  const contentCanvas = normalizedToCanvas(config.content);
  const webcamCanvas = normalizedToCanvas(config.webcam);

  // Preview: compute pixel crops and render stacked preview
  const contentPx = normalizedToPixel(config.content, frameWidth, frameHeight);
  const webcamPx = normalizedToPixel(config.webcam, frameWidth, frameHeight);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Canvas editor */}
      <div className="flex-1" ref={containerRef}>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-mono text-text-secondary tracking-wider">
            CROP EDITOR
          </span>
          <span className="text-[10px] font-mono text-text-muted">
            {frameWidth}x{frameHeight}
          </span>
        </div>
        <div
          className="border border-border bg-surface-1 inline-block"
          onClick={() => setSelectedBox(null)}
        >
          <Stage width={canvasSize.width} height={canvasSize.height}>
            <Layer>
              {/* Background frame */}
              {image && (
                <KonvaImage
                  image={image}
                  width={canvasSize.width}
                  height={canvasSize.height}
                />
              )}

              {/* Dim overlay */}
              <Rect
                x={0}
                y={0}
                width={canvasSize.width}
                height={canvasSize.height}
                fill="rgba(0,0,0,0.4)"
                listening={false}
              />

              {/* Content crop box */}
              <Rect
                ref={contentRef}
                x={contentCanvas.x}
                y={contentCanvas.y}
                width={contentCanvas.width}
                height={contentCanvas.height}
                stroke="#22d3ee"
                strokeWidth={2}
                dash={[6, 3]}
                draggable
                onClick={(e) => {
                  e.cancelBubble = true;
                  setSelectedBox("content");
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  setSelectedBox("content");
                }}
                onDragEnd={(e) => handleDragEnd("content", e)}
                onTransformEnd={(e) => handleTransformEnd("content", e)}
                dragBoundFunc={(pos) => ({
                  x: Math.max(0, Math.min(canvasSize.width - contentCanvas.width, pos.x)),
                  y: Math.max(0, Math.min(canvasSize.height - contentCanvas.height, pos.y)),
                })}
              />

              {/* Webcam crop box */}
              <Rect
                ref={webcamRef}
                x={webcamCanvas.x}
                y={webcamCanvas.y}
                width={webcamCanvas.width}
                height={webcamCanvas.height}
                stroke="#f59e0b"
                strokeWidth={2}
                dash={[4, 4]}
                draggable
                onClick={(e) => {
                  e.cancelBubble = true;
                  setSelectedBox("webcam");
                }}
                onTap={(e) => {
                  e.cancelBubble = true;
                  setSelectedBox("webcam");
                }}
                onDragEnd={(e) => handleDragEnd("webcam", e)}
                onTransformEnd={(e) => handleTransformEnd("webcam", e)}
                dragBoundFunc={(pos) => ({
                  x: Math.max(0, Math.min(canvasSize.width - webcamCanvas.width, pos.x)),
                  y: Math.max(0, Math.min(canvasSize.height - webcamCanvas.height, pos.y)),
                })}
              />

              {/* Transformers */}
              {selectedBox === "content" && (
                <Transformer
                  ref={contentTrRef}
                  keepRatio={true}
                  boundBoxFunc={(_, newBox) => ({
                    ...newBox,
                    width: Math.max(20, newBox.width),
                    height: Math.max(20, newBox.height),
                  })}
                />
              )}
              {selectedBox === "webcam" && (
                <Transformer
                  ref={webcamTrRef}
                  keepRatio={config.webcamLockRatio}
                  boundBoxFunc={(_, newBox) => ({
                    ...newBox,
                    width: Math.max(20, newBox.width),
                    height: Math.max(20, newBox.height),
                  })}
                />
              )}
            </Layer>
          </Stage>
        </div>

        {/* Controls */}
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-xs font-mono text-text-secondary">
            <input
              type="checkbox"
              checked={config.webcamLockRatio}
              onChange={(e) => {
                const newConfig = {
                  ...config,
                  webcamLockRatio: e.target.checked,
                };
                setConfig(newConfig);
                onConfigChange(newConfig);
              }}
              className="accent-accent"
            />
            LOCK WEBCAM RATIO
          </label>
          <div className="flex items-center gap-2 text-xs font-mono text-text-secondary">
            <span>CONTENT H:</span>
            <input
              type="number"
              value={config.contentHeight}
              onChange={(e) => {
                const v = parseInt(e.target.value) || 1344;
                const newConfig = { ...config, contentHeight: v };
                setConfig(newConfig);
                onConfigChange(newConfig);
              }}
              className="w-16 bg-surface-1 border border-border px-2 py-1 text-xs font-mono text-text-primary"
            />
          </div>
          <div className="flex items-center gap-2 text-xs font-mono text-text-secondary">
            <span>WEBCAM H:</span>
            <input
              type="number"
              value={config.webcamHeight}
              onChange={(e) => {
                const v = parseInt(e.target.value) || 576;
                const newConfig = { ...config, webcamHeight: v };
                setConfig(newConfig);
                onConfigChange(newConfig);
              }}
              className="w-16 bg-surface-1 border border-border px-2 py-1 text-xs font-mono text-text-primary"
            />
          </div>
        </div>

        {/* Legend */}
        <div className="mt-2 flex gap-4">
          <span className="text-[10px] font-mono flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-cyan-400 inline-block"></span>
            CONTENT (9:16 locked)
          </span>
          <span className="text-[10px] font-mono flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-amber-400 inline-block"></span>
            WEBCAM
          </span>
        </div>
      </div>

      {/* Preview panel */}
      <div className="w-full lg:w-48 shrink-0">
        <span className="text-xs font-mono text-text-secondary tracking-wider mb-2 block">
          OUTPUT PREVIEW
        </span>
        <div
          className="bg-surface-1 border border-border overflow-hidden"
          style={{ width: "100%", maxWidth: 192, aspectRatio: "9/16" }}
        >
          {image && (
            <div className="w-full h-full flex flex-col">
              {/* Content portion */}
              <div
                className="overflow-hidden bg-black"
                style={{
                  height: `${(config.contentHeight / (config.contentHeight + config.webcamHeight)) * 100}%`,
                }}
              >
                <canvas
                  ref={(canvas) => {
                    if (!canvas || !image) return;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) return;
                    canvas.width = 1080;
                    canvas.height = config.contentHeight;
                    ctx.drawImage(
                      image,
                      contentPx.x,
                      contentPx.y,
                      contentPx.w,
                      contentPx.h,
                      0,
                      0,
                      1080,
                      config.contentHeight
                    );
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "fill" }}
                />
              </div>
              {/* Webcam portion */}
              <div
                className="overflow-hidden bg-black"
                style={{
                  height: `${(config.webcamHeight / (config.contentHeight + config.webcamHeight)) * 100}%`,
                }}
              >
                <canvas
                  ref={(canvas) => {
                    if (!canvas || !image) return;
                    const ctx = canvas.getContext("2d");
                    if (!ctx) return;
                    canvas.width = 1080;
                    canvas.height = config.webcamHeight;
                    ctx.drawImage(
                      image,
                      webcamPx.x,
                      webcamPx.y,
                      webcamPx.w,
                      webcamPx.h,
                      0,
                      0,
                      1080,
                      config.webcamHeight
                    );
                  }}
                  style={{ width: "100%", height: "100%", objectFit: "fill" }}
                />
              </div>
            </div>
          )}
        </div>
        <p className="text-[10px] font-mono text-text-muted mt-1">
          1080 x {config.contentHeight + config.webcamHeight}
        </p>
      </div>
    </div>
  );
}
