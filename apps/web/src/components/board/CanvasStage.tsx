"use client";

import Konva from "konva";
import { useCallback, useEffect, useRef, useState } from "react";
import { Arrow, Ellipse, Group, Layer, Line, Rect, Stage, Text, Transformer } from "react-konva";
import type { BoardElement, TextElement, StickyNoteElement } from "@collabcanvas/shared";
import { clamp } from "@/lib/user-colors";
import type { Camera, ElementDraft, Tool } from "./types";

export interface Pointer {
  x: number;
  y: number;
}

interface CanvasStageProps {
  elements: BoardElement[];
  canEdit: boolean;
  tool: Tool;
  color: string;
  camera: Camera;
  onCameraChange: (camera: Camera) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (element: BoardElement) => void;
  onUpdate: (id: string, patch: Partial<BoardElement>) => void;
  onDelete: (id: string) => void;
  onCursorMove: (point: Pointer | null) => void;
  onEditingChange: (id: string | null) => void;
  editingId: string | null;
  stageRef: React.RefObject<Konva.Stage | null>;
  userId: string;
}

const SCALABLE_TYPES = new Set(["rect", "sticky", "ellipse"]);

function nextZ(elements: BoardElement[]): number {
  return elements.reduce((max, el) => Math.max(max, el.z), 0) + 1;
}

