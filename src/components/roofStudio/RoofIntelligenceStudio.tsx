import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BoxSelect,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Grid3X3,
  Hand,
  ImageIcon,
  Layers,
  Lock,
  Magnet,
  MousePointer2,
  Pentagon,
  Redo2,
  Ruler,
  Slash,
  Spline,
  Square,
  Sun,
  Trash2,
  Triangle,
  Undo2,
  Unlock,
  X,
} from "lucide-react";
import {
  LAYER_ORDER,
  addPlane,
  analyzeStudio,
  canRedo,
  canUndo,
  circleVertices,
  clearLayer,
  commit,
  createHistory,
  createInitialRoofStudioState,
  createRoofBackgroundImageManager,
  deleteVertex,
  getSelectedPlane,
  insertVertex,
  isLayerLocked,
  isLayerVisible,
  isScaleCalibrated,
  layerForTool,
  measureAngleDeg,
  tryMeasureAreaM2,
  measureDistanceM,
  moveVertex,
  nearestEdgeIndex,
  planeGeometryLocked,
  nextStudioId,
  obstacleClearancePreview,
  planeSelfIntersects,
  rectVertices,
  isSupportedRoofImageType,
  redo as redoHistory,
  removePlane,
  renameLayer,
  resolveSnappedPoint,
  toggleLayerLock,
  toggleLayerVisibility,
  undo as undoHistory,
  updatePlane,
  type LayerType,
  type Point2D,
  type RoofPlaneMetrics,
  type RoofStudioHistory,
  type RoofStudioState,
  type StudioLine,
  type StudioObstacle,
  type StudioPlane,
  type ToolMode,
} from "../../lib/roofStudioClient";
import { applyScaleCalibration } from "../../lib/roofStudioCalibration.ts";
import { addDimension, dimensionLabel, updateDimensionLabel } from "../../lib/roofStudioDimensions.ts";
import {
  addPanelAt,
  autoFillPanelsOnPlane,
  hitTestPanel,
  panelFootprintUnits,
  panelSystemKw,
  type StudioPanelPlacement,
} from "../../lib/roofStudioPanels.ts";
import {
  beginPanelDragSession,
  copyPanelsToClipboard,
  duplicatePanels,
  normalizeWorldRect,
  panelIdsInWorldRect,
  pastePanelsFromClipboard,
  removePanels,
  resolvePanelDragPlacements,
  rotatePanels,
  togglePanelIdSelection,
  type PanelClipboardItem,
  type PanelDragSession,
} from "../../lib/roofStudioPanelEditing.ts";
import { boqFromPlacements } from "../../lib/roofStudioBoq.ts";
import { buildLayoutReportPages } from "../../lib/roofStudioReport.ts";
import { addStructureMember } from "../../lib/roofStudioStructure.ts";
import {
  BoqEditor,
  CalibrationBanner,
  CalibrationDialog,
  CalibrationWizard,
  GeoReferenceEditor,
  PanelSpecEditor,
  ReportPreview,
  StructureEditor,
  validateSiteGeoReference,
} from "./RoofStudioMeasurementPanels.tsx";
import { mergeSegmentDimensions, planeBoundarySegmentDimensions } from "../../lib/roofStudioDimensions.ts";
import {
  canEnterWizardStep,
  COMPLETE_PREVIOUS_STEP_MESSAGE,
  isDesignWorkspaceUnlocked,
  type SiteGeoReference,
  type WizardStep,
} from "../../lib/roofStudioGeoReference.ts";

const CANVAS_HEIGHT = 640;
const VERTEX_HIT_UNITS = 10;

/** CRM / Project Design Workspace context seeded into Roof Studio. */
export interface ProjectDesignContext {
  leadId: string;
  customerName: string;
  phone: string;
  address: string;
  sanctionedLoad: string;
  geoSeed: SiteGeoReference;
}

export interface RoofIntelligenceStudioProps {
  /** When set, studio is embedded in Project Design Workspace. */
  project?: ProjectDesignContext;
  /** Hide standalone hero; gate panels/BOQ/proposal until image + scale. */
  workspaceMode?: boolean;
  /**
   * `full` — default CAD chrome (layers + right stats).
   * `canvas` — toolbar + canvas + status only (HelioScope center pane).
   */
  chromeMode?: "full" | "canvas";
  /** Notify parent when studio state changes (Design Studio live results). */
  onStudioStateChange?: (snapshot: {
    state: RoofStudioState;
    hasImage: boolean;
    calibrated: boolean;
    imageFileName: string | null;
    imageUrl: string | null;
  }) => void;
  /** Optional overlay panels drawn on canvas (Panel Layout Engine V2 placements). */
  overlayPanels?: Array<{
    id: string;
    x: number;
    y: number;
    widthUnits: number;
    heightUnits: number;
  }>;
  /** Imperative bridge for Design Studio Auto Layout / tool selection. */
  studioApiRef?: React.MutableRefObject<RoofStudioApi | null>;
}

