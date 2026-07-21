/**
 * Geo-Calibrated Roof Studio — coordinate reference model.
 * Canvas pixels ↔ local meters ↔ optional GPS anchor. No guessed scale.
 */

import type { Point2D } from "../../server/solar/roof/RoofModels.ts";
import { requireValidScale } from "./roofStudioCalibration.ts";
import type { ScaleCalibration } from "./roofStudioCalibration.ts";

export interface SiteGeoReference {
  siteLabel: string;
  latitude: number | null;
  longitude: number | null;
  /** Optional map zoom when screenshot was captured */
  mapZoom: number | null;
}

export interface GpsAnchor {
  latitude: number;
  longitude: number;
}

export interface RoofCoordinateFrame {
  metersPerUnit: number;
  northAzimuthDeg: number;
  geo: SiteGeoReference;
}

export const DEFAULT_SITE_GEO: SiteGeoReference = {
  siteLabel: "",
  latitude: null,
  longitude: null,
  mapZoom: null,
};

const METERS_PER_DEG_LAT = 111_320;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type GpsAnchorParseResult =
  | { ok: true; anchor: GpsAnchor | undefined }
  | { ok: false; error: string };

export type GeoGpsUpdateResult =
  | { ok: true; geo: SiteGeoReference }
  | { ok: false; error: string; geo: SiteGeoReference };

export class RoofGeoCalibrationError extends Error {
  readonly code = "INVALID_GEO_CALIBRATION" as const;
  constructor(message: string) {
    super(message);
    this.name = "RoofGeoCalibrationError";
  }
}

/** @deprecated Use RoofGeoCalibrationError */
export const RoofGeoReferenceError = RoofGeoCalibrationError;

export function validateLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function validateLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function validateNorthAzimuth(deg: number): boolean {
  return Number.isFinite(deg);
}

export function validateMapZoom(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= 0 && zoom <= 24;
}

function isEmptyField(text: string): boolean {
  return text.trim() === "";
}

function parseFiniteNumberText(input: string, label: string): ParseResult<number> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: `${label} cannot be empty.` };
  }
  const v = Number(trimmed);
  if (!Number.isFinite(v)) {
    return { ok: false, error: `${label} must be a finite number.` };
  }
  return { ok: true, value: v };
}

export function parseLatitudeText(input: string): ParseResult<number> {
  const num = parseFiniteNumberText(input, "Latitude");
  if (!num.ok) return num;
  if (!validateLatitude(num.value)) {
    return { ok: false, error: "Latitude must be between -90 and 90." };
  }
  return num;
}

export function parseLongitudeText(input: string): ParseResult<number> {
  const num = parseFiniteNumberText(input, "Longitude");
  if (!num.ok) return num;
  if (!validateLongitude(num.value)) {
    return { ok: false, error: "Longitude must be between -180 and 180." };
  }
  return num;
}

/**
 * Parse optional GPS anchor from raw field text.
 * Empty strings => no anchor. Non-empty invalid values => fail (never null-out).
 */
export function parseOptionalGpsAnchor(latText: string, lngText: string): GpsAnchorParseResult {
  const latEmpty = isEmptyField(latText);
  const lngEmpty = isEmptyField(lngText);

  if (latEmpty && lngEmpty) {
    return { ok: true, anchor: undefined };
  }
  if (latEmpty !== lngEmpty) {
    return { ok: false, error: "Latitude and longitude must both be set or both empty." };
  }

  const lat = parseLatitudeText(latText);
  if (!lat.ok) return { ok: false, error: lat.error };

  const lng = parseLongitudeText(lngText);
  if (!lng.ok) return { ok: false, error: lng.error };

  return { ok: true, anchor: { latitude: lat.value, longitude: lng.value } };
}

export function parseOptionalMapZoomText(input: string): ParseResult<number | null> {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, value: null };
  const num = parseFiniteNumberText(trimmed, "Map zoom");
  if (!num.ok) return num;
  if (!validateMapZoom(num.value)) {
    return { ok: false, error: "Map zoom must be between 0 and 24." };
  }
  return { ok: true, value: num.value };
}