export function CanvasStage(props: CanvasStageProps) {
  const {
    elements,
    canEdit,
    tool,
    color,
    camera,
    onCameraChange,
    selectedId,
    onSelect,
    onCreate,
    onUpdate,
    onDelete,
    onCursorMove,
    onEditingChange,
    editingId,
    stageRef,
    userId,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Node>());
  const drawStart = useRef<Pointer | null>(null);
  const lastCursorEmit = useRef(0);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [draft, setDraft] = useState<BoardElement | null>(null);
  const [editingText, setEditingText] = useState("");

  // Responsive stage sizing.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: container.clientWidth, height: container.clientHeight });
    });
    observer.observe(container);
    setSize({ width: container.clientWidth, height: container.clientHeight });
    return () => observer.disconnect();
  }, []);

  // Attach/detach the transformer to the selected node.
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    const node = selectedId ? nodeRefs.current.get(selectedId) : null;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, elements]);

  const toBoard = useCallback(
    (stage: Konva.Stage): Pointer | null => {
      const pointer = stage.getPointerPosition();
      if (!pointer) return null;
      return {
        x: (pointer.x - camera.x) / camera.scale,
        y: (pointer.y - camera.y) / camera.scale,
      };
    },
    [camera],
  );

  const boardToScreen = useCallback(
    (point: Pointer): Pointer => ({ x: point.x * camera.scale + camera.x, y: point.y * camera.scale + camera.y }),
    [camera],
  );

  const newElement = useCallback(
    (partial: ElementDraft): BoardElement =>
      ({
        id: crypto.randomUUID(),
        createdBy: userId,
        createdAt: Date.now(),
        z: nextZ(elements),
        ...partial,
      }) as BoardElement,
    [elements, userId],
  );

  // ---- Pointer interactions ----

  const handlePointerDown = useCallback(
    (event: Konva.KonvaEventObject<PointerEvent | MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const point = toBoard(stage);
      if (!point) return;

      if (tool === "select") {
        if (event.target === stage) onSelect(null);
        return;
      }
      if (!canEdit) return;
      console.log("[dbg] pointerdown tool=", tool, "canEdit=", canEdit, "point=", point);

      if (tool === "eraser") return; // handled per-element click

      if (tool === "pen") {
        setDraft(
          newElement({ type: "path", points: [point], color, strokeWidth: 3 }),
        );
        return;
      }

      if (tool === "text") {
        const element = newElement({ type: "text", x: point.x, y: point.y, text: "", fontSize: 16, color });
        console.log("[dbg] text branch, element=", element.id);
        onCreate(element);
        setEditingText("");
        onEditingChange(element.id);
        return;
      }

      if (tool === "sticky") {
        const element = newElement({ type: "sticky", x: point.x, y: point.y, width: 180, height: 140, text: "", color });
        console.log("[dbg] sticky branch, element=", element.id);
        onCreate(element);
        setEditingText("");
        onEditingChange(element.id);
        return;
      }

      // rect / ellipse / arrow: start a drag draft.
      drawStart.current = point;
      if (tool === "rect") {
        setDraft(newElement({ type: "rect", x: point.x, y: point.y, width: 1, height: 1, fill: color }));
      } else if (tool === "ellipse") {
        setDraft(newElement({ type: "ellipse", x: point.x, y: point.y, radiusX: 1, radiusY: 1, fill: color }));
      } else if (tool === "arrow") {
        setDraft(newElement({ type: "arrow", from: point, to: point, color }));
      }
    },
    [canEdit, color, newElement, onEditingChange, onCreate, onSelect, stageRef, toBoard, tool],
  );

  const handlePointerMove = useCallback(
    (_event: Konva.KonvaEventObject<PointerEvent | MouseEvent>) => {
      const stage = stageRef.current;
      if (!stage) return;
      const point = toBoard(stage);
      if (!point) return;

      // Throttled cursor broadcast for presence.
      const now = Date.now();
      if (now - lastCursorEmit.current > 40) {
        lastCursorEmit.current = now;
        onCursorMove(point);
      }

      if (!drawStart.current) return;
      const start = drawStart.current;

      setDraft((current) => {
        if (!current) return current;
        if (current.type === "path") {
          return { ...current, points: [...current.points, point] };
        }
        if (current.type === "rect") {
          return {
            ...current,
            x: Math.min(start.x, point.x),
            y: Math.min(start.y, point.y),
            width: Math.max(1, Math.abs(point.x - start.x)),
            height: Math.max(1, Math.abs(point.y - start.y)),
          };
        }
        if (current.type === "ellipse") {
          return {
            ...current,
            x: Math.min(start.x, point.x),
            y: Math.min(start.y, point.y),
            radiusX: Math.max(1, Math.abs(point.x - start.x) / 2),
            radiusY: Math.max(1, Math.abs(point.y - start.y) / 2),
          };
        }
        if (current.type === "arrow") {
          return { ...current, to: point };
        }
        return current;
      });
    },
    [onCursorMove, stageRef, toBoard],
  );

  const handlePointerUp = useCallback(() => {
    drawStart.current = null;
    if (!draft) return;
    setDraft(null);

    // Ignore accidental micro-drags.
    const tiny =
      (draft.type === "rect" && draft.width < 4) ||
      (draft.type === "ellipse" && draft.radiusX < 2) ||
      (draft.type === "arrow" && Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y) < 6) ||
      (draft.type === "path" && draft.points.length < 2);
    if (tiny) return;

    onCreate(draft);
  }, [draft, onCreate]);

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;

      if (event.evt.ctrlKey || event.evt.metaKey) {
        // Zoom to cursor.
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const oldScale = camera.scale;
        const direction = event.evt.deltaY > 0 ? -1 : 1;
        const newScale = clamp(direction > 0 ? oldScale * 1.08 : oldScale / 1.08, 0.1, 5);
        const boardPoint = {
          x: (pointer.x - camera.x) / oldScale,
          y: (pointer.y - camera.y) / oldScale,
        };
        onCameraChange({
          scale: newScale,
          x: pointer.x - boardPoint.x * newScale,
          y: pointer.y - boardPoint.y * newScale,
        });
      } else {
        onCameraChange({
          ...camera,
          x: camera.x - event.evt.deltaX,
          y: camera.y - event.evt.deltaY,
        });
      }
    },
    [camera, onCameraChange, stageRef],
  );

  // ---- Element event handlers ----

  const bindElement = useCallback(
    (element: BoardElement) => ({
      onClick: () => {
        if (tool === "select") onSelect(element.id);
        else if (tool === "eraser" && canEdit) onDelete(element.id);
      },
      onTap: () => {
        if (tool === "select") onSelect(element.id);
        else if (tool === "eraser" && canEdit) onDelete(element.id);
      },
      onDblClick: () => {
        if (element.type === "text" || element.type === "sticky") {
          setEditingText(element.text);
          onEditingChange(element.id);
        }
      },
      draggable: tool === "select" && canEdit,
    }),
    [canEdit, onDelete, onEditingChange, onSelect, tool],
  );

  const handleDragEnd = useCallback(
    (element: BoardElement, node: Konva.Node) => {
      if (element.type === "path") {
        const dx = node.x();
        const dy = node.y();
        node.position({ x: 0, y: 0 });
        onUpdate(element.id, {
          points: element.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        } as Partial<BoardElement>);
      } else if (element.type === "arrow") {
        const dx = node.x();
        const dy = node.y();
        node.position({ x: 0, y: 0 });
        onUpdate(element.id, {
          from: { x: element.from.x + dx, y: element.from.y + dy },
          to: { x: element.to.x + dx, y: element.to.y + dy },
        } as Partial<BoardElement>);
      } else {
        onUpdate(element.id, { x: node.x(), y: node.y() } as Partial<BoardElement>);
      }
    },
    [onUpdate],
  );

  const handleTransformEnd = useCallback(
    (element: BoardElement, node: Konva.Node) => {
      // Capture scales before resetting — react-konva applies live scale to the node.
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      if (element.type === "rect" || element.type === "sticky") {
        onUpdate(element.id, {
          x: node.x(),
          y: node.y(),
          width: Math.max(10, node.width() * scaleX),
          height: Math.max(10, node.height() * scaleY),
        } as Partial<BoardElement>);
      } else if (element.type === "ellipse") {
        const ellipse = node as Konva.Ellipse;
        onUpdate(element.id, {
          x: node.x(),
          y: node.y(),
          radiusX: Math.max(5, ellipse.radiusX() * scaleX),
          radiusY: Math.max(5, ellipse.radiusY() * scaleY),
        } as Partial<BoardElement>);
      } else {
        onUpdate(element.id, { x: node.x(), y: node.y() } as Partial<BoardElement>);
      }
    },
    [onUpdate],
  );

  const registerNode = useCallback((id: string, node: Konva.Node | null) => {
    if (node) nodeRefs.current.set(id, node);
    else nodeRefs.current.delete(id);
  }, []);

  // ---- Rendering ----

  function renderElement(element: BoardElement) {
    const interactive = bindElement(element);
    const ref = (node: Konva.Node | null) => registerNode(element.id, node);
    const isEditing = editingId === element.id;

    switch (element.type) {
      case "path":
        return (
          <Line
            key={element.id}
            ref={ref as never}
            points={element.points.flatMap((p) => [p.x, p.y])}
            stroke={element.color}
            strokeWidth={element.strokeWidth}
            lineCap="round"
            lineJoin="round"
            onDragEnd={(e) => handleDragEnd(element, e.target)}
            {...interactive}
          />
        );
      case "rect":
        return (
          <Rect
            key={element.id}
            ref={ref as never}
            x={element.x}
            y={element.y}
            width={element.width}
            height={element.height}
            fill={element.fill}
            stroke={selectedId === element.id ? "#2563eb" : undefined}
            strokeWidth={selectedId === element.id ? 2 : 0}
            onDragEnd={(e) => handleDragEnd(element, e.target)}
            onTransformEnd={(e) => handleTransformEnd(element, e.target)}
            {...interactive}
          />
        );
      case "ellipse": {
        const cx = element.x + element.radiusX;
        const cy = element.y + element.radiusY;
        return (
          <Ellipse
            key={element.id}
            ref={ref as never}
            x={cx}
            y={cy}
            radiusX={element.radiusX}
            radiusY={element.radiusY}
            fill={element.fill}
            stroke={selectedId === element.id ? "#2563eb" : undefined}
            strokeWidth={selectedId === element.id ? 2 : 0}
            onDragEnd={(e) => handleDragEnd(element, e.target)}
            onTransformEnd={(e) => handleTransformEnd(element, e.target)}
            {...interactive}
          />
        );
      }
      case "arrow":
        return (
          <Arrow
            key={element.id}
            ref={ref as never}
            points={[element.from.x, element.from.y, element.to.x, element.to.y]}
            stroke={element.color}
            fill={element.color}
            strokeWidth={2.5}
            pointerLength={10}
            pointerWidth={10}
            onDragEnd={(e) => handleDragEnd(element, e.target)}
            {...interactive}
          />
        );
      case "text": {
        const textElement = element as TextElement;
        if (isEditing) return null;
        return (
          <Text
            key={textElement.id}
            ref={ref as never}
            x={textElement.x}
            y={textElement.y}
            text={textElement.text}
            fontSize={textElement.fontSize}
            fill={textElement.color}
            width={220}
            onDragEnd={(e) => handleDragEnd(textElement, e.target)}
            {...interactive}
          />
        );
      }
      case "sticky": {
        const sticky = element as StickyNoteElement;
        if (isEditing) return null;
        return (
          <Group
            key={sticky.id}
            ref={ref as never}
            x={sticky.x}
            y={sticky.y}
            onDragEnd={(e) => handleDragEnd(sticky, e.target)}
            onTransformEnd={(e) => handleTransformEnd(sticky, e.target)}
            {...interactive}
          >
            <Rect
              width={sticky.width}
              height={sticky.height}
              fill={sticky.color}
              cornerRadius={6}
              shadowColor="#000"
              shadowOpacity={0.12}
              shadowBlur={8}
              shadowOffsetY={3}
              stroke={selectedId === sticky.id ? "#2563eb" : undefined}
              strokeWidth={selectedId === sticky.id ? 2 : 0}
            />
            <Text
              text={sticky.text}
              width={sticky.width - 16}
              height={sticky.height - 16}
              x={8}
              y={8}
              fontSize={14}
              fill="#1f2937"
              wrap="word"
            />
          </Group>
        );
      }
      default:
        return null;
    }
  }

  const editingElement = elements.find((el) => el.id === editingId);
  const editingScreen =
    editingElement && (editingElement.type === "text" || editingElement.type === "sticky")
      ? boardToScreen({ x: editingElement.x, y: editingElement.y })
      : null;

  return (
    <div ref={containerRef} className="canvas-container absolute inset-0" data-testid="canvas-container">
      <Stage
        ref={stageRef}
        width={size.width}
        height={size.height}
        scaleX={camera.scale}
        scaleY={camera.scale}
        x={camera.x}
        y={camera.y}
        draggable={tool === "select"}
        onDragEnd={(e) => {
          if (e.target === stageRef.current) {
            onCameraChange({ ...camera, x: e.target.x(), y: e.target.y() });
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        style={{ cursor: tool === "select" ? "default" : "crosshair" }}
      >
        <Layer>
          {elements.map(renderElement)}
          {draft ? renderElement(draft) : null}
        </Layer>
        <Layer>
          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            enabledAnchors={
              selectedId && SCALABLE_TYPES.has(elements.find((el) => el.id === selectedId)?.type ?? "")
                ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                : []
            }
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 10 || newBox.height < 10 ? oldBox : newBox)}
          />
        </Layer>
      </Stage>

      {editingElement && editingScreen && editingElement.type === "text" ? (
        <textarea
          autoFocus
          data-testid="text-editor"
          value={editingText}
          onChange={(e) => setEditingText(e.target.value)}
          onBlur={() => {
            onUpdate(editingElement.id, { text: editingText } as Partial<BoardElement>);
            if (!editingText.trim()) onDelete(editingElement.id);
            onEditingChange(null);
          }}
          className="absolute rounded border-2 border-blue-500 bg-white/90 p-1 text-gray-900 outline-none"
          style={{ left: editingScreen.x, top: editingScreen.y, width: 220, fontSize: editingElement.fontSize }}
        />
      ) : null}

      {editingElement && editingScreen && editingElement.type === "sticky" ? (
        <textarea
          autoFocus
          data-testid="sticky-editor"
          value={editingText}
          onChange={(e) => setEditingText(e.target.value)}
          onBlur={() => {
            onUpdate(editingElement.id, { text: editingText } as Partial<BoardElement>);
            if (!editingText.trim()) onDelete(editingElement.id);
            onEditingChange(null);
          }}
          className="absolute resize-none rounded border-2 border-blue-500 bg-yellow-50/95 p-2 text-sm text-gray-900 outline-none"
          style={{
            left: editingScreen.x,
            top: editingScreen.y,
            width: (editingElement as StickyNoteElement).width,
            height: (editingElement as StickyNoteElement).height,
          }}
        />
      ) : null}
    </div>
  );
}
