/**
 * Satellite preview viewport — pan/zoom/recenter with provider fetch.
 * No fake imagery. Draft-only preview before loading on design canvas.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Crosshair,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
} from "lucide-react";
import {
  SATELLITE_PROVIDER_NOT_CONNECTED,
  fetchSatelliteImage,
  getMapProviderStatusLabel,
  isSatelliteProviderConfigured,
  resolveSatelliteDisplayUrl,
  type SatelliteImage,
} from "../../lib/designStudioMapProviders";
import {
  createSatelliteViewportState,
  panViewport,
  recenterViewport,
  updateViewportAnchor,
  viewportFetchInput,
  zoomViewport,
  type PanDirection,
  type SatelliteViewportState,
} from "../../lib/satelliteViewportState";

export interface DesignStudioSatelliteViewportProps {
  latitude: number;
  longitude: number;
  onApplyToCanvas: (image: SatelliteImage, displayUrl: string) => void;
  applyLabel?: string;
}

function ControlBtn({
  label,
  onClick,
  disabled,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {children ?? label}
    </button>
  );
}

export default function DesignStudioSatelliteViewport({
  latitude,
  longitude,
  onApplyToCanvas,
  applyLabel = "Load on design canvas",
}: DesignStudioSatelliteViewportProps) {
  const [viewport, setViewport] = useState<SatelliteViewportState>(() =>
    createSatelliteViewportState({ latitude, longitude })
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [lastImage, setLastImage] = useState<SatelliteImage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchGen = useRef(0);

  const satelliteConfigured = (() => {
    try {
      return isSatelliteProviderConfigured();
    } catch {
      return false;
    }
  })();

  const providerLabel = (() => {
    try {
      return getMapProviderStatusLabel();
    } catch {
      return SATELLITE_PROVIDER_NOT_CONNECTED;
    }
  })();

  useEffect(() => {
    setViewport((prev) => updateViewportAnchor(prev, latitude, longitude, true));
  }, [latitude, longitude]);

  const runFetch = useCallback(async (state: SatelliteViewportState) => {
    if (!satelliteConfigured) {
      setError(SATELLITE_PROVIDER_NOT_CONNECTED);
      setImageUrl(null);
      return;
    }
    const gen = ++fetchGen.current;
    setLoading(true);
    setError(null);
    const result = await fetchSatelliteImage(viewportFetchInput(state));
    if (gen !== fetchGen.current) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      setImageUrl(null);
      setLastImage(null);
      return;
    }
    const url = resolveSatelliteDisplayUrl(result.image);
    if (!url) {
      setError("Provider returned an invalid satellite image.");
      setImageUrl(null);
      setLastImage(null);
      return;
    }
    setImageUrl(url);
    setLastImage(result.image);
    setError(null);
  }, [satelliteConfigured]);

  useEffect(() => {
    if (!satelliteConfigured) {
      setError(SATELLITE_PROVIDER_NOT_CONNECTED);
      return;
    }
    void runFetch(viewport);
  }, [viewport, satelliteConfigured, runFetch]);

  const pan = (direction: PanDirection) => {
    setViewport((s) => panViewport(s, direction));
  };

  const zoom = (delta: 1 | -1) => {
    setViewport((s) => zoomViewport(s, delta));
  };

  const recenter = () => {
    setViewport((s) => recenterViewport(s));
  };

  const retry = () => {
    void runFetch(viewport);
  };

  const apply = () => {
    if (!lastImage || !imageUrl) return;
    onApplyToCanvas(lastImage, imageUrl);
  };

  return (
    <div
      className="rounded-2xl border border-slate-800 bg-slate-950/90 overflow-hidden"
      data-testid="design-studio-satellite-viewport"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-white">Satellite preview</p>
          <p className="text-[9px] text-slate-500" data-testid="satellite-viewport-provider-status">
            Provider: {satelliteConfigured ? providerLabel : SATELLITE_PROVIDER_NOT_CONNECTED}
          </p>
        </div>
        <p className="text-[9px] font-mono text-slate-400" data-testid="satellite-viewport-zoom">
          Zoom {viewport.zoom}
        </p>
      </div>

      <div className="relative aspect-square max-h-[420px] w-full bg-slate-900">
        {imageUrl && !loading && (
          <img
            src={imageUrl}
            alt="Satellite preview"
            className="h-full w-full object-cover"
            data-testid="satellite-viewport-image"
          />
        )}
        {!imageUrl && !loading && !error && (
          <div className="flex h-full min-h-[240px] items-center justify-center text-[11px] text-slate-500">
            No satellite image loaded
          </div>
        )}
        {loading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/70"
            data-testid="satellite-viewport-loading"
          >
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" aria-hidden />
            <span className="text-[11px] text-slate-300">Loading satellite imagery…</span>
          </div>
        )}
        {error && !loading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-950/85 px-4 text-center"
            data-testid="satellite-viewport-error"
            role="alert"
          >
            <p className="text-[11px] text-rose-300">{error}</p>
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[10px] font-bold text-rose-200 hover:bg-rose-500/20"
              data-testid="satellite-viewport-retry"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-3 py-2">
        <div className="flex items-center gap-1" data-testid="satellite-viewport-pan-controls">
          <ControlBtn label="Pan north" testId="satellite-pan-north" onClick={() => pan("north")} disabled={loading}>
            ↑
          </ControlBtn>
          <ControlBtn label="Pan west" testId="satellite-pan-west" onClick={() => pan("west")} disabled={loading}>
            ←
          </ControlBtn>
          <ControlBtn label="Pan east" testId="satellite-pan-east" onClick={() => pan("east")} disabled={loading}>
            →
          </ControlBtn>
          <ControlBtn label="Pan south" testId="satellite-pan-south" onClick={() => pan("south")} disabled={loading}>
            ↓
          </ControlBtn>
        </div>
        <div className="flex items-center gap-1">
          <ControlBtn
            label="Zoom out"
            testId="satellite-zoom-out"
            onClick={() => zoom(-1)}
            disabled={loading || viewport.zoom <= 16}
          >
            <Minus className="h-4 w-4" />
          </ControlBtn>
          <ControlBtn
            label="Zoom in"
            testId="satellite-zoom-in"
            onClick={() => zoom(1)}
            disabled={loading || viewport.zoom >= 22}
          >
            <Plus className="h-4 w-4" />
          </ControlBtn>
          <ControlBtn label="Recenter on property" testId="satellite-recenter" onClick={recenter} disabled={loading}>
            <Crosshair className="h-4 w-4" />
          </ControlBtn>
        </div>
      </div>

      <div className="border-t border-slate-800 px-3 py-2">
        <button
          type="button"
          disabled={!lastImage || !imageUrl || loading}
          onClick={apply}
          className="w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10px] font-bold text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed"
          data-testid="satellite-apply-to-canvas"
        >
          {applyLabel}
        </button>
      </div>
    </div>
  );
}
