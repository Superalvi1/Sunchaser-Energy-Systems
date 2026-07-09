/**
 * PSA / Michalsky-style sun position for each hour of year.
 */

import { HOURS_PER_YEAR, hourToMonthDay, round4 } from "./SolarSimulationModels.ts";

const DEG = Math.PI / 180;

export interface SunPositionHour {
  zenithDeg: number;
  elevationDeg: number;
  azimuthDeg: number;
  declinationDeg: number;
  hourAngleDeg: number;
}

function dayOfYear(month: number, day: number): number {
  const md = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return md[Math.max(0, Math.min(11, month))] + Math.max(1, day);
}

/** PSA declination (radians). */
export function psaDeclinationRad(dayOfYear: number): number {
  const n = Math.max(1, Math.min(365, dayOfYear));
  const gamma = (2 * Math.PI / 365) * (n - 1);
  return (
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  );
}

export function sunPositionForHour(
  latitudeDeg: number,
  longitudeDeg: number,
  hourIndex: number,
  timezoneOffsetHours: number
): SunPositionHour {
  const { month, day, hour } = hourToMonthDay(hourIndex);
  const n = dayOfYear(month, day);
  const decl = psaDeclinationRad(n);
  const lat = latitudeDeg * DEG;

  const solarTime = hour + 0.5 + (longitudeDeg - timezoneOffsetHours * 15) / 15;
  const ha = (solarTime - 12) * 15 * DEG;

  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const elevation = Math.PI / 2 - zenith;

  let azimuth = Math.PI;
  if (Math.sin(zenith) > 1e-9) {
    const cosAz = (Math.sin(decl) - Math.sin(lat) * Math.cos(zenith)) / (Math.cos(lat) * Math.sin(zenith) + 1e-12);
    azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (Math.sin(ha) > 0) azimuth = 2 * Math.PI - azimuth;
  }

  return {
    zenithDeg: round4((zenith / DEG)),
    elevationDeg: round4(Math.max(0, elevation / DEG)),
    azimuthDeg: round4(((azimuth / DEG) + 360) % 360),
    declinationDeg: round4(decl / DEG),
    hourAngleDeg: round4(ha / DEG),
  };
}

export function buildSunPositionSeries(
  latitudeDeg: number,
  longitudeDeg: number,
  timezoneOffsetHours: number
): SunPositionHour[] {
  const series: SunPositionHour[] = new Array(HOURS_PER_YEAR);
  for (let h = 0; h < HOURS_PER_YEAR; h += 1) {
    series[h] = sunPositionForHour(latitudeDeg, longitudeDeg, h, timezoneOffsetHours);
  }
  return series;
}

export function cosIncidenceAngle(
  sunZenithDeg: number,
  sunAzimuthDeg: number,
  tiltDeg: number,
  surfaceAzimuthDeg: number
): number {
  const z = (sunZenithDeg * DEG);
  const sa = (sunAzimuthDeg * DEG);
  const t = (tiltDeg * DEG);
  const a = (surfaceAzimuthDeg * DEG);
  return (
    Math.cos(z) * Math.cos(t) +
    Math.sin(z) * Math.sin(t) * Math.cos(sa - a)
  );
}

export function assertSunElevationBounds(pos: SunPositionHour): boolean {
  return (
    Number.isFinite(pos.elevationDeg) &&
    Number.isFinite(pos.zenithDeg) &&
    pos.elevationDeg >= 0 &&
    pos.elevationDeg <= 90 &&
    pos.zenithDeg >= 0 &&
    pos.zenithDeg <= 180
  );
}
