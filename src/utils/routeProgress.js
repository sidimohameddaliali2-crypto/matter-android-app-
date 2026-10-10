// Pure geometry helpers for the Route Navigator screen. Ported from the
// Claude Design "Route Navigator.html" prototype's own <script> (dist/
// bearing/cumulate were plain math there too, no Leaflet dependency) — the
// one addition here is nearestPointOnPolyline, needed because progress now
// comes from the driver's real GPS position instead of a simulated scalar.

const EARTH_RADIUS_M = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

// Haversine distance in meters between two {latitude,longitude} points.
export function distanceMeters(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(x));
}

// Compass bearing in degrees [0, 360) from point a to point b.
export function bearing(a, b) {
  const y = Math.sin(toRad(b.longitude - a.longitude)) * Math.cos(toRad(b.latitude));
  const x =
    Math.cos(toRad(a.latitude)) * Math.sin(toRad(b.latitude)) -
    Math.sin(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.cos(toRad(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Cumulative distance (meters) at each point of a polyline, cumulative[0] = 0.
export function cumulativeDistances(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + distanceMeters(points[i - 1], points[i]));
  }
  return cum;
}

// Projects `position` onto the closest point of segment [a, b], returning
// { point, distanceAlongSegment, distanceToPolyline }.
function projectOntoSegment(position, a, b) {
  const segLen = distanceMeters(a, b);
  if (segLen === 0) {
    return { point: a, distanceAlongSegment: 0, distanceToPolyline: distanceMeters(position, a) };
  }

  // Equirectangular approximation (fine at city scale) so this stays cheap
  // plain-number math rather than full great-circle projection.
  const toXY = (p) => ({
    x: toRad(p.longitude - a.longitude) * Math.cos(toRad(a.latitude)) * EARTH_RADIUS_M,
    y: toRad(p.latitude - a.latitude) * EARTH_RADIUS_M
  });
  const pA = { x: 0, y: 0 };
  const pB = toXY(b);
  const pP = toXY(position);

  const abLenSq = pB.x ** 2 + pB.y ** 2 || 1;
  let t = (pP.x * pB.x + pP.y * pB.y) / abLenSq;
  t = Math.max(0, Math.min(1, t));

  const proj = { x: pB.x * t, y: pB.y * t };
  const point = {
    latitude: a.latitude + (b.latitude - a.latitude) * t,
    longitude: a.longitude + (b.longitude - a.longitude) * t
  };
  const distanceToPolyline = Math.hypot(pP.x - proj.x, pP.y - proj.y);

  return { point, distanceAlongSegment: segLen * t, distanceToPolyline };
}

/**
 * Finds the point on `polyline` (array of {latitude,longitude}) nearest to
 * `position`, and how far that point is along the whole polyline.
 * Returns { point, distanceTravelled, distanceOffRoute } in meters, or null
 * for a polyline with fewer than 2 points.
 */
export function nearestPointOnPolyline(position, polyline) {
  if (!Array.isArray(polyline) || polyline.length < 2) return null;

  const cum = cumulativeDistances(polyline);
  let best = null;

  for (let i = 1; i < polyline.length; i++) {
    const { point, distanceAlongSegment, distanceToPolyline } = projectOntoSegment(
      position,
      polyline[i - 1],
      polyline[i]
    );
    if (!best || distanceToPolyline < best.distanceOffRoute) {
      best = {
        point,
        distanceTravelled: cum[i - 1] + distanceAlongSegment,
        distanceOffRoute: distanceToPolyline
      };
    }
  }

  return best;
}

export const formatDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
export const formatMinutes = (s) => `${Math.max(1, Math.round(s / 60))} min`;