export function gpsAnchorToGeoFields(anchor: GpsAnchor | undefined): Pick<SiteGeoReference, "latitude" | "longitude"> {
  if (anchor === undefined) {
    return { latitude: null, longitude: null };
  }
  return { latitude: anchor.latitude, longitude: anchor.longitude };
}

export function applyGpsAnchorToGeo(geo: SiteGeoReference, anchor: GpsAnchor | undefined): SiteGeoReference {
  return { ...geo, ...gpsAnchorToGeoFields(anchor) };
}

/** Fail-closed GPS anchor update from field text; keeps prior geo on parse failure. */
export function tryApplyGpsAnchorTexts(
  geo: SiteGeoReference,
  latText: string,
  lngText: string
): GeoGpsUpdateResult {
  const parsed = parseOptionalGpsAnchor(latText, lngText);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, geo };
  }
  return { ok: true, geo: applyGpsAnchorToGeo(geo, parsed.anchor) };
}

export function gpsAnchorLatText(geo: SiteGeoReference): string {
  return geo.latitude === null ? "" : String(geo.latitude);
}

export function gpsAnchorLngText(geo: SiteGeoReference): string {
  return geo.longitude === null ? "" : String(geo.longitude);
}

/** Fail-closed validation for committed GPS anchor + site metadata. */
export function validateSiteGeoReference(geo: SiteGeoReference): string | null {
  if (typeof geo.siteLabel !== "string") return "Site label must be text.";
  const hasLat = geo.latitude !== null && geo.latitude !== undefined;
  const hasLng = geo.longitude !== null && geo.longitude !== undefined;
  if (hasLat !== hasLng) return "Latitude and longitude must both be set or both empty.";
  if (hasLat && hasLng) {
    if (!validateLatitude(geo.latitude!)) return "Latitude must be between -90 and 90.";
    if (!validateLongitude(geo.longitude!)) return "Longitude must be between -180 and 180.";
  }
  if (geo.mapZoom !== null && geo.mapZoom !== undefined && !validateMapZoom(geo.mapZoom)) {
    return "Map zoom must be between 0 and 24.";
  }
  return null;
}

function assertValidGpsOutput(point: { latitude: number; longitude: number }): {
  latitude: number;
  longitude: number;
} {
  if (!validateLatitude(point.latitude) || !validateLongitude(point.longitude)) {
    throw new RoofGeoCalibrationError(
      `GPS conversion out of bounds (lat=${point.latitude}, lng=${point.longitude}).`
    );
  }
  return point;
}

