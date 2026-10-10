import {
  distanceMeters,
  bearing,
  cumulativeDistances,
  nearestPointOnPolyline,
  formatDistance,
  formatMinutes
} from './routeProgress';

describe('distanceMeters', () => {
  it('returns 0 for identical points', () => {
    const p = { latitude: 25.2, longitude: 55.27 };
    expect(distanceMeters(p, p)).toBe(0);
  });

  it('matches the known great-circle distance for 1 degree of longitude at the equator', () => {
    // A degree of longitude along the equator is an exact great-circle arc:
    // distance = R * (angle in radians) = 6371000 * (pi/180) ~= 111194.93 m.
    const d = distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(d).toBeCloseTo(111194.93, 1);
  });

  it('is symmetric', () => {
    const a = { latitude: 25.1972, longitude: 55.2744 };
    const b = { latitude: 25.199, longitude: 55.277 };
    expect(distanceMeters(a, b)).toBeCloseTo(distanceMeters(b, a), 6);
  });

  it('matches a known Dubai-scale (~300m) distance between two real coordinates', () => {
    const d = distanceMeters({ latitude: 25.1972, longitude: 55.2744 }, { latitude: 25.199, longitude: 55.277 });
    expect(d).toBeCloseTo(329.38, 1);
  });
});

describe('bearing', () => {
  it('is 0deg (north) for due-north movement', () => {
    expect(bearing({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(0, 6);
  });
  it('is 90deg (east) for due-east movement', () => {
    expect(bearing({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(90, 6);
  });
  it('is 180deg (south) for due-south movement', () => {
    expect(bearing({ latitude: 0, longitude: 0 }, { latitude: -1, longitude: 0 })).toBeCloseTo(180, 6);
  });
  it('is 270deg (west) for due-west movement', () => {
    expect(bearing({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: -1 })).toBeCloseTo(270, 6);
  });
});

describe('cumulativeDistances', () => {
  it('starts at 0 and accumulates leg distances', () => {
    const points = [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 2 }
    ];
    const cum = cumulativeDistances(points);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeCloseTo(111194.93, 1);
    expect(cum[2]).toBeCloseTo(222389.85, 1);
  });
});

describe('nearestPointOnPolyline', () => {
  const polyline = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 1 }
  ];

  it('returns null for a polyline with fewer than 2 points', () => {
    expect(nearestPointOnPolyline({ latitude: 0, longitude: 0 }, [{ latitude: 0, longitude: 0 }])).toBeNull();
  });

  it('projects a driver slightly off-route onto the correct point and distance travelled', () => {
    // Driver ~111m north of the route's midpoint.
    const result = nearestPointOnPolyline({ latitude: 0.001, longitude: 0.5 }, polyline);
    expect(result.point.longitude).toBeCloseTo(0.5, 6);
    expect(result.point.latitude).toBeCloseTo(0, 6);
    expect(result.distanceTravelled).toBeCloseTo(55597.46, 1);
    expect(result.distanceOffRoute).toBeCloseTo(111.19, 1);
  });

  it('clamps to the start point when the driver is behind the route start', () => {
    const result = nearestPointOnPolyline({ latitude: 0, longitude: 0 }, polyline);
    expect(result.distanceTravelled).toBe(0);
    expect(result.distanceOffRoute).toBe(0);
  });

  it('clamps to the end point when the driver is past the route end', () => {
    const result = nearestPointOnPolyline({ latitude: 0, longitude: 2 }, polyline);
    expect(result.point.longitude).toBeCloseTo(1, 6);
    expect(result.distanceTravelled).toBeCloseTo(111194.93, 1);
  });
});

describe('formatDistance', () => {
  it('formats sub-kilometer distances rounded to the nearest 10m', () => {
    expect(formatDistance(234)).toBe('230 m');
    expect(formatDistance(25)).toBe('30 m');
  });
  it('formats kilometer-plus distances with one decimal', () => {
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(17000)).toBe('17.0 km');
  });
});

describe('formatMinutes', () => {
  it('rounds to the nearest minute with a 1-minute floor', () => {
    expect(formatMinutes(90)).toBe('2 min');
    expect(formatMinutes(10)).toBe('1 min');
    expect(formatMinutes(0)).toBe('1 min');
  });
});