export interface RoofStudioApi {
  getState: () => RoofStudioState;
  hasImage: () => boolean;
  isCalibrated: () => boolean;
  setTool: (tool: ToolMode) => void;
  openImagePicker: () => void;
  /** Load a validated image URL/data-URL as the roof base layer (draft-only; still requires calibration). */
  setBackgroundImageFromUrl: (url: string, fileName?: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  applyState: (next: RoofStudioState) => void;
  resetCalibration: () => void;
  selectPlane: (planeId: string) => void;
}

type Viewport = { scale: number; offsetX: number; offsetY: number };

interface Tool {
  id: ToolMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "nav" | "roof" | "features" | "measure" | "calibrate" | "panels" | "structure";
}

const TOOLS: Tool[] = [
  { id: "select", label: "Select / Edit", icon: MousePointer2, group: "nav" },
  { id: "pan", label: "Pan", icon: Hand, group: "nav" },
  { id: "calibrate-scale", label: "Calibrate Scale", icon: Ruler, group: "calibrate" },
  { id: "dimension-line", label: "Dimension", icon: Ruler, group: "measure" },
  { id: "plane", label: "Roof Plane", icon: Pentagon, group: "roof" },
  { id: "obstacle-rect", label: "Obstacle (Rect)", icon: Square, group: "features" },
  { id: "obstacle-circle", label: "Obstacle (Circle)", icon: Circle, group: "features" },
  { id: "obstacle-polygon", label: "Obstacle (Polygon)", icon: Pentagon, group: "features" },
  { id: "walkway", label: "Walkway", icon: Spline, group: "features" },
  { id: "parapet", label: "Parapet", icon: Square, group: "features" },
  { id: "ridge", label: "Ridge", icon: Slash, group: "features" },
  { id: "valley", label: "Valley", icon: Slash, group: "features" },
  { id: "panel-place", label: "Place Panel", icon: BoxSelect, group: "panels" },
  { id: "structure-h-beam", label: "H-Beam", icon: Slash, group: "structure" },
  { id: "structure-c-channel", label: "C-Channel", icon: Slash, group: "structure" },
  { id: "structure-column", label: "Column", icon: Circle, group: "structure" },
  { id: "structure-foundation", label: "Foundation", icon: Square, group: "structure" },
  { id: "measure-distance", label: "Distance", icon: Ruler, group: "measure" },
  { id: "measure-area", label: "Area", icon: Pentagon, group: "measure" },
  { id: "measure-angle", label: "Angle", icon: Triangle, group: "measure" },
];

const POLYGON_TOOLS: ToolMode[] = ["plane", "obstacle-polygon", "walkway", "parapet", "measure-area"];
const SEGMENT_TOOLS: ToolMode[] = [
  "ridge",
  "valley",
  "measure-distance",
  "calibrate-scale",
  "dimension-line",
  "structure-h-beam",
  "structure-c-channel",
  "structure-column",
];

const LAYER_FOR_TOOL: Record<string, LayerType> = {
  "obstacle-rect": "obstacle",
  "obstacle-circle": "obstacle",
  "obstacle-polygon": "obstacle",
  walkway: "walkway",
  parapet: "parapet",
  ridge: "ridge",
  valley: "valley",
};

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function RoofIntelligenceStudio({
  project,
  workspaceMode = false,
  chromeMode = "full",
  onStudioStateChange,
  overlayPanels,
  studioApiRef,
}: RoofIntelligenceStudioProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<RoofStudioHistory>(() => {
    const initial = createInitialRoofStudioState(project?.leadId ? `lead-${project.leadId}` : "roof-site");
    if (project?.geoSeed) {
      initial.geoReference = { ...project.geoSeed };
    }
    return createHistory(initial);
  });
  const state = history.present;

  useEffect(() => {
    if (!project?.geoSeed) return;
    setHistory((h) => {
      const next = {
        ...h.present,
        geoReference: {
          ...project.geoSeed,
          siteLabel: project.geoSeed.siteLabel || project.address || project.customerName || h.present.geoReference.siteLabel,
        },
      };
      return { ...h, present: next };
    });
  }, [project?.leadId, project?.geoSeed.latitude, project?.geoSeed.longitude, project?.geoSeed.siteLabel, project?.address, project?.customerName]);

  const [tool, setTool] = useState<ToolMode>("plane");
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, offsetX: 80, offsetY: 80 });
  const [showGrid, setShowGrid] = useState(true);
  const [snapGrid, setSnapGrid] = useState(true);
  const [snapVertices, setSnapVertices] = useState(true);

  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);
  const [dragShape, setDragShape] = useState<{ start: Point2D; end: Point2D } | null>(null);
  const [measureResult, setMeasureResult] = useState<string | null>(null);
  const [calibrationDialogOpen, setCalibrationDialogOpen] = useState(false);
  const [calibrationDistanceInput, setCalibrationDistanceInput] = useState("51 ft 9 in");
  const [pendingCalibrationLine, setPendingCalibrationLine] = useState<{ start: Point2D; end: Point2D } | null>(null);
  const panelDragRef = useRef<PanelDragSession | null>(null);
  const [selectedPanelIds, setSelectedPanelIds] = useState<string[]>([]);
  const [hoveredPanelId, setHoveredPanelId] = useState<string | null>(null);
  const [panelClipboard, setPanelClipboard] = useState<PanelClipboardItem[]>([]);
  const [marqueeSelect, setMarqueeSelect] = useState<{ start: Point2D; end: Point2D } | null>(null);
  const [panelDragCollidingIds, setPanelDragCollidingIds] = useState<Set<string>>(new Set());
  const marqueeSelectRef = useRef<{ start: Point2D; end: Point2D } | null>(null);

  const calibrated = isScaleCalibrated(state.scaleCalibration, state.metersPerUnit);
  const [cursorWorld, setCursorWorld] = useState<Point2D>({ x: 0, y: 0 });
  const [spaceDown, setSpaceDown] = useState(false);
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const vertexDragRef = useRef<{ planeId: string; index: number } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: CANVAS_HEIGHT });

  /* ---------------- local background image (never leaves the browser) ---------------- */
  const imageManagerRef = useRef(createRoofBackgroundImageManager());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bgImage, setBgImage] = useState<{ el: HTMLImageElement; fileName: string } | null>(null);
  const [bgOpacity, setBgOpacity] = useState(0.7);
  const [imageError, setImageError] = useState<string | null>(null);

  const clearBackgroundImage = useCallback(() => {
    imageManagerRef.current.clear();
    setBgImage(null);
    setImageError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const setBackgroundImageFromUrl = useCallback(
    (url: string, fileName = "satellite-image") =>
      new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
        const trimmed = String(url ?? "").trim();
        if (!trimmed) {
          resolve({ ok: false, error: "Empty image URL." });
          return;
        }
        const lower = trimmed.toLowerCase();
        if (lower.startsWith("javascript:") || lower.startsWith("data:text/html")) {
          resolve({ ok: false, error: "Unsafe image URL rejected." });
          return;
        }
        if (lower.startsWith("data:") && !/^data:image\/[a-z0-9.+-]+(;|,)/i.test(trimmed)) {
          resolve({ ok: false, error: "Only image/* data URLs are allowed." });
          return;
        }
        // Clear prior blob URL if any; do not use image manager blob for remote/data URLs.
        imageManagerRef.current.clear();
        if (fileInputRef.current) fileInputRef.current.value = "";
        const img = new Image();
        // Allow canvas compositing of HTTPS satellite tiles without tainting where CORS allows.
        if (/^https?:\/\//i.test(trimmed)) {
          img.crossOrigin = "anonymous";
        }
        img.onload = () => {
          setBgImage({ el: img, fileName });
          setImageError(null);
          resolve({ ok: true });
        };
        img.onerror = () => {
          setImageError("Failed to decode satellite / remote image.");
          setBgImage(null);
          resolve({ ok: false, error: "Failed to decode image." });
        };
        img.src = trimmed;
      }),
    []
  );

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isSupportedRoofImageType(file.type)) {
      setImageError("Unsupported image type. Use PNG, JPEG, WEBP, or GIF.");
      return;
    }
    const meta = imageManagerRef.current.set(file, file.name);
    if (!meta) {
      setImageError("Could not load image in this browser.");
      return;
    }
    setImageError(null);
    const img = new Image();
    img.onload = () => setBgImage({ el: img, fileName: meta.fileName });
    img.onerror = () => {
      setImageError("Failed to decode image.");
      clearBackgroundImage();
    };
    img.src = meta.url;
  }, [clearBackgroundImage]);

  useEffect(() => {
    const manager = imageManagerRef.current;
    return () => manager.clear();
  }, []);

  const analysis = useMemo(() => analyzeStudio(state), [state]);
  const planeMetrics = useMemo(() => {
    const map = new Map<string, RoofPlaneMetrics>();
    analysis.metrics?.planes.forEach((p) => map.set(p.planeId, p));
    return map;
  }, [analysis]);

  const selectedPlane = getSelectedPlane(state);
  const reportPages = useMemo(() => {
    if (!calibrated) return [];
    return buildLayoutReportPages({
      planes: state.planes,
      metersPerUnit: state.metersPerUnit,
      calibration: state.scaleCalibration,
      geoReference: state.geoReference,
      northAzimuthDeg: state.northAzimuthDeg,
      dimensions: state.dimensionAnnotations,
      panelPlacements: state.panelPlacements,
      panelSpec: state.panelSpec,
      structure: state.structure,
      boqLines: state.boqLines,
    });
  }, [state, calibrated]);

  const geoError = validateSiteGeoReference(state.geoReference);
  const hasCompletePlane = state.planes.some((p) => p.boundary.length >= 3);
  const hasPanels = state.panelPlacements.length > 0;
  const hasBoq = state.boqLines.length > 0;
  const hasImage = Boolean(bgImage);
  const designUnlocked = isDesignWorkspaceUnlocked(hasImage, calibrated);
  const canvasOnly = chromeMode === "canvas";

  /* ---------------- history helpers (must be above effects that reference apply) ---------------- */
  const apply = useCallback((next: RoofStudioState) => {
    setHistory((h) => commit(h, next));
  }, []);
  const setPresentTransient = useCallback((next: RoofStudioState) => {
    setHistory((h) => ({ ...h, present: next }));
  }, []);
  const doUndo = useCallback(() => setHistory((h) => undoHistory(h)), []);
  const doRedo = useCallback(() => setHistory((h) => redoHistory(h)), []);

  const commitPanelPlacements = useCallback(
    (placements: StudioPanelPlacement[], nextSelectedIds?: string[]) => {
      const boqLines = boqFromPlacements(placements, state.structure, state.panelSpec.wattage);
      apply({ ...state, panelPlacements: placements, boqLines });
      if (nextSelectedIds) setSelectedPanelIds(nextSelectedIds);
    },
    [apply, state]
  );

  useEffect(() => {
    onStudioStateChange?.({
      state,
      hasImage,
      calibrated,
      imageFileName: bgImage?.fileName ?? null,
      imageUrl: bgImage?.el.src ?? null,
    });
  }, [state, hasImage, calibrated, bgImage?.fileName, bgImage?.el.src, onStudioStateChange]);

  useEffect(() => {
    if (!studioApiRef) return;
    studioApiRef.current = {
      getState: () => state,
      hasImage: () => Boolean(bgImage),
      isCalibrated: () => isScaleCalibrated(state.scaleCalibration, state.metersPerUnit),
      setTool: (t) => {
        setTool(t);
        setDraftPoints([]);
        setDragShape(null);
      },
      openImagePicker: () => fileInputRef.current?.click(),
      setBackgroundImageFromUrl,
      applyState: (next) => apply(next),
      resetCalibration: () => {
        apply({
          ...state,
          metersPerUnit: 0,
          scaleCalibration: null,
          panelPlacements: [],
          boqLines: [],
        });
        setMeasureResult("Calibration reset — recalibrate scale before layout.");
      },
      selectPlane: (planeId) => {
        apply({ ...state, selectedPlaneId: planeId });
        setTool("select");
      },
    };
    return () => {
      studioApiRef.current = null;
    };
  }, [studioApiRef, state, bgImage, apply, setBackgroundImageFromUrl]);

  const handleWizardStep = useCallback(
    (step: WizardStep) => {
      const opts = {
        hasImage: Boolean(bgImage),
        calibrated: isScaleCalibrated(state.scaleCalibration, state.metersPerUnit),
        hasCompletePlane: state.planes.some((p) => p.boundary.length >= 3),
        hasPanels: state.panelPlacements.length > 0,
        hasBoq: state.boqLines.length > 0,
      };
      if (!canEnterWizardStep(step, opts)) {
        setMeasureResult(COMPLETE_PREVIOUS_STEP_MESSAGE);
        return;
      }
      if (step === 1) fileInputRef.current?.click();
      else if (step === 2) {
        setTool("calibrate-scale");
        setMeasureResult("Draw a line over a known roof distance, then enter the real length.");
      } else if (step === 3) setTool("plane");
      else if (step === 4) {
        setTool("panel-place");
        setMeasureResult("Place panels or use Auto-fill on the selected roof plane.");
      } else if (step === 5) {
        setMeasureResult("Review the draft BOQ below. Edit rates only after panels exist.");
      } else {
        setMeasureResult("Review the layout report / proposal draft pages below.");
      }
    },
    [bgImage, state.scaleCalibration, state.metersPerUnit, state.planes, state.panelPlacements.length, state.boqLines.length]
  );

  const panelCount = state.panelPlacements.length;
  const systemKw = panelSystemKw(state.panelPlacements, state.panelSpec.wattage);

  const handleApplyCalibration = useCallback(() => {
    if (!pendingCalibrationLine) return;
    const result = applyScaleCalibration(
      pendingCalibrationLine.start,
      pendingCalibrationLine.end,
      calibrationDistanceInput
    );
    if (!result) {
      setMeasureResult("Could not parse distance. Try: 51 ft 9 in or 15 m");
      return;
    }
    apply({
      ...state,
      metersPerUnit: result.metersPerUnit,
      scaleCalibration: result.calibration,
    });
    setCalibrationDialogOpen(false);
    setPendingCalibrationLine(null);
    setMeasureResult(`Scale calibrated: ${result.calibration.inputLabel}`);
  }, [pendingCalibrationLine, calibrationDistanceInput, state, apply]);

  const handleAutoFillPanels = useCallback(() => {
    if (!calibrated) return;
    const plane = selectedPlane ?? state.planes[state.planes.length - 1];
    if (!plane) {
      setMeasureResult("Draw a roof plane first.");
      return;
    }
    const filled = autoFillPanelsOnPlane(plane, state.panelSpec, state.metersPerUnit, state.panelSpec.orientation);
    const other = state.panelPlacements.filter((p) => p.planeId !== plane.id);
    const placements = [...other, ...filled];
    const boqLines = boqFromPlacements(placements, state.structure, state.panelSpec.wattage);
    apply({ ...state, panelPlacements: placements, boqLines });
    setMeasureResult(`Auto-filled ${filled.length} panels on ${plane.name}.`);
  }, [calibrated, selectedPlane, state, apply]);

  /* ---------------- lock guards (UI-level enforcement) ---------------- */
  const warnLocked = useCallback((layerLabel: string) => {
    setMeasureResult(`Layer is locked: ${layerLabel}`);
  }, []);
  const isToolLayerLocked = useCallback(
    (t: ToolMode): boolean => {
      const layer = layerForTool(t);
      if (!layer) return false;
      if (isLayerLocked(state, layer)) {
        warnLocked(state.layers[layer].name);
        return true;
      }
      return false;
    },
    [state, warnLocked]
  );
  const isPlaneGeoLocked = useCallback((): boolean => {
    if (planeGeometryLocked(state)) {
      warnLocked(isLayerLocked(state, "plane") ? state.layers.plane.name : state.layers.boundary.name);
      return true;
    }
    return false;
  }, [state, warnLocked]);

  /* ---------------- coordinate transforms ---------------- */
  const worldToScreen = useCallback(
    (p: Point2D): Point2D => ({ x: p.x * viewport.scale + viewport.offsetX, y: p.y * viewport.scale + viewport.offsetY }),
    [viewport]
  );
  const screenToWorld = useCallback(
    (sx: number, sy: number): Point2D => ({ x: (sx - viewport.offsetX) / viewport.scale, y: (sy - viewport.offsetY) / viewport.scale }),
    [viewport]
  );

  const snap = useCallback(
    (p: Point2D) => resolveSnappedPoint(p, state, { snapGrid, snapVertices, vertexThresholdUnits: VERTEX_HIT_UNITS }),
    [state, snapGrid, snapVertices]
  );

  /* ---------------- resize ---------------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setCanvasSize({ w: el.clientWidth, h: CANVAS_HEIGHT });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------- keyboard ---------------- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if ((meta && e.key.toLowerCase() === "y") || (meta && e.shiftKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        doRedo();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        tool === "select" &&
        selectedPanelIds.length > 0 &&
        calibrated &&
        isLayerVisible(state, "panels")
      ) {
        e.preventDefault();
        const next = removePanels(state.panelPlacements, new Set(selectedPanelIds));
        setSelectedPanelIds([]);
        commitPanelPlacements(next);
      } else if (meta && e.key.toLowerCase() === "c" && selectedPanelIds.length > 0) {
        e.preventDefault();
        setPanelClipboard(copyPanelsToClipboard(state.panelPlacements, new Set(selectedPanelIds)));
        setMeasureResult(`Copied ${selectedPanelIds.length} panel(s).`);
      } else if (meta && e.key.toLowerCase() === "v" && panelClipboard.length > 0) {
        e.preventDefault();
        const targetPlane = selectedPlane ?? state.planes.find((p) => p.id === panelClipboard[0]?.planeId) ?? state.planes[0];
        if (!targetPlane) {
          setMeasureResult("Draw a roof plane before pasting panels.");
          return;
        }
        const pasted = pastePanelsFromClipboard(panelClipboard, targetPlane.id, cursorWorld);
        commitPanelPlacements([...state.panelPlacements, ...pasted], pasted.map((p) => p.id));
        setMeasureResult(`Pasted ${pasted.length} panel(s).`);
      } else if (meta && e.key.toLowerCase() === "d" && selectedPanelIds.length > 0) {
        e.preventDefault();
        const next = duplicatePanels(state.panelPlacements, new Set(selectedPanelIds));
        const newIds = next.filter((p) => !state.panelPlacements.some((old) => old.id === p.id)).map((p) => p.id);
        commitPanelPlacements(next, [...selectedPanelIds, ...newIds]);
        setMeasureResult(`Duplicated ${selectedPanelIds.length} panel(s).`);
      } else if ((e.key === "r" || e.key === "R") && selectedPanelIds.length > 0 && tool === "select") {
        e.preventDefault();
        const next = rotatePanels(state.panelPlacements, new Set(selectedPanelIds), state.panelSpec, state.metersPerUnit);
        commitPanelPlacements(next);
        setMeasureResult(`Rotated ${selectedPanelIds.length} panel(s).`);
      } else if (e.key === "Escape") {
        setDraftPoints([]);
        setDragShape(null);
        setSelectedPanelIds([]);
        setMarqueeSelect(null);
        marqueeSelectRef.current = null;
      } else if (e.key === "Enter" && POLYGON_TOOLS.includes(tool)) {
        e.preventDefault();
        finishPolygon();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    tool,
    draftPoints,
    doUndo,
    doRedo,
    selectedPanelIds,
    panelClipboard,
    cursorWorld,
    calibrated,
    state,
    selectedPlane,
    commitPanelPlacements,
  ]);

  /* ---------------- polygon completion ---------------- */
  const finishPolygon = useCallback(() => {
    if (draftPoints.length < 3) {
      setDraftPoints([]);
      return;
    }
    const pts = draftPoints.slice();
    setDraftPoints([]);

    if (tool === "plane") {
      apply(addPlane(state, pts));
      return;
    }
    if (tool === "measure-area") {
      const areaResult = tryMeasureAreaM2(pts, state.metersPerUnit);
      if (!areaResult.ok) {
        setMeasureResult((areaResult as any).message);
        return;
      }
      setMeasureResult(`Area: ${fmt(areaResult.areaM2, 2)} m²`);
      return;
    }
    const targetPlane = selectedPlane ?? state.planes[state.planes.length - 1];
    if (!targetPlane) {
      setMeasureResult("Draw a roof plane first.");
      return;
    }
    if (tool === "obstacle-polygon") {
      const obstacle: StudioObstacle = {
        id: nextStudioId("obs"),
        name: `Obstacle ${targetPlane.obstacles.length + 1}`,
        shape: "polygon",
        vertices: pts,
        rotationDeg: 0,
        heightM: 1,
        clearanceM: 0.3,
      };
      apply(updatePlane(state, targetPlane.id, { obstacles: [...targetPlane.obstacles, obstacle] }));
    } else if (tool === "walkway") {
      apply(
        updatePlane(state, targetPlane.id, {
          walkways: [
            ...targetPlane.walkways,
            { id: nextStudioId("walk"), name: `Walkway ${targetPlane.walkways.length + 1}`, vertices: pts, widthM: 0.6 },
          ],
        })
      );
    } else if (tool === "parapet") {
      apply(
        updatePlane(state, targetPlane.id, {
          parapets: [
            ...targetPlane.parapets,
            { id: nextStudioId("parapet"), name: `Parapet ${targetPlane.parapets.length + 1}`, vertices: pts, heightM: 1, thicknessM: 0.3 },
          ],
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftPoints, tool, state, selectedPlane, apply]);

  /* ---------------- pointer handlers ---------------- */
  const getPointer = (e: React.PointerEvent<HTMLCanvasElement>): { sx: number; sy: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  };

  const isPanMode = spaceDown || tool === "pan";

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = getPointer(e);
    const world = screenToWorld(sx, sy);
    canvasRef.current?.setPointerCapture(e.pointerId);

    if (isPanMode) {
      panRef.current = { sx, sy, ox: viewport.offsetX, oy: viewport.offsetY };
      return;
    }

    const snapped = snap(world);

    if (tool === "select") {
      if (calibrated && isLayerVisible(state, "panels")) {
        const panelHit = hitTestPanel(state.panelPlacements, state.panelSpec, state.metersPerUnit, world);
        if (panelHit) {
          if (e.shiftKey) {
            setSelectedPanelIds((prev) => togglePanelIdSelection(prev, panelHit.id));
            return;
          }
          const nextSelected = selectedPanelIds.includes(panelHit.id) ? selectedPanelIds : [panelHit.id];
          setSelectedPanelIds(nextSelected);
          apply(state);
          const targetPlane = state.planes.find((pl) => pl.id === panelHit.planeId) ?? selectedPlane;
          if (targetPlane) {
            panelDragRef.current = beginPanelDragSession(
              state.panelPlacements,
              panelHit.id,
              nextSelected,
              world
            );
          }
          return;
        }
      }
      const hit = hitTestVertex(world);
      if (hit) {
        apply(state);
        vertexDragRef.current = hit;
        return;
      }
      marqueeSelectRef.current = { start: world, end: world };
      setMarqueeSelect({ start: world, end: world });
      return;
    }

    if (tool === "panel-place") {
      if (!calibrated) {
        setMeasureResult("Calibrate scale before placing panels.");
        return;
      }
      if (isToolLayerLocked(tool)) return;
      const plane = hitTestPlane(world) ?? selectedPlane;
      if (!plane) {
        setMeasureResult("Click on a roof plane to place a panel.");
        return;
      }
      const placements = addPanelAt(
        state.panelPlacements,
        plane.id,
        snapped.x,
        snapped.y,
        state.panelSpec.orientation
      );
      const boqLines = boqFromPlacements(placements, state.structure, state.panelSpec.wattage);
      apply({ ...state, panelPlacements: placements, boqLines });
      return;
    }

    // Drawing tools: block if their target layer is locked (measurement tools have no layer).
    if (isToolLayerLocked(tool)) return;

    if (POLYGON_TOOLS.includes(tool)) {
      if (draftPoints.length >= 3) {
        const first = draftPoints[0];
        const d = Math.hypot(first.x - snapped.x, first.y - snapped.y);
        if (d <= VERTEX_HIT_UNITS) {
          finishPolygon();
          return;
        }
      }
      setDraftPoints((prev) => [...prev, snapped]);
      return;
    }

    if (SEGMENT_TOOLS.includes(tool) || tool === "obstacle-rect" || tool === "obstacle-circle" || tool === "structure-foundation") {
      setDragShape({ start: snapped, end: snapped });
      return;
    }

    if (tool === "measure-angle") {
      setDraftPoints((prev) => {
        const next = [...prev, snapped];
        if (next.length === 3) {
          setMeasureResult(`Angle: ${fmt(measureAngleDeg(next[0], next[1], next[2]), 1)}°`);
          return [];
        }
        return next;
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { sx, sy } = getPointer(e);
    const world = screenToWorld(sx, sy);
    setCursorWorld(world);

    if (panRef.current) {
      const p = panRef.current;
      setViewport((v) => ({ ...v, offsetX: p.ox + (sx - p.sx), offsetY: p.oy + (sy - p.sy) }));
      return;
    }

    if (vertexDragRef.current) {
      const { planeId, index } = vertexDragRef.current;
      const snapped = snap(world);
      const plane = state.planes.find((pl) => pl.id === planeId);
      if (plane) {
        setPresentTransient(updatePlane(state, planeId, { boundary: moveVertex(plane.boundary, index, snapped) }));
      }
      return;
    }

    if (panelDragRef.current) {
      const primary = state.panelPlacements.find((p) => p.id === panelDragRef.current!.panelIds[0]);
      const plane = primary ? state.planes.find((pl) => pl.id === primary.planeId) : selectedPlane;
      if (plane) {
        const { placements, collidingIds } = resolvePanelDragPlacements(
          panelDragRef.current,
          state.panelPlacements,
          snap(world),
          plane,
          state.panelSpec,
          state.metersPerUnit
        );
        setPanelDragCollidingIds(collidingIds);
        setPresentTransient({ ...state, panelPlacements: placements });
      }
      return;
    }

    if (marqueeSelectRef.current) {
      const end = snap(world);
      marqueeSelectRef.current = { start: marqueeSelectRef.current.start, end };
      setMarqueeSelect({ start: marqueeSelectRef.current.start, end });
      return;
    }

    if (tool === "select" && calibrated && isLayerVisible(state, "panels") && !isPanMode) {
      const hoverHit = hitTestPanel(state.panelPlacements, state.panelSpec, state.metersPerUnit, world);
      setHoveredPanelId(hoverHit?.id ?? null);
    } else if (hoveredPanelId) {
      setHoveredPanelId(null);
    }

    if (dragShape) {
      setDragShape({ start: dragShape.start, end: snap(world) });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (panRef.current) {
      panRef.current = null;
      return;
    }
    if (vertexDragRef.current) {
      vertexDragRef.current = null;
      apply(state); // commit final position
      return;
    }
    if (panelDragRef.current) {
      panelDragRef.current = null;
      setPanelDragCollidingIds(new Set());
      const boqLines = boqFromPlacements(state.panelPlacements, state.structure, state.panelSpec.wattage);
      apply({ ...state, panelPlacements: state.panelPlacements, boqLines });
      return;
    }
    if (marqueeSelectRef.current) {
      const { start, end } = marqueeSelectRef.current;
      const rect = normalizeWorldRect(start, end);
      const span = Math.max(rect.maxX - rect.minX, rect.maxY - rect.minY);
      if (span > 3 && calibrated && isLayerVisible(state, "panels")) {
        setSelectedPanelIds(panelIdsInWorldRect(state.panelPlacements, state.panelSpec, state.metersPerUnit, rect));
      } else {
        const planeHit = hitTestPlane(start);
        setSelectedPanelIds([]);
        apply({ ...state, selectedPlaneId: planeHit?.id ?? null });
      }
      marqueeSelectRef.current = null;
      setMarqueeSelect(null);
      return;
    }
    if (dragShape) {
      commitDragShape(dragShape);
      setDragShape(null);
    }
  };

  const commitDragShape = (shape: { start: Point2D; end: Point2D }) => {
    const { start, end } = shape;
    const len = Math.hypot(end.x - start.x, end.y - start.y);

    if (tool === "calibrate-scale") {
      if (len < 2) return;
      setPendingCalibrationLine({ start, end });
      setCalibrationDialogOpen(true);
      return;
    }

    if (tool === "dimension-line") {
      if (!calibrated) {
        setMeasureResult("Calibrate scale before adding dimensions.");
        return;
      }
      if (isToolLayerLocked(tool)) return;
      if (len < 2) return;
      apply({ ...state, dimensionAnnotations: addDimension(state.dimensionAnnotations, start, end) });
      return;
    }

    const structureType =
      tool === "structure-h-beam"
        ? "h-beam"
        : tool === "structure-c-channel"
          ? "c-channel"
          : tool === "structure-column"
            ? "column"
            : tool === "structure-foundation"
              ? "foundation"
              : null;

    if (structureType) {
      if (!calibrated) {
        setMeasureResult("Calibrate scale before adding structure members.");
        return;
      }
      if (isToolLayerLocked(tool)) return;
      let memberStart = start;
      let memberEnd = end;
      if (structureType === "column" && len < 2) {
        memberEnd = { x: start.x + 1, y: start.y };
      }
      if (structureType === "foundation") {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        if (w < 2 || h < 2) return;
        memberStart = { x, y };
        memberEnd = { x: x + w, y: y + h };
      } else if (len < 2) {
        return;
      }
      const structure = addStructureMember(state.structure, structureType, memberStart, memberEnd);
      const boqLines =
        state.panelPlacements.length > 0
          ? boqFromPlacements(state.panelPlacements, structure, state.panelSpec.wattage)
          : state.boqLines;
      apply({ ...state, structure, boqLines });
      return;
    }

    if (tool === "ridge" || tool === "valley") {
      if (len < 2) return;
      const targetPlane = selectedPlane ?? state.planes[state.planes.length - 1];
      if (!targetPlane) {
        setMeasureResult("Draw a roof plane first.");
        return;
      }
      const line: StudioLine = { id: nextStudioId(tool), name: `${tool} ${Date.now() % 1000}`, start, end };
      if (tool === "ridge") apply(updatePlane(state, targetPlane.id, { ridges: [...targetPlane.ridges, line] }));
      else apply(updatePlane(state, targetPlane.id, { valleys: [...targetPlane.valleys, line] }));
      return;
    }
    if (tool === "measure-distance") {
      if (!calibrated) {
        setMeasureResult("Calibrate scale first for real-world distance.");
        return;
      }
      setMeasureResult(`Distance: ${fmt(measureDistanceM(start, end, state.metersPerUnit), 2)} m`);
      return;
    }
    if (tool === "obstacle-rect" || tool === "obstacle-circle") {
      const targetPlane = selectedPlane ?? state.planes[state.planes.length - 1];
      if (!targetPlane) {
        setMeasureResult("Draw a roof plane first.");
        return;
      }
      let vertices: Point2D[];
      if (tool === "obstacle-rect") {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        if (w < 2 || h < 2) return;
        vertices = rectVertices(x, y, w, h);
      } else {
        const radius = Math.hypot(end.x - start.x, end.y - start.y);
        if (radius < 2) return;
        vertices = circleVertices(start.x, start.y, radius);
      }
      const obstacle: StudioObstacle = {
        id: nextStudioId("obs"),
        name: `Obstacle ${targetPlane.obstacles.length + 1}`,
        shape: tool === "obstacle-rect" ? "rect" : "circle",
        vertices,
        rotationDeg: 0,
        heightM: 1,
        clearanceM: 0.3,
      };
      apply(updatePlane(state, targetPlane.id, { obstacles: [...targetPlane.obstacles, obstacle] }));
    }
  };

  const handleDoubleClick = () => {
    if (POLYGON_TOOLS.includes(tool)) finishPolygon();
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setViewport((v) => {
      const newScale = Math.max(0.15, Math.min(12, v.scale * factor));
      const wx = (sx - v.offsetX) / v.scale;
      const wy = (sy - v.offsetY) / v.scale;
      return { scale: newScale, offsetX: sx - wx * newScale, offsetY: sy - wy * newScale };
    });
  };

  /* ---------------- hit testing ---------------- */
  const hitTestVertex = (world: Point2D): { planeId: string; index: number } | null => {
    // Vertex editing is disabled when the plane geometry (plane OR boundary layer) is locked/hidden.
    if (!isLayerVisible(state, "plane") || planeGeometryLocked(state)) return null;
    for (const plane of state.planes) {
      for (let i = 0; i < plane.boundary.length; i += 1) {
        const v = plane.boundary[i];
        if (Math.hypot(v.x - world.x, v.y - world.y) <= VERTEX_HIT_UNITS) return { planeId: plane.id, index: i };
      }
    }
    return null;
  };

  const hitTestPlane = (world: Point2D): StudioPlane | null => {
    for (const plane of state.planes) {
      const b = plane.boundary;
      if (b.length < 3) continue;
      let inside = false;
      for (let i = 0, j = b.length - 1; i < b.length; j = i, i += 1) {
        const intersect =
          b[i].y > world.y !== b[j].y > world.y &&
          world.x < ((b[j].x - b[i].x) * (world.y - b[i].y)) / (b[j].y - b[i].y + 1e-9) + b[i].x;
        if (intersect) inside = !inside;
      }
      if (inside) return plane;
    }
    return null;
  };

  const insertVertexAtCursor = () => {
    if (!selectedPlane) return;
    if (isPlaneGeoLocked()) return;
    const idx = nearestEdgeIndex(selectedPlane.boundary, cursorWorld);
    if (idx < 0) return;
    apply(updatePlane(state, selectedPlane.id, { boundary: insertVertex(selectedPlane.boundary, idx, snap(cursorWorld)) }));
  };

  /* ---------------- rendering ---------------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = canvasSize;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0a0f1a";
    ctx.fillRect(0, 0, w, h);

    // local background image (world origin, natural px = world units)
    if (bgImage) {
      const origin = worldToScreen({ x: 0, y: 0 });
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, bgOpacity));
      ctx.drawImage(
        bgImage.el,
        origin.x,
        origin.y,
        bgImage.el.naturalWidth * viewport.scale,
        bgImage.el.naturalHeight * viewport.scale
      );
      ctx.restore();
    }

    // grid
    if (showGrid) {
      const step = state.gridSizeUnits * viewport.scale;
      if (step > 6) {
        ctx.strokeStyle = "rgba(148,163,184,0.10)";
        ctx.lineWidth = 1;
        const startX = viewport.offsetX % step;
        const startY = viewport.offsetY % step;
        ctx.beginPath();
        for (let x = startX; x < w; x += step) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
        }
        for (let y = startY; y < h; y += step) {
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
        }
        ctx.stroke();
      }
    }

    const S = (p: Point2D) => worldToScreen(p);

    // planes
    if (isLayerVisible(state, "plane")) {
      for (const plane of state.planes) {
        const b = plane.boundary;
        if (b.length === 0) continue;
        const selfInt = planeSelfIntersects(plane);
        const isSel = plane.id === state.selectedPlaneId;
        ctx.beginPath();
        const s0 = S(b[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < b.length; i += 1) {
          const s = S(b[i]);
          ctx.lineTo(s.x, s.y);
        }
        if (b.length >= 3) ctx.closePath();
        ctx.fillStyle = selfInt ? "rgba(244,63,94,0.14)" : isSel ? "rgba(245,158,11,0.18)" : "rgba(56,189,248,0.10)";
        ctx.strokeStyle = selfInt ? "rgba(248,113,113,0.95)" : isSel ? "rgba(251,191,36,0.95)" : "rgba(56,189,248,0.7)";
        ctx.lineWidth = isSel ? 2.5 : 1.8;
        if (b.length >= 3) ctx.fill();
        ctx.stroke();

        // vertices
        if (isSel && isLayerVisible(state, "plane")) {
          for (const v of b) {
            const s = S(v);
            ctx.beginPath();
            ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = "#fde68a";
            ctx.fill();
            ctx.strokeStyle = "rgba(15,23,42,0.9)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        // obstacles + clearance (scale required for clearance geometry)
        if (isLayerVisible(state, "obstacle")) {
          for (const o of plane.obstacles) {
            drawPolygon(ctx, o.vertices, S, "rgba(244,63,94,0.28)", "rgba(251,113,133,0.95)");
            if (calibrated) {
              const clearance = obstacleClearancePreview(plane, o, state.metersPerUnit);
              drawPolygonDashed(ctx, clearance, S, "rgba(251,146,60,0.8)");
            }
          }
        }
        if (isLayerVisible(state, "walkway")) {
          for (const wk of plane.walkways) drawPolygon(ctx, wk.vertices, S, "rgba(250,204,21,0.18)", "rgba(250,204,21,0.85)");
        }
        if (isLayerVisible(state, "parapet")) {
          for (const pp of plane.parapets) drawPolygon(ctx, pp.vertices, S, "rgba(168,85,247,0.18)", "rgba(192,132,252,0.9)");
        }
        if (isLayerVisible(state, "ridge")) {
          for (const r of plane.ridges) drawSegment(ctx, r, S, "rgba(34,197,94,0.95)");
        }
        if (isLayerVisible(state, "valley")) {
          for (const v of plane.valleys) drawSegment(ctx, v, S, "rgba(59,130,246,0.95)");
        }
      }
    }

    // placed panels (exact dimensions, no area guess)
    if (calibrated && isLayerVisible(state, "panels")) {
      for (const placement of state.panelPlacements) {
        const { w, h } = panelFootprintUnits(state.panelSpec, placement.orientation, state.metersPerUnit);
        const verts = rectVertices(placement.x, placement.y, w, h);
        const isSelected = selectedPanelIds.includes(placement.id);
        const isHovered = hoveredPanelId === placement.id;
        const isColliding = panelDragCollidingIds.has(placement.id);
        let fill = "rgba(34,211,238,0.35)";
        let stroke = "rgba(34,211,238,0.95)";
        if (isColliding) {
          fill = "rgba(244,63,94,0.38)";
          stroke = "rgba(248,113,113,0.98)";
        } else if (isSelected) {
          fill = "rgba(251,191,36,0.42)";
          stroke = "rgba(252,211,77,0.98)";
        } else if (isHovered) {
          fill = "rgba(56,189,248,0.48)";
          stroke = "rgba(125,211,252,0.98)";
        }
        drawPolygon(ctx, verts, S, fill, stroke);
        if (isSelected) {
          for (const v of verts) {
            const s = S(v);
            ctx.beginPath();
            ctx.rect(s.x - 3, s.y - 3, 6, 6);
            ctx.fillStyle = "rgba(252,211,77,0.95)";
            ctx.fill();
            ctx.strokeStyle = "rgba(15,23,42,0.9)";
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }
      // Panel Layout Engine V2 overlay (Design Studio Auto Layout)
      if (overlayPanels?.length) {
        for (const p of overlayPanels) {
          const verts = rectVertices(p.x, p.y, p.widthUnits, p.heightUnits);
          drawPolygon(ctx, verts, S, "rgba(251,191,36,0.28)", "rgba(251,191,36,0.95)");
        }
      }
    }

    if (marqueeSelect) {
      const rect = normalizeWorldRect(marqueeSelect.start, marqueeSelect.end);
      const tl = S({ x: rect.minX, y: rect.minY });
      const br = S({ x: rect.maxX, y: rect.maxY });
      const rw = br.x - tl.x;
      const rh = br.y - tl.y;
      ctx.fillStyle = "rgba(56,189,248,0.12)";
      ctx.strokeStyle = "rgba(125,211,252,0.95)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(tl.x, tl.y, rw, rh);
      ctx.strokeRect(tl.x, tl.y, rw, rh);
      ctx.setLineDash([]);
    }

    // dimension annotations
    if (calibrated && isLayerVisible(state, "measurements")) {
      for (const dim of state.dimensionAnnotations) {
        drawSegment(ctx, { id: dim.id, name: "", start: dim.start, end: dim.end }, S, "rgba(250,204,21,0.95)");
        const mid = S({ x: (dim.start.x + dim.end.x) / 2, y: (dim.start.y + dim.end.y) / 2 });
        ctx.fillStyle = "rgba(253,224,71,0.95)";
        ctx.font = "bold 11px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(dimensionLabel(dim, state.metersPerUnit), mid.x, mid.y - 6);
        ctx.textAlign = "start";
      }
    }

    // elevated structure members
    if (calibrated && isLayerVisible(state, "structure")) {
      for (const member of state.structure.members) {
        if (member.type === "foundation") {
          const x = Math.min(member.start.x, member.end.x);
          const y = Math.min(member.start.y, member.end.y);
          const w = Math.abs(member.end.x - member.start.x);
          const h = Math.abs(member.end.y - member.start.y);
          drawPolygon(ctx, rectVertices(x, y, w, h), S, "rgba(168,85,247,0.2)", "rgba(192,132,252,0.9)");
        } else if (member.type === "column") {
          const c = S(member.start);
          ctx.beginPath();
          ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(251,146,60,0.9)";
          ctx.fill();
        } else {
          const color = member.type === "h-beam" ? "rgba(251,146,60,0.95)" : "rgba(167,139,250,0.95)";
          drawSegment(ctx, member, S, color);
        }
      }
    }

    // scale calibration reference line
    if (state.scaleCalibration) {
      drawSegment(
        ctx,
        { id: "cal", name: "", start: state.scaleCalibration.lineStart, end: state.scaleCalibration.lineEnd },
        S,
        "rgba(52,211,153,0.95)"
      );
    }
    if (pendingCalibrationLine) {
      drawSegment(
        ctx,
        { id: "cal-pending", name: "", start: pendingCalibrationLine.start, end: pendingCalibrationLine.end },
        S,
        "rgba(251,191,36,0.9)"
      );
    }

    // draft polygon
    if (draftPoints.length > 0) {
      ctx.beginPath();
      const s0 = S(draftPoints[0]);
      ctx.moveTo(s0.x, s0.y);
      for (let i = 1; i < draftPoints.length; i += 1) {
        const s = S(draftPoints[i]);
        ctx.lineTo(s.x, s.y);
      }
      const cursorS = S(snap(cursorWorld));
      ctx.lineTo(cursorS.x, cursorS.y);
      ctx.strokeStyle = "rgba(251,191,36,0.9)";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.setLineDash([]);
      for (const p of draftPoints) {
        const s = S(p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#fbbf24";
        ctx.fill();
      }
    }

    // drag shape preview
    if (dragShape) {
      if (tool === "obstacle-rect" || tool === "parapet" || tool === "structure-foundation") {
        const x = Math.min(dragShape.start.x, dragShape.end.x);
        const y = Math.min(dragShape.start.y, dragShape.end.y);
        const color =
          tool === "structure-foundation" ? "rgba(192,132,252,0.9)" : "rgba(251,113,133,0.9)";
        drawPolygonDashed(
          ctx,
          rectVertices(x, y, Math.abs(dragShape.end.x - dragShape.start.x), Math.abs(dragShape.end.y - dragShape.start.y)),
          S,
          color
        );
      } else if (tool === "obstacle-circle") {
        const radius = Math.hypot(dragShape.end.x - dragShape.start.x, dragShape.end.y - dragShape.start.y);
        drawPolygonDashed(ctx, circleVertices(dragShape.start.x, dragShape.start.y, radius), S, "rgba(251,113,133,0.9)");
      } else {
        const color =
          tool === "calibrate-scale"
            ? "rgba(52,211,153,0.95)"
            : tool === "dimension-line"
              ? "rgba(250,204,21,0.95)"
              : tool.startsWith("structure-")
                ? "rgba(251,146,60,0.95)"
                : "rgba(226,232,240,0.9)";
        drawSegment(ctx, { id: "draft", name: "", start: dragShape.start, end: dragShape.end }, S, color);
      }
    }

    // north arrow + compass
    if (isLayerVisible(state, "north")) drawNorthArrow(ctx, w, state.northAzimuthDeg);
    // scale ruler
    drawScaleRuler(ctx, h, viewport.scale, state.metersPerUnit, calibrated);
  }, [
    canvasSize,
    showGrid,
    state,
    viewport,
    worldToScreen,
    draftPoints,
    dragShape,
    tool,
    cursorWorld,
    snap,
    planeMetrics,
    bgImage,
    bgOpacity,
    calibrated,
    pendingCalibrationLine,
    overlayPanels,
    selectedPanelIds,
    hoveredPanelId,
    panelDragCollidingIds,
    marqueeSelect,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  /* ---------------- layer + plane editing UI handlers ---------------- */
  const deleteSelectedPlane = () => {
    if (!selectedPlane) return;
    if (isPlaneGeoLocked()) return;
    apply(removePlane(state, selectedPlane.id));
  };

  const statistics = analysis.statistics;
  const planeLocked = planeGeometryLocked(state);

  return (
    <div className="space-y-4 text-left fade-in-entry">
      {!workspaceMode && (
      <div className="relative overflow-hidden rounded-3xl border border-cyan-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950/30 p-5 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400/25 to-cyan-600/10 border border-cyan-500/30">
            <Sun className="h-6 w-6 text-cyan-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold text-white tracking-tight">Geo-Calibrated Roof Studio</h2>
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300">
                V1
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400 max-w-2xl">
              Real measurements from Google Earth / map imagery. Enter site coordinates, calibrate scale with a ruler line, then draw, dimension, and place panels. No AI guessing. Draft only — no save, API, or PDF export.
            </p>
          </div>
        </div>
      </div>
      )}

      {workspaceMode && !designUnlocked && (
        <div className="studio-gate-note rounded-xl">
          Complete Step 1 (upload image) and Step 2 (calibrate scale) before panels, BOQ, and proposal draft are shown.
        </div>
      )}

      {/* toolbar */}
      <div className="studio-toolbar">
        {(["nav", "calibrate", "roof", "features", "panels", "structure", "measure"] as const).map((group) => (
          <div key={group} className="studio-toolbar-group">
            {TOOLS.filter((t) => t.group === group).map((t) => {
              const Icon = t.icon;
              const active = tool === t.id;
              const scaleRequired = t.group === "panels" || t.group === "structure";
              const disabled = scaleRequired && !designUnlocked;
              return (
                <button
                  key={t.id}
                  type="button"
                  title={disabled ? COMPLETE_PREVIOUS_STEP_MESSAGE : t.label}
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) {
                      setMeasureResult(COMPLETE_PREVIOUS_STEP_MESSAGE);
                      return;
                    }
                    setTool(t.id);
                    setDraftPoints([]);
                    setDragShape(null);
                  }}
                  className={`studio-btn studio-btn-tool ${active ? "studio-btn-tool-active" : ""} disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="hidden lg:inline">{t.label}</span>
                </button>
              );
            })}
          </div>
        ))}

        <div className="studio-toolbar-group">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleImageUpload}
            className="hidden"
          />
          <button
            type="button"
            title="Upload rooftop / Google Earth image (stays on your device)"
            onClick={() => fileInputRef.current?.click()}
            className="studio-btn studio-btn-tool"
          >
            <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="hidden lg:inline">{bgImage ? "Replace image" : "Upload image"}</span>
          </button>
          {bgImage && (
            <>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={bgOpacity}
                onChange={(e) => setBgOpacity(Number(e.target.value))}
                title="Image opacity"
                className="studio-range"
              />
              <button
                type="button"
                title="Remove image"
                onClick={clearBackgroundImage}
                className="studio-btn studio-btn-danger rounded-lg p-2"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          )}
        </div>

        <div className="studio-toolbar-actions">
          {selectedPanelIds.length > 0 && (
            <div className="mr-2 hidden items-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2 py-1 md:flex">
              <span className="text-[10px] font-bold text-amber-200">{selectedPanelIds.length} selected</span>
              <button
                type="button"
                title="Duplicate (Ctrl+D)"
                onClick={() => {
                  const next = duplicatePanels(state.panelPlacements, new Set(selectedPanelIds));
                  const newIds = next.filter((p) => !state.panelPlacements.some((old) => old.id === p.id)).map((p) => p.id);
                  commitPanelPlacements(next, [...selectedPanelIds, ...newIds]);
                }}
                className="rounded-lg p-1 text-amber-100 hover:bg-amber-500/20"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Delete selected panels"
                onClick={() => {
                  const next = removePanels(state.panelPlacements, new Set(selectedPanelIds));
                  setSelectedPanelIds([]);
                  commitPanelPlacements(next);
                }}
                className="rounded-lg p-1 text-amber-100 hover:bg-rose-500/20 hover:text-rose-200"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <button type="button" title="Undo (Ctrl+Z)" disabled={!canUndo(history)} onClick={doUndo} className="studio-btn studio-btn-secondary !p-2 disabled:opacity-30">
            <Undo2 className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" title="Redo (Ctrl+Y)" disabled={!canRedo(history)} onClick={doRedo} className="studio-btn studio-btn-secondary !p-2 disabled:opacity-30">
            <Redo2 className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" title="Toggle grid" onClick={() => setShowGrid((v) => !v)} className={`studio-btn studio-btn-secondary !p-2 ${showGrid ? "studio-btn-tool-active" : ""}`}>
            <Grid3X3 className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" title="Snap to grid" onClick={() => setSnapGrid((v) => !v)} className={`studio-btn studio-btn-secondary !p-2 ${snapGrid ? "studio-btn-tool-active" : ""}`}>
            <Grid3X3 className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" title="Snap to vertices" onClick={() => setSnapVertices((v) => !v)} className={`studio-btn studio-btn-secondary !p-2 ${snapVertices ? "studio-btn-tool-active" : ""}`}>
            <Magnet className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-4 ${canvasOnly ? "" : "xl:grid-cols-12"}`}>
        {/* layers */}
        {!canvasOnly && (
        <div className="xl:col-span-2 space-y-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Layers className="h-4 w-4 text-amber-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-white">Layers</h3>
            </div>
            <ul className="mt-2 space-y-1">
              {LAYER_ORDER.map((type) => {
                const layer = state.layers[type];
                return (
                  <li key={type} className="flex items-center gap-1 rounded-lg px-1 py-1 hover:bg-slate-800/50">
                    <button
                      type="button"
                      title={layer.locked ? "Layer is locked" : "Toggle visibility"}
                      disabled={layer.locked}
                      onClick={() => {
                        if (layer.locked) {
                          warnLocked(layer.name);
                          return;
                        }
                        apply(toggleLayerVisibility(state, type));
                      }}
                      className="text-slate-400 hover:text-white disabled:opacity-30"
                    >
                      {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-slate-600" />}
                    </button>
                    <button type="button" title="Toggle lock" onClick={() => apply(toggleLayerLock(state, type))} className="text-slate-400 hover:text-white">
                      {layer.locked ? <Lock className="h-3.5 w-3.5 text-amber-400" /> : <Unlock className="h-3.5 w-3.5" />}
                    </button>
                    <input
                      value={layer.name}
                      disabled={layer.locked}
                      readOnly={layer.locked}
                      title={layer.locked ? "Layer is locked" : "Rename layer"}
                      onChange={(e) => setPresentTransient(renameLayer(state, type, e.target.value))}
                      onBlur={(e) => apply(renameLayer(state, type, e.target.value))}
                      className="min-w-0 flex-1 bg-transparent text-[11px] text-slate-200 outline-none disabled:opacity-40"
                    />
                    <button
                      type="button"
                      title={layer.locked ? "Layer is locked" : "Delete layer contents"}
                      disabled={type === "plane" || type === "boundary" ? planeGeometryLocked(state) : isLayerLocked(state, type)}
                      onClick={() => {
                        const planeLike = type === "plane" || type === "boundary";
                        const blocked = planeLike ? planeGeometryLocked(state) : isLayerLocked(state, type);
                        if (blocked) {
                          warnLocked(layer.name);
                          return;
                        }
                        apply(clearLayer(state, type));
                      }}
                      className="text-slate-500 hover:text-rose-400 disabled:opacity-30 disabled:hover:text-slate-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
        )}

        {/* canvas */}
        <div className={`${canvasOnly ? "" : "xl:col-span-7"} space-y-2`}>
          <div ref={containerRef} className="studio-canvas-frame">
            <canvas
              ref={canvasRef}
              width={canvasSize.w}
              height={canvasSize.h}
              className={`w-full touch-none ${isPanMode ? "cursor-grab" : "cursor-crosshair"}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onDoubleClick={handleDoubleClick}
              onWheel={handleWheel}
            />
          </div>

          {/* status bar */}
          <div className="studio-status-bar">
            <span>Zoom {Math.round(viewport.scale * 100)}%</span>
            <span>x {fmt(cursorWorld.x, 0)} · y {fmt(cursorWorld.y, 0)}</span>
            <span>Selected: {selectedPlane ? selectedPlane.name : "none"}</span>
            <span>Area: {calibrated && statistics ? `${fmt(statistics.grossAreaM2, 1)} m²` : "—"}</span>
            <span>Scale: {calibrated ? `1u = ${fmt(state.metersPerUnit, 4)} m` : "not calibrated"}</span>
            <span>North: {fmt(state.northAzimuthDeg, 0)}°</span>
            {bgImage && <span className="studio-status-highlight">img: {bgImage.fileName}</span>}
            {measureResult && <span className="studio-status-highlight">{measureResult}</span>}
            {tool === "select" && selectedPanelIds.length > 0 && (
              <span className="studio-status-highlight">
                Panels: drag · Shift-click multi-select · R rotate · Del delete · Ctrl+C/V/D copy/paste/duplicate
              </span>
            )}
            {imageError && <span className="studio-status-error">{imageError}</span>}
          </div>
        </div>

        {/* right sidebar */}
        {!canvasOnly && (
        <div className="xl:col-span-3 space-y-3">
          <CalibrationWizard
            hasImage={hasImage}
            calibrated={calibrated}
            hasCompletePlane={hasCompletePlane}
            hasPanels={hasPanels}
            hasBoq={hasBoq}
            onGoToStep={handleWizardStep}
            title={workspaceMode ? "Project design steps" : "Geo-calibration wizard"}
          />

          <GeoReferenceEditor
            geo={state.geoReference}
            northAzimuthDeg={state.northAzimuthDeg}
            geoError={geoError}
            onChange={(geoReference) => apply({ ...state, geoReference })}
            onNorthChange={(northAzimuthDeg) => apply({ ...state, northAzimuthDeg })}
            onValidationError={(error) => setMeasureResult(error)}
          />

          <CalibrationBanner
            calibrated={calibrated}
            calibration={state.scaleCalibration}
            metersPerUnit={state.metersPerUnit}
            onOpenCalibrate={() => {
              setTool("calibrate-scale");
              setMeasureResult("Draw a line over a known roof distance, then enter the real length.");
            }}
          />

          {selectedPlane && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Selected Plane</h3>
                {planeLocked && <span className="text-[9px] font-bold uppercase text-amber-400">Locked</span>}
              </div>
              <label className="block text-[10px] text-slate-500">Name
                <input disabled={planeLocked} value={selectedPlane.name} onChange={(e) => setPresentTransient(updatePlane(state, selectedPlane.id, { name: e.target.value }))} onBlur={(e) => apply(updatePlane(state, selectedPlane.id, { name: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[10px] text-slate-500">Pitch°
                  <input type="number" min={0} max={60} disabled={planeLocked} value={selectedPlane.pitchDeg} onChange={(e) => apply(updatePlane(state, selectedPlane.id, { pitchDeg: Number(e.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
                </label>
                <label className="block text-[10px] text-slate-500">Azimuth°
                  <input type="number" min={0} max={360} disabled={planeLocked} value={selectedPlane.azimuthDeg} onChange={(e) => apply(updatePlane(state, selectedPlane.id, { azimuthDeg: Number(e.target.value) }))} className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white disabled:opacity-40" />
                </label>
              </div>
              {calibrated &&
                (() => {
                  const m = planeMetrics.get(selectedPlane.id);
                  if (!m) return null;
                  return (
                    <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                      <Stat label="Orientation" value={m.orientation} />
                      <Stat label="Slope" value={`${fmt(m.pitchDeg, 0)}°`} />
                      <Stat label="Usable" value={`${fmt(m.netUsableAreaM2, 1)} m²`} />
                      <Stat label="True area" value={`${fmt(m.trueAreaM2, 1)} m²`} />
                    </div>
                  );
                })()}
              <div className="flex gap-1.5">
                <button type="button" disabled={planeLocked} onClick={insertVertexAtCursor} className="flex-1 rounded-lg border border-slate-800 px-2 py-1 text-[10px] font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-40">Insert point</button>
                <button type="button" disabled={planeLocked} onClick={deleteSelectedPlane} className="flex-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] font-bold text-rose-300 disabled:opacity-40">Delete plane</button>
              </div>
              <p className="text-[9px] text-slate-500">In Select mode: drag vertices to move; select a vertex and press Delete to remove.</p>
            </div>
          )}

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Roof Statistics</h3>
            {!calibrated ? (
              <p className="text-[11px] text-amber-400/90">
                Calibrate scale to unlock area, panel capacity, and BOQ. Draw a roof plane first, then use Calibrate Scale.
              </p>
            ) : analysis.error ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-300">
                <p className="font-bold">Validation error: {analysis.error.errorCode}</p>
                <p>{analysis.error.message}</p>
                {analysis.error.edgeIndexes && <p className="mt-1 font-mono">edges {analysis.error.edgeIndexes.join(" ↔ ")}</p>}
              </div>
            ) : statistics ? (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <Stat label="Gross area" value={`${fmt(statistics.grossAreaM2, 1)} m²`} big />
                <Stat label="Usable area" value={`${fmt(statistics.usableAreaM2, 1)} m²`} big />
                <Stat label="True area" value={`${fmt(statistics.trueAreaM2, 1)} m²`} />
                <Stat label="Obstacle %" value={`${fmt(statistics.obstaclePercent, 1)}%`} />
                <Stat label="Placed panels" value={`${panelCount}`} />
                <Stat label="Placed kW" value={`${fmt(systemKw, 2)} kW`} />
                <Stat label="Planes" value={`${statistics.planeCount}`} />
              </div>
            ) : (
              <p className="text-[11px] text-slate-500">Draw a closed roof plane (≥3 points) to see live statistics.</p>
            )}

            {calibrated && statistics && statistics.warnings.length > 0 && (
              <ul className="space-y-1 border-t border-slate-800 pt-2">
                {statistics.warnings.map((w) => (
                  <li key={w} className="text-[10px] text-amber-400/90">• {w}</li>
                ))}
              </ul>
            )}
          </div>

          {calibrated && state.dimensionAnnotations.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Dimensions</h3>
              <ul className="space-y-2">
                {state.dimensionAnnotations.map((dim) => (
                  <li key={dim.id} className="text-[10px]">
                    <div className="text-slate-500">{dimensionLabel(dim, state.metersPerUnit)}</div>
                    <input
                      value={dim.labelOverride ?? ""}
                      placeholder="Manual label override"
                      onChange={(e) =>
                        setPresentTransient({
                          ...state,
                          dimensionAnnotations: updateDimensionLabel(state.dimensionAnnotations, dim.id, e.target.value),
                        })
                      }
                      onBlur={(e) =>
                        apply({
                          ...state,
                          dimensionAnnotations: updateDimensionLabel(state.dimensionAnnotations, dim.id, e.target.value),
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-white"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {calibrated && selectedPlane && (
            <button
              type="button"
              onClick={() => {
                const segments = planeBoundarySegmentDimensions(selectedPlane.boundary, selectedPlane.name);
                apply({
                  ...state,
                  dimensionAnnotations: mergeSegmentDimensions(state.dimensionAnnotations, segments),
                });
                setMeasureResult(`Added ${segments.length} roof segment labels.`);
              }}
              className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] font-bold text-amber-200"
            >
              Label roof segments (layout PDF style)
            </button>
          )}

          <PanelSpecEditor
            spec={state.panelSpec}
            calibrated={designUnlocked}
            onChange={(panelSpec) => apply({ ...state, panelSpec })}
            onAutoFill={handleAutoFillPanels}
            panelCount={panelCount}
            systemKw={systemKw}
          />

          {designUnlocked ? (
            <>
              <StructureEditor
                structure={state.structure}
                calibrated={calibrated}
                onChange={(structure) => {
                  const boqLines =
                    state.panelPlacements.length > 0
                      ? boqFromPlacements(state.panelPlacements, structure, state.panelSpec.wattage)
                      : state.boqLines;
                  apply({ ...state, structure, boqLines });
                }}
              />

              {hasPanels ? (
                <BoqEditor
                  lines={state.boqLines}
                  calibrated={calibrated}
                  onUpdate={(result) => {
                    if (result.warning) setMeasureResult(result.warning);
                    apply({ ...state, boqLines: result.lines });
                  }}
                />
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">BOQ Preview</h3>
                  <p className="mt-2 text-[10px] text-amber-400/90">{COMPLETE_PREVIOUS_STEP_MESSAGE}</p>
                  <p className="mt-1 text-[9px] text-slate-500">Complete Step 4 (auto layout panels) first.</p>
                </div>
              )}

              {hasBoq ? (
                <ReportPreview pages={reportPages} calibrated={calibrated} />
              ) : (
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Proposal Draft</h3>
                  <p className="mt-2 text-[10px] text-amber-400/90">{COMPLETE_PREVIOUS_STEP_MESSAGE}</p>
                  <p className="mt-1 text-[9px] text-slate-500">Complete Step 5 (BOQ preview) first. Layout report uses existing BOQ/report engine only.</p>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-white">Panels / BOQ / Proposal</h3>
              <p className="text-[10px] text-amber-400/90">{COMPLETE_PREVIOUS_STEP_MESSAGE}</p>
              <p className="text-[9px] text-slate-500">
                Upload an image and calibrate scale to unlock auto layout, BOQ preview, and proposal draft.
              </p>
            </div>
          )}
        </div>
        )}
      </div>

      <CalibrationDialog
        open={calibrationDialogOpen}
        distanceInput={calibrationDistanceInput}
        onDistanceChange={setCalibrationDistanceInput}
        onApply={handleApplyCalibration}
        onCancel={() => {
          setCalibrationDialogOpen(false);
          setPendingCalibrationLine(null);
        }}
      />
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-bold text-white ${big ? "text-base" : "text-xs"}`}>{value}</div>
    </div>
  );
}

/* ---------------- canvas draw helpers ---------------- */
function drawPolygon(ctx: CanvasRenderingContext2D, verts: Point2D[], S: (p: Point2D) => Point2D, fill: string, stroke: string) {
  if (verts.length < 2) return;
  ctx.beginPath();
  const s0 = S(verts[0]);
  ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < verts.length; i += 1) {
    const s = S(verts[i]);
    ctx.lineTo(s.x, s.y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawPolygonDashed(ctx: CanvasRenderingContext2D, verts: Point2D[], S: (p: Point2D) => Point2D, stroke: string) {
  if (verts.length < 2) return;
  ctx.beginPath();
  const s0 = S(verts[0]);
  ctx.moveTo(s0.x, s0.y);
  for (let i = 1; i < verts.length; i += 1) {
    const s = S(verts[i]);
    ctx.lineTo(s.x, s.y);
  }
  ctx.closePath();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSegment(ctx: CanvasRenderingContext2D, line: StudioLine, S: (p: Point2D) => Point2D, stroke: string) {
  const a = S(line.start);
  const b = S(line.end);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function centroidScreen(verts: Point2D[], S: (p: Point2D) => Point2D): Point2D {
  let x = 0;
  let y = 0;
  for (const v of verts) {
    const s = S(v);
    x += s.x;
    y += s.y;
  }
  return { x: x / verts.length, y: y / verts.length };
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, canvasWidth: number, northAzimuthDeg: number) {
  const cx = canvasWidth - 46;
  const cy = 46;
  const rad = (northAzimuthDeg * Math.PI) / 180;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad);
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(7, 8);
  ctx.lineTo(0, 2);
  ctx.lineTo(-7, 8);
  ctx.closePath();
  ctx.fillStyle = "rgba(56,189,248,0.95)";
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "rgba(226,232,240,0.9)";
  ctx.font = "bold 11px ui-sans-serif, system-ui";
  ctx.textAlign = "center";
  ctx.fillText("N", cx, cy + 24);
  ctx.textAlign = "start";
}

function drawScaleRuler(
  ctx: CanvasRenderingContext2D,
  canvasHeight: number,
  scale: number,
  metersPerUnit: number,
  calibrated: boolean
) {
  const y = canvasHeight - 24;
  const x = 20;
  if (!calibrated || metersPerUnit <= 0) {
    ctx.fillStyle = "rgba(251,191,36,0.85)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("Scale not calibrated", x, y - 8);
    return;
  }
  const targetPx = 120;
  const worldUnits = targetPx / scale;
  const meters = worldUnits * metersPerUnit;
  ctx.strokeStyle = "rgba(226,232,240,0.7)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + targetPx, y);
  ctx.moveTo(x, y - 4);
  ctx.lineTo(x, y + 4);
  ctx.moveTo(x + targetPx, y - 4);
  ctx.lineTo(x + targetPx, y + 4);
  ctx.stroke();
  ctx.fillStyle = "rgba(226,232,240,0.8)";
  ctx.font = "10px ui-monospace, monospace";
  ctx.fillText(`${meters.toLocaleString(undefined, { maximumFractionDigits: 1 })} m`, x + targetPx / 2 - 12, y - 8);
}