function rotateYUp(point: Point2D, deg: number): Point2D {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

/** Canvas units (image pixels as world units) → local east/north meters. */
export function canvasUnitsToLocalMeters(
  canvas: Point2D,
  frame: Pick<RoofCoordinateFrame, "metersPerUnit" | "northAzimuthDeg">
): { eastM: number; northM: number } {
  const mpu = requireValidScale(frame.metersPerUnit);
  if (!validateNorthAzimuth(frame.northAzimuthDeg)) {
    throw new RoofGeoCalibrationError("North orientation must be a finite number.");
  }
  const mathYUp = { x: canvas.x, y: -canvas.y };
  const aligned = rotateYUp(mathYUp, frame.northAzimuthDeg);
  return { eastM: aligned.x * mpu, northM: aligned.y * mpu };
}

/** Local east/north meters → canvas units (inverse of canvasUnitsToLocalMeters). */
export function localMetersToCanvasUnits(
  local: { eastM: number; northM: number },
  frame: Pick<RoofCoordinateFrame, "metersPerUnit" | "northAzimuthDeg">
): Point2D {
  const mpu = requireValidScale(frame.metersPerUnit);
  if (!validateNorthAzimuth(frame.northAzimuthDeg)) {
    throw new RoofGeoCalibrationError("North orientation must be a finite number.");
  }
  const units = { x: local.eastM / mpu, y: local.northM / mpu };
  const unaligned = rotateYUp(units, -frame.northAzimuthDeg);
  return { x: unaligned.x, y: -unaligned.y };
}

export function localMetersToGps(
  local: { eastM: number; northM: number },
  anchor: { latitude: number; longitude: number }
): { latitude: number; longitude: number } {
  if (!validateLatitude(anchor.latitude) || !validateLongitude(anchor.longitude)) {
    throw new RoofGeoCalibrationError("GPS anchor coordinates are invalid.");
  }
  const dLat = local.northM / METERS_PER_DEG_LAT;
  const cosLat = Math.cos((anchor.latitude * Math.PI) / 180);
  const dLng = cosLat !== 0 ? local.eastM / (METERS_PER_DEG_LAT * cosLat) : 0;
  return assertValidGpsOutput({
    latitude: anchor.latitude + dLat,
    longitude: anchor.longitude + dLng,
  });
}

export function gpsToLocalMeters(
  point: { latitude: number; longitude: number },
  anchor: { latitude: number; longitude: number }
): { eastM: number; northM: number } {
  if (!validateLatitude(point.latitude) || !validateLongitude(point.longitude)) {
    throw new RoofGeoCalibrationError("GPS coordinates are invalid.");
  }
  if (!validateLatitude(anchor.latitude) || !validateLongitude(anchor.longitude)) {
    throw new RoofGeoCalibrationError("GPS anchor coordinates are invalid.");
  }
  const northM = (point.latitude - anchor.latitude) * METERS_PER_DEG_LAT;
  const cosLat = Math.cos((anchor.latitude * Math.PI) / 180);
  const eastM = (point.longitude - anchor.longitude) * METERS_PER_DEG_LAT * cosLat;
  return { eastM, northM };
}

export function canvasUnitsToGps(
  canvas: Point2D,
  frame: RoofCoordinateFrame
): { latitude: number; longitude: number } | null {
  if (frame.geo.latitude === null || frame.geo.longitude === null) return null;
  const local = canvasUnitsToLocalMeters(canvas, frame);
  return localMetersToGps(local, { latitude: frame.geo.latitude, longitude: frame.geo.longitude });
}

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export const WIZARD_STEP_LABELS: Record<WizardStep, string> = {
  1: "Upload Image",
  2: "Calibrate Scale",
  3: "Draw Roof",
  4: "Auto Layout Panels",
  5: "BOQ Preview",
  6: "Proposal Draft",
};

export const COMPLETE_PREVIOUS_STEP_MESSAGE = "Complete previous step first.";

/** Image uploaded and scale calibrated — unlocks panels / BOQ / proposal surfaces. */
export function isDesignWorkspaceUnlocked(hasImage: boolean, calibrated: boolean): boolean {
  return hasImage && calibrated;
}

export function canEnterWizardStep(
  step: WizardStep,
  opts: {
    hasImage: boolean;
    calibrated: boolean;
    hasCompletePlane: boolean;
    hasPanels: boolean;
    hasBoq: boolean;
  }
): boolean {
  if (step === 1) return true;
  if (step === 2) return opts.hasImage;
  if (step === 3) return opts.hasImage && opts.calibrated;
  if (step === 4) return opts.hasImage && opts.calibrated && opts.hasCompletePlane;
  if (step === 5) return opts.hasImage && opts.calibrated && opts.hasCompletePlane && opts.hasPanels;
  return (
    opts.hasImage &&
    opts.calibrated &&
    opts.hasCompletePlane &&
    opts.hasPanels &&
    opts.hasBoq
  );
}

export function deriveWizardProgress(opts: {
  hasImage: boolean;
  calibrated: boolean;
  hasCompletePlane: boolean;
  hasPanels: boolean;
  hasBoq?: boolean;
}): { currentStep: WizardStep; completedThrough: number } {
  const hasBoq = Boolean(opts.hasBoq);
  if (!opts.hasImage) return { currentStep: 1, completedThrough: 0 };
  if (!opts.calibrated) return { currentStep: 2, completedThrough: 1 };
  if (!opts.hasCompletePlane) return { currentStep: 3, completedThrough: 2 };
  if (!opts.hasPanels) return { currentStep: 4, completedThrough: 3 };
  if (!hasBoq) return { currentStep: 5, completedThrough: 4 };
  return { currentStep: 6, completedThrough: 5 };
}

export function isGeoCalibratedStudio(
  calibration: ScaleCalibration | null | undefined,
  metersPerUnit: number,
  geo: SiteGeoReference
): boolean {
  try {
    requireValidScale(metersPerUnit);
    if (!calibration?.calibrated) return false;
    return validateSiteGeoReference(geo) === null;
  } catch {
    return false;
  }
}
