import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import Svg, { Path } from 'react-native-svg';
import { fetchDriverDeliveries } from '../store/deliveriesSlice';
import { useAuth } from '../contexts/AuthContext';
import { driverService } from '../services/driverService';
import { colors } from '../theme/matterTheme';
import logger from '../utils/logger';
import {
  distanceMeters,
  bearing,
  nearestPointOnPolyline,
  formatDistance,
  formatMinutes
} from '../utils/routeProgress';

// Driver must be physically this close to a stop before they can mark it
// arrived (and from there, complete it) — prevents completing a delivery
// from somewhere else entirely. 50m rather than a tighter radius to absorb
// real-world GPS error (Accuracy.Balanced + urban/high-rise signal
// conditions easily drift 20-50m) and geocoded-pin imprecision, both of
// which stack against a driver who is genuinely standing at the door.
const ARRIVAL_RADIUS_M = 50;
const GPS_WATCH_OPTIONS = { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 15 };

const isCollectionItem = (d) =>
  d.type === 'Collection' || (d.type === 'Task' && d.taskType === 'Bag Collection');

// Picks a left/right/u-turn/straight glyph from Google's own maneuver code
// on each directions step (e.g. "turn-left", "turn-slight-right",
// "uturn-right", "roundabout-left") — the first step of a leg usually has
// no maneuver at all, which falls back to "continue straight".
const MANEUVER_ICON_PATHS = {
  right: 'M6 20V11a3 3 0 013-3h7m0 0l-4-4m4 4l-4 4',
  left: 'M18 20V11a3 3 0 00-3-3H8m0 0l4-4M8 8l4 4',
  straight: 'M12 20V6m0 0l-4 4m4-4l4 4',
  uturn: 'M8 20V11a4 4 0 018 0v5m0 0l-3-3m3 3l3-3'
};
function maneuverIconPath(maneuver) {
  const m = maneuver || '';
  if (m.includes('uturn')) return MANEUVER_ICON_PATHS.uturn;
  if (m.includes('left')) return MANEUVER_ICON_PATHS.left;
  if (m.includes('right')) return MANEUVER_ICON_PATHS.right;
  return MANEUVER_ICON_PATHS.straight;
}

// Google Maps custom style JSON (https://mapstyle.withgoogle.com format) —
// a dark theme tuned toward this app's own navy palette (matterTheme.js)
// rather than a generic off-the-shelf "night mode", so the map reads as
// part of the same app instead of a different-looking embedded widget.
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0a1230' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a8ccf5' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#050f2b' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#12275e' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#8aa3cc' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#0e1b40' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0d2b1f' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#6fae82' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#12275e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0a1230' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8aa3cc' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#1c3a7a' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#0a1230' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#bcf679' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#12275e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#051747' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4d9eff' }] }
];

const toLatLng = (gps) => ({ latitude: gps.lat, longitude: gps.lng });

function Icon({ d, size = 20, color = colors.text, strokeWidth = 2.4 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function StopMarker({ stop, status }) {
  const palette = {
    pending: colors.blue,
    collection: colors.purple,
    done: colors.bgAlt,
    active: colors.lime
  };
  const isActive = status === 'active';
  const bg = palette[status] || colors.blue;
  return (
    <View
      style={[
        styles.pin,
        { backgroundColor: bg, borderColor: status === 'done' ? colors.lime : colors.bgAlt },
        isActive && styles.pinActive
      ]}
    >
      <Text style={[styles.pinText, { color: status === 'done' ? colors.lime : colors.bgAlt }]}>
        {status === 'done' ? '✓' : stop.stopNumber}
      </Text>
    </View>
  );
}

const bagTagLabel = (stop) =>
  `${stop.bagType === 'cooler' ? '❄' : '🛍'} ${stop.bags} ${stop.bagType} bag${stop.bags === 1 ? '' : 's'}`;

export default function RouteNavigatorScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const { user, driverProfile } = useAuth();
  const driverId = driverProfile?.id || user?.id || user?._id;
  const { deliveries, completedDeliveries } = useSelector((state) => state.deliveries);

  const mapRef = useRef(null);
  const watchSubRef = useRef(null);

  const [phase, setPhase] = useState('idle'); // idle | driving | arrived | done
  const [driverPosition, setDriverPosition] = useState(null);
  const [heading, setHeading] = useState(0);
  const [directions, setDirections] = useState(null); // { polyline, legs }
  const [directionsLoading, setDirectionsLoading] = useState(false);
  const [directionsError, setDirectionsError] = useState(null);
  const [cameraMode, setCameraMode] = useState('car'); // car | 2d
  const [permissionDenied, setPermissionDenied] = useState(false);

  // All of today's pending stops that carry real coordinates, in the
  // dispatch-assigned visit order. The server already returns deliveries
  // sorted by routeOrder (the route optimizer's computed stop sequence —
  // see Delivery.getDriverTodaysDeliveries, which sorts
  // { routeOrder: 1, scheduledTime: 1 }), so this trusts that order as-is
  // rather than re-deriving it client-side. Stops without gpsLocation can't
  // be routed/mapped — they're handled via the existing external-maps deep
  // link in DeliveryDetailsScreen instead.
  const stops = useMemo(() => {
    const withCoords = (deliveries || []).filter(
      (d) =>
        d.displayStatus === 'pending' &&
        !completedDeliveries?.includes(d._id) &&
        typeof d.gpsLocation?.lat === 'number' &&
        typeof d.gpsLocation?.lng === 'number'
    );
    return withCoords.map((d, i) => {
      const customer = d.customer || {};
      return {
        delivery: d,
        // routeOrder is 0-indexed (routeOptimizationService.js sets it from
        // a plain array index) — +1 for a natural-counting "Stop 1" label.
        stopNumber: d.routeOrder != null ? d.routeOrder + 1 : i + 1,
        name: customer.name || d.customerName || 'Customer',
        addr: customer.address || d.address || 'Address not available',
        coords: toLatLng(d.gpsLocation),
        bags: d.bagsAssigned ?? d.items ?? 0,
        bagType: /cooler|cold|chilled/i.test(d.taskType || '') ? 'cooler' : 'paper',
        kind: isCollectionItem(d) ? 'collection' : 'pending',
        note: customer.specialInstructions || d.specialInstructions || d.notes || ''
      };
    });
  }, [deliveries, completedDeliveries]);

  // `stops` already excludes anything no longer pending (completed via this
  // screen's own flow, or via the Deliveries tab directly), so the next stop
  // to navigate to is always simply the first one left — no separate index
  // to track or keep in sync.
  const activeStop = stops[0] || null;

  // Refreshed on every focus, not just once on mount — a driver completing
  // a stop via "Scan bags & complete" naturally taps straight back to this
  // tab afterward, often without ever passing through the Deliveries tab
  // (whose own focus effect is what previously refreshed this data as a
  // side effect). Without this, a just-completed stop kept showing here
  // with its stale route line until something else happened to refetch —
  // in practice, only a full logout/login actually cleared it.
  useFocusEffect(
    useCallback(() => {
      if (driverId) dispatch(fetchDriverDeliveries(driverId));
    }, [driverId, dispatch])
  );

  // One-time position so the idle screen can show a sensible initial map
  // region even before the driver taps "Start route". Wrapped in a timeout
  // (same pattern as DeliveryDetailsScreen's completion-GPS capture) — a
  // weak/no indoor GPS fix must never leave the "Start route" button stuck
  // on "Getting your location…" forever with no feedback or way to retry.
  const [locationError, setLocationError] = useState(null);
  const [locationAttempt, setLocationAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLocationError(null);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setPermissionDenied(true);
        return;
      }
      try {
        const pos = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Location request timed out')), 12000))
        ]);
        if (cancelled) return;
        setDriverPosition({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      } catch (error) {
        if (cancelled) return;
        logger.warn('📍 Route Navigator: could not get initial position:', error?.message || error);
        setLocationError('Could not get your location. Check that GPS/location services are on.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationAttempt]);

  // Continuous GPS tracking only while actively driving, and torn down the
  // moment the screen loses focus or phase leaves 'driving' — foreground
  // only, matching the rest of this app (no background location anywhere).
  useFocusEffect(
    useCallback(() => {
      return () => {
        watchSubRef.current?.remove();
        watchSubRef.current = null;
      };
    }, [])
  );

  useEffect(() => {
    // Kept running through 'arrived' too (not just 'driving') — the Complete
    // button's proximity gate below needs a live position, not a stale one
    // frozen at the moment the driver tapped "I've arrived".
    if (phase !== 'driving' && phase !== 'arrived') {
      watchSubRef.current?.remove();
      watchSubRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      const sub = await Location.watchPositionAsync(GPS_WATCH_OPTIONS, (pos) => {
        const next = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setDriverPosition((prev) => {
          if (prev && Number.isFinite(pos.coords.heading) && pos.coords.heading >= 0) {
            setHeading(pos.coords.heading);
          } else if (prev) {
            setHeading(bearing(prev, next));
          }
          return next;
        });
      });
      if (cancelled) sub.remove();
      else watchSubRef.current = sub;
    })();

    return () => {
      cancelled = true;
    };
  }, [phase]);

  const fetchDirections = useCallback(
    async (fromPosition, toStops) => {
      if (!driverId || !fromPosition || toStops.length === 0) return;
      setDirectionsLoading(true);
      setDirectionsError(null);
      try {
        const points = [
          { lat: fromPosition.latitude, lng: fromPosition.longitude },
          ...toStops.map((s) => ({ lat: s.coords.latitude, lng: s.coords.longitude }))
        ];
        const result = await driverService.getRouteDirections(driverId, points);
        setDirections(result);
      } catch (error) {
        logger.warn('🗺️ Route Navigator: directions request failed:', error?.message || error);
        setDirectionsError('Could not load driving directions.');
        setDirections(null);
      } finally {
        setDirectionsLoading(false);
      }
    },
    [driverId]
  );

  // Directions are requested one stop at a time — just the driver's current
  // position to the single active stop, never the whole remaining route —
  // so the map only ever draws the line to where the driver is headed next.
  const startRoute = useCallback(async () => {
    if (!driverPosition || !activeStop) return;
    setPhase('driving');
    setCameraMode('car');
    // Trigger the tilted, heading-up "driver mode" camera immediately here —
    // not just via the reactive effect below, which depends on `phase` and
    // can lag a render behind a synchronous state update, leaving the map
    // flat/north-up for a beat (or, in some cases, never actually animating).
    mapRef.current?.animateCamera(
      { center: driverPosition, heading, pitch: 60, zoom: 17 },
      { duration: 450 }
    );
    await fetchDirections(driverPosition, [activeStop]);
  }, [driverPosition, heading, activeStop, fetchDirections]);

  const endRoute = useCallback(() => {
    setPhase('idle');
    setDirections(null);
    setDirectionsError(null);
  }, []);

  const handleArrive = useCallback(() => {
    setPhase('arrived');
  }, []);

  // `activeStop` (= stops[0]) can change identity for two reasons: the
  // driver completed it through this screen's own "Scan bags & complete"
  // flow (which hands off to DeliveryDetailsScreen and never reports back
  // directly — see below), or it was completed/cancelled some other way
  // entirely (e.g. from the Deliveries tab) while this screen sat in the
  // background. Either way, once Redux's shared `deliveries` reflects that,
  // `stops` drops the finished one and `activeStop` silently becomes the
  // next one on the very next render — there's no event to "catch" the old
  // activeStop being completed, because by the time the array updates it's
  // already gone. So this watches for the *identity* of activeStop changing
  // while mid-route, rather than trying to match it against a completed-ids
  // list (which never actually overlaps with the current activeStop for the
  // same reason).
  //
  // On DeliveryDetailsScreen's side: completing a delivery only updates its
  // own local state and navigates to Deliveries > DeliveriesList with
  // {refresh:true} — it never dispatches anything that touches this
  // screen's data directly. That refresh re-fetches into the same shared
  // Redux `deliveries` slice this screen also reads, which is what actually
  // makes the stop disappear here, whenever that fetch resolves.
  const activeStopIdRef = useRef(null);
  useEffect(() => {
    const currentId = activeStop?.delivery._id ?? null;
    const previousId = activeStopIdRef.current;
    activeStopIdRef.current = currentId;

    if (previousId === currentId) return; // nothing changed
    if (previousId == null) return; // first assignment (e.g. on mount), not a transition
    if (phase !== 'driving' && phase !== 'arrived') return; // not mid-route, nothing to resync

    if (!activeStop) {
      setPhase('done');
      setDirections(null);
      return;
    }

    setPhase('driving');
    if (driverPosition) fetchDirections(driverPosition, [activeStop]);
  }, [activeStop, phase, driverPosition, fetchDirections]);

  const handleCompleteStop = useCallback(() => {
    if (!activeStop) return;
    navigation.navigate('Deliveries', {
      screen: 'DeliveryDetails',
      params: { deliveryId: activeStop.delivery._id, delivery: activeStop.delivery }
    });
  }, [activeStop, navigation]);

  // ---- progress along the current route (real GPS, not simulated) ----
  const progress = useMemo(() => {
    if (!driverPosition || !directions?.polyline?.length || !directions?.legs?.length) return null;

    const onRoute = nearestPointOnPolyline(driverPosition, directions.polyline);
    if (!onRoute) return null;

    let cumulative = 0;
    for (let i = 0; i < directions.legs.length; i++) {
      const leg = directions.legs[i];
      const legEnd = cumulative + leg.distanceMeters;
      if (onRoute.distanceTravelled <= legEnd || i === directions.legs.length - 1) {
        const intoLeg = Math.max(0, onRoute.distanceTravelled - cumulative);
        const leftInLeg = Math.max(0, leg.distanceMeters - intoLeg);

        let stepCum = 0;
        let step = leg.steps[leg.steps.length - 1] || null;
        for (const s of leg.steps) {
          stepCum += s.distanceMeters;
          if (stepCum > intoLeg) {
            step = s;
            break;
          }
        }

        return { legIndex: i, distanceLeftInLeg: leftInLeg, step, legDurationSeconds: leg.durationSeconds };
      }
      cumulative = legEnd;
    }
    return null;
  }, [driverPosition, directions]);

  // Distance to the active stop drives both the "I've arrived" button's
  // enabled state and its label — the driver physically cannot mark a stop
  // arrived (and from there, complete it) from somewhere else.
  const distanceToActiveStop =
    activeStop && driverPosition ? distanceMeters(driverPosition, activeStop.coords) : null;
  const nearArrival = distanceToActiveStop != null && distanceToActiveStop <= ARRIVAL_RADIUS_M;

  const toggleCameraMode = useCallback(() => {
    setCameraMode((m) => (m === 'car' ? '2d' : 'car'));
  }, []);

  useEffect(() => {
    if (!mapRef.current || !driverPosition || phase !== 'driving') return;
    mapRef.current.animateCamera(
      cameraMode === 'car'
        ? { center: driverPosition, heading, pitch: 60, zoom: 17 }
        : { center: driverPosition, heading: 0, pitch: 0, zoom: 15.5 },
      { duration: 450 }
    );
  }, [driverPosition, heading, cameraMode, phase]);

  const recenter = useCallback(() => {
    if (!mapRef.current) return;
    if (phase === 'driving' && driverPosition) {
      mapRef.current.animateCamera(
        cameraMode === 'car'
          ? { center: driverPosition, heading, pitch: 60, zoom: 17 }
          : { center: driverPosition, heading: 0, pitch: 0, zoom: 16.5 },
        { duration: 400 }
      );
    } else if (stops.length > 0) {
      mapRef.current.fitToCoordinates(stops.map((s) => s.coords), {
        edgePadding: { top: 80, right: 40, bottom: 260, left: 40 },
        animated: true
      });
    }
  }, [phase, driverPosition, cameraMode, heading, stops]);

  useEffect(() => {
    if (phase === 'idle' && stops.length > 0) {
      const t = setTimeout(recenter, 300);
      return () => clearTimeout(t);
    }
  }, [phase, stops, recenter]);

  if (permissionDenied) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.emptyTitle}>Location permission needed</Text>
        <Text style={styles.emptyBody}>
          Route Navigator needs your location to guide you between stops. Enable location access for this app in
          your device settings.
        </Text>
      </View>
    );
  }

  if (stops.length === 0 && phase === 'idle') {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.emptyTitle}>No routable stops</Text>
        <Text style={styles.emptyBody}>None of today's pending stops have GPS coordinates yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.head, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          style={styles.iconBtn}
          onPress={() => navigation.navigate('Dashboard')}
          accessibilityLabel="Back"
        >
          <Icon d="M15 5l-7 7 7 7" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headTitle}>Today's route</Text>
          <Text style={styles.headSub}>
            {phase === 'done' ? 'All stops done' : `${stops.length} stop${stops.length === 1 ? '' : 's'} left`}
          </Text>
        </View>
        <View style={styles.chip}>
          <Text style={styles.chipText}>
            {phase === 'idle' ? 'Not started' : phase === 'driving' ? 'Navigating' : phase === 'arrived' ? 'Arrived' : 'Complete'}
          </Text>
        </View>
      </View>

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          pitchEnabled
          rotateEnabled
          showsUserLocation
          showsMyLocationButton={false}
          customMapStyle={DARK_MAP_STYLE}
          initialRegion={{
            latitude: driverPosition?.latitude || stops[0]?.coords.latitude || 25.2,
            longitude: driverPosition?.longitude || stops[0]?.coords.longitude || 55.27,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08
          }}
        >
          {stops.map((stop, i) => (
            <Marker key={stop.delivery._id} coordinate={stop.coords} anchor={{ x: 0.5, y: 0.5 }}>
              <StopMarker
                stop={stop}
                status={i === 0 && phase !== 'idle' ? 'active' : stop.kind}
              />
            </Marker>
          ))}
          {directions?.polyline?.length > 0 && (
            <Polyline coordinates={directions.polyline} strokeColor={colors.blue} strokeWidth={5} />
          )}
          {activeStop && (phase === 'driving' || phase === 'arrived') && (
            <Circle
              center={activeStop.coords}
              radius={ARRIVAL_RADIUS_M}
              strokeColor={colors.lime}
              strokeWidth={2}
              fillColor="rgba(188,246,121,0.18)"
            />
          )}
        </MapView>

        {phase === 'driving' && progress?.step && (
          <View style={styles.banner}>
            <View style={styles.maneuver}>
              <Icon d={maneuverIconPath(progress.step.maneuver)} color={colors.bgAlt} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerDist}>{formatDistance(progress.distanceLeftInLeg)}</Text>
              <Text style={styles.bannerTxt} numberOfLines={2}>
                {progress.step.text}
              </Text>
            </View>
          </View>
        )}

        {directionsLoading && (
          <View style={styles.gpsPill}>
            <ActivityIndicator size="small" color={colors.lime} />
            <Text style={styles.gpsPillText}>Loading route…</Text>
          </View>
        )}
        {!!directionsError && !directionsLoading && (
          <View style={styles.gpsPill}>
            <Text style={styles.gpsPillText}>{directionsError}</Text>
          </View>
        )}

        <View style={styles.floatCol}>
          <TouchableOpacity style={[styles.floatBtn, cameraMode === 'car' && styles.floatBtnOn]} onPress={toggleCameraMode}>
            <Text style={[styles.floatBtnText, cameraMode === 'car' && styles.floatBtnTextOn]}>
              {cameraMode === 'car' ? '3D' : '2D'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.locateBtn} onPress={recenter} accessibilityLabel="Recenter on my location">
            <Svg width={20} height={20} viewBox="0 0 24 24">
              <Path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill={colors.blue} />
            </Svg>
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
        {phase === 'idle' && (
          <>
            <Text style={styles.kicker}>ROUTE READY</Text>
            <Text style={styles.sheetTitle}>
              {stops.length} stop{stops.length === 1 ? '' : 's'} ·{' '}
              {stops.filter((s) => s.kind === 'collection').length} collections
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
              {stops.map((s) => (
                <View key={s.delivery._id} style={styles.mini}>
                  <Text style={styles.miniTitle} numberOfLines={1}>
                    {s.stopNumber}. {s.name}
                  </Text>
                  <Text style={styles.miniSub} numberOfLines={1}>
                    {s.kind === 'collection' ? 'Collection · ' : ''}
                    {bagTagLabel(s)}
                  </Text>
                </View>
              ))}
            </ScrollView>
            {locationError ? (
              <>
                <Text style={styles.locationErrorText}>{locationError}</Text>
                <TouchableOpacity style={styles.btn} onPress={() => setLocationAttempt((n) => n + 1)}>
                  <Text style={styles.btnText}>Retry</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.btn} onPress={startRoute} disabled={!driverPosition}>
                <Text style={styles.btnText}>{driverPosition ? 'Start route' : 'Getting your location…'}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {phase === 'driving' && activeStop && (
          <>
            <Text style={styles.kicker}>
              NEXT STOP · {activeStop.stopNumber} OF {stops.length}
            </Text>
            <View style={styles.stopRow}>
              <View style={styles.stopNum}>
                <Text style={styles.stopNumText}>{activeStop.stopNumber}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stopWho} numberOfLines={1}>
                  {activeStop.name}
                </Text>
                <Text style={styles.stopAddr} numberOfLines={1}>
                  {activeStop.addr}
                </Text>
                <View style={styles.tagsRow}>
                  {activeStop.kind === 'collection' && (
                    <View style={[styles.tag, { backgroundColor: colors.purple }]}>
                      <Text style={styles.tagText}>Collection</Text>
                    </View>
                  )}
                  <View style={[styles.tag, { backgroundColor: activeStop.bagType === 'cooler' ? colors.blue : colors.paper }]}>
                    <Text style={[styles.tagText, activeStop.bagType !== 'cooler' && { color: '#302e2e' }]}>
                      {bagTagLabel(activeStop)}
                    </Text>
                  </View>
                </View>
              </View>
              {progress && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.stopEta}>{formatMinutes(progress.distanceLeftInLeg / Math.max(4, (directions.legs[progress.legIndex]?.distanceMeters || 1) / (progress.legDurationSeconds || 1)))}</Text>
                  <Text style={styles.stopLeft}>{formatDistance(progress.distanceLeftInLeg)} left</Text>
                </View>
              )}
            </View>
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, !nearArrival && styles.btnDisabled]}
                onPress={handleArrive}
                disabled={!nearArrival}
              >
                <Text style={styles.btnText}>
                  {nearArrival
                    ? "I've arrived"
                    : distanceToActiveStop != null
                    ? `Get closer (${formatDistance(distanceToActiveStop)} away)`
                    : 'Arriving soon'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {phase === 'arrived' && activeStop && (
          <>
            <Text style={[styles.kicker, { color: colors.lime }]}>
              ARRIVED · STOP {activeStop.stopNumber}
            </Text>
            <Text style={styles.sheetTitle}>{activeStop.name}</Text>
            <View style={styles.tagsRow}>
              {activeStop.kind === 'collection' && (
                <View style={[styles.tag, { backgroundColor: colors.purple }]}>
                  <Text style={styles.tagText}>Collection</Text>
                </View>
              )}
              <View style={[styles.tag, { backgroundColor: activeStop.bagType === 'cooler' ? colors.blue : colors.paper }]}>
                <Text style={[styles.tagText, activeStop.bagType !== 'cooler' && { color: '#302e2e' }]}>
                  {bagTagLabel(activeStop)}
                </Text>
              </View>
            </View>
            {!!activeStop.note && (
              <View style={styles.note}>
                <Text style={styles.noteText}>{activeStop.note}</Text>
              </View>
            )}
            {!nearArrival && (
              <Text style={styles.locationErrorText}>
                You've moved {distanceToActiveStop != null ? formatDistance(distanceToActiveStop) : 'away'} from
                this stop — get back within {ARRIVAL_RADIUS_M}m to complete it.
              </Text>
            )}
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, !nearArrival && styles.btnDisabled]}
                onPress={handleCompleteStop}
                disabled={!nearArrival}
              >
                <Text style={styles.btnText}>
                  {activeStop.kind === 'collection' ? 'Scan collection & complete' : 'Scan bags & complete'}
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {phase === 'done' && (
          <>
            <Text style={[styles.kicker, { color: colors.lime }]}>ROUTE COMPLETE</Text>
            <Text style={styles.sheetTitle}>All stops handled</Text>
            <TouchableOpacity style={styles.btn} onPress={endRoute}>
              <Text style={styles.btnText}>Back to dashboard</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  emptyBody: { color: colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  locationErrorText: { color: colors.danger, fontSize: 13, marginTop: 12, marginBottom: 10, lineHeight: 18 },

  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 11, backgroundColor: colors.bgAlt },
  iconBtn: { width: 40, height: 40, borderRadius: 999, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  headTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  headSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  chip: { backgroundColor: colors.lime, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { color: colors.bgAlt, fontSize: 12, fontWeight: '800' },

  mapWrap: { flex: 1 },
  pin: { width: 26, height: 26, borderRadius: 999, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pinActive: { width: 38, height: 38, borderRadius: 999 },
  pinText: { fontSize: 11, fontWeight: '800' },

  banner: { position: 'absolute', left: 12, right: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.lime, borderRadius: 20, padding: 13 },
  maneuver: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.bgAlt, alignItems: 'center', justifyContent: 'center' },
  bannerDist: { color: colors.bgAlt, fontSize: 19, fontWeight: '800' },
  bannerTxt: { color: colors.bgAlt, fontSize: 13, fontWeight: '600', marginTop: 2 },

  gpsPill: { position: 'absolute', left: 12, bottom: 16, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: 'rgba(5,23,71,0.9)', borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  gpsPillText: { color: colors.muted, fontSize: 11, fontWeight: '700' },

  floatCol: { position: 'absolute', right: 12, bottom: 16, gap: 8 },
  floatBtn: { width: 44, height: 44, borderRadius: 999, backgroundColor: colors.bgAlt, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  floatBtnOn: { backgroundColor: colors.lime, borderColor: colors.lime },
  floatBtnText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  floatBtnTextOn: { color: colors.bgAlt },
  locateBtn: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4
  },

  sheet: { backgroundColor: colors.bgAlt, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 16 },
  kicker: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 6 },

  mini: { backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, marginRight: 8, minWidth: 140 },
  miniTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  miniSub: { color: colors.muted, fontSize: 11, marginTop: 3 },

  stopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 14 },
  stopNum: { width: 34, height: 34, borderRadius: 999, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center' },
  stopNumText: { color: colors.bgAlt, fontWeight: '800', fontSize: 14 },
  stopWho: { color: colors.text, fontSize: 16, fontWeight: '800' },
  stopAddr: { color: colors.muted, fontSize: 13, marginTop: 3 },
  stopEta: { color: colors.text, fontSize: 20, fontWeight: '800' },
  stopLeft: { color: colors.muted, fontSize: 11.5, marginTop: 3 },

  tagsRow: { flexDirection: 'row', gap: 7, marginTop: 9, flexWrap: 'wrap' },
  tag: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  tagText: { color: colors.bgAlt, fontSize: 11.5, fontWeight: '800' },

  note: { marginTop: 12, backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 12 },
  noteText: { color: colors.text, fontSize: 13, lineHeight: 18 },

  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { minHeight: 52, borderRadius: 999, backgroundColor: colors.lime, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnDisabled: { backgroundColor: colors.border, opacity: 0.6 },
  btnText: { color: colors.bgAlt, fontSize: 15, fontWeight: '800' },
  btnGhost: { minHeight: 52, borderRadius: 999, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  btnGhostText: { color: colors.muted, fontSize: 13, fontWeight: '800' }
});
