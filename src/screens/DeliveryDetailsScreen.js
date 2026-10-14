// screens/DeliveryDetailsScreen.js
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Linking, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Rect, Text as SvgText } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { useDispatch } from 'react-redux';
import { deliveryService } from '../services/deliveryService';
import { offlineSyncService, isRetryableError } from '../services/offlineSyncService';
import { completeDelivery, updateDeliveryStatus, recordQueuedAction } from '../store/deliveriesSlice';
import { attachDisplayStatus } from '../services/deliveryParser';
import { isBagCode } from '../utils/bagId';
import logger from '../utils/logger';
import { colors } from '../theme/matterTheme';

// Matches the "MATTER Driver App" design's brand marks for the two map buttons.
const GoogleMapsIcon = ({ size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Path d="M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7z" fill="#ea4335" />
    <Path d="M12 2a7 7 0 016.7 5H8.3A7 7 0 0112 2z" fill="#fbbc04" />
    <Path d="M5.3 7h13.4a7 7 0 01.1 2H5.2a7 7 0 01.1-2z" fill="#34a853" />
    <Circle cx="12" cy="9" r="2.6" fill="#ffffff" />
  </Svg>
);

const TwoGisIcon = ({ size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="#19aa1e" />
    <SvgText x="12" y="15.6" textAnchor="middle" fontFamily="Archivo, sans-serif" fontSize="8.6" fontWeight="700" fill="#ffffff">
      2GIS
    </SvgText>
  </Svg>
);

const FAIL_REASONS = [
  { key: 'kitchen', label: 'No meal in the kitchen', hint: 'Order was not prepared', icon: 'fast-food-outline' },
  { key: 'location', label: 'Wrong location', hint: 'Address does not match the stop', icon: 'location-outline' },
];

const hasValue = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

const pickAddressDetailValue = (source, keys = []) => {
  for (const key of keys) {
    const value = source?.[key];
    if (hasValue(value)) {
      return String(value).trim();
    }
  }
  return null;
};

const mergeWithFallback = (primary = {}, fallback = {}) => {
  const merged = { ...fallback, ...primary };

  Object.keys(fallback).forEach((key) => {
    const primaryValue = primary?.[key];
    const fallbackValue = fallback[key];

    if (
      primaryValue &&
      fallbackValue &&
      typeof primaryValue === 'object' &&
      typeof fallbackValue === 'object' &&
      !Array.isArray(primaryValue) &&
      !Array.isArray(fallbackValue)
    ) {
      merged[key] = mergeWithFallback(primaryValue, fallbackValue);
      return;
    }

    if (!hasValue(primaryValue) && hasValue(fallbackValue)) {
      merged[key] = fallbackValue;
    }
  });

  return merged;
};

// One-time GPS fix captured at the moment a delivery is completed (where it
// was actually delivered), not continuous tracking. Must never block or
// fail delivery completion: GPS itself works without a network connection,
// but a slow/no fix (indoors, poor signal) is common, so this always
// resolves — with `null` on any permission denial, error, or timeout —
// rather than making the driver wait indefinitely to finish a delivery.
const CAPTURE_LOCATION_TIMEOUT_MS = 8000;

const captureCompletionLocation = async () => {
  let timer;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('location fix timed out')), CAPTURE_LOCATION_TIMEOUT_MS); }),
    ]);

    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch (error) {
    logger.warn('📍 Could not capture completion location:', error?.message || error);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const DeliveryDetailsScreen = ({ navigation, route }) => {
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const initialDelivery = route?.params?.delivery || null;
  const deliveryId = route?.params?.deliveryId || initialDelivery?._id;
  const [delivery, setDelivery] = useState(initialDelivery);
  const [deliveryPhoto, setDeliveryPhoto] = useState(initialDelivery?.deliveryPhoto || null);
  const [loading, setLoading] = useState(!initialDelivery);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState('details'); // details | fail | done
  const [doneMode, setDoneMode] = useState('delivered'); // delivered | failed
  const [failReason, setFailReason] = useState(null);
  const [failNote, setFailNote] = useState('');
  const [failSubmitting, setFailSubmitting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const [acknowledgingChange, setAcknowledgingChange] = useState(false);

  useEffect(() => {
    // React Navigation reuses this SAME screen instance when navigating to
    // "DeliveryDetails" again for a different delivery (navigate() on an
    // already-mounted route doesn't remount the component) — all local
    // state below otherwise carries over from whichever delivery was open
    // last. Concretely: finish delivery A (step becomes 'done'), go back to
    // the list, tap delivery B — without this reset, the screen would still
    // be sitting in the 'done' state from A, briefly showing A's name and
    // then B's (once the fetch below resolves) on the "Delivered ✓" screen,
    // making a delivery that was never touched look already completed.
    setDelivery(initialDelivery);
    setDeliveryPhoto(initialDelivery?.deliveryPhoto || null);
    setStep('details');
    setDoneMode('delivered');
    setFailReason(null);
    setFailNote('');
    setSubmitting(false);
    setFailSubmitting(false);
    setRetrying(false);
    setAddressCopied(false);
    setAcknowledgingChange(false);

    if (!deliveryId) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    const fetchDelivery = async () => {
      if (!initialDelivery) setLoading(true);

      try {
        const response = await deliveryService.getDelivery(deliveryId);
        if (isMounted) {
          // `displayStatus` is a client-computed convenience field (see
          // deliveryParser.js) — it only ever gets attached on the LIST
          // endpoint's response, never on this single-delivery fetch. So it
          // doesn't exist on `response`, and mergeWithFallback would keep
          // whatever stale `displayStatus` came in via nav params forever
          // (e.g. this screen would keep showing "Delivery Complete" for an
          // actually-still-pending delivery). Recompute it explicitly from
          // the merged, now-genuinely-fresh `status` field instead of
          // trusting the merge to carry it forward.
          //
          // Base the merge on `initialDelivery` (this delivery's own nav
          // params), not the `currentDelivery` updater arg — since the
          // reset above already set state to initialDelivery, they're the
          // same right now, but using the updater's `currentDelivery` here
          // would silently reintroduce cross-delivery staleness the moment
          // this effect's closure runs after a rapid deliveryId change.
          setDelivery(attachDisplayStatus(mergeWithFallback(response, initialDelivery || {})));
          setDeliveryPhoto((currentPhoto) => (
            response?.proof?.images?.[0] ||
            response?.deliveryPhoto ||
            currentPhoto ||
            initialDelivery?.deliveryPhoto ||
            null
          ));
        }
      } catch (error) {
        logger.error('Failed to load delivery details:', error);
        const message = error.response?.data?.message || 'Unable to load this delivery. Please try again.';
        // React Navigation keeps this screen instance mounted (not
        // unmounted) when the driver navigates forward to Camera/QRScanner,
        // so `isMounted` alone doesn't mean this screen is what the driver
        // is currently looking at — a slow request from when this screen
        // first opened can still resolve after they've already moved on.
        // Without the focus check, that stale failure popped an alert and
        // called goBack() over whatever screen they'd since navigated to
        // (e.g. yanking them out of an in-progress photo capture). If we're
        // not focused, just keep showing what we already had from nav
        // params instead of disrupting the driver's current screen.
        //
        // Separately: this fetch is just a background refresh — the screen
        // already has `initialDelivery` from nav params to render from (the
        // list screen fetched it moments earlier). A driver who's offline
        // will ALWAYS hit this catch the instant they open any delivery,
        // and previously that meant an error alert + getting bounced back to
        // the list on every single attempt — offline drivers couldn't view
        // or complete any delivery at all. Only treat this as fatal when
        // there's truly nothing to fall back on; otherwise just keep
        // showing the cached data and let the driver carry on (the
        // completion flow itself already queues offline via
        // offlineSyncService).
        if (isMounted && navigation.isFocused() && !initialDelivery) {
          Alert.alert('Error', message, [{ text: 'OK', onPress: () => navigation.goBack() }]);
        }
      } finally {
        if (isMounted && !initialDelivery) setLoading(false);
      }
    };

    fetchDelivery();
    return () => { isMounted = false; };
  }, [deliveryId, initialDelivery, navigation]);

  // Handle photo returned from camera
  useEffect(() => {
    if (route.params?.capturedPhoto) {
      const { capturedPhoto, photoSource } = route.params;
      setDeliveryPhoto(capturedPhoto);

      // Clear the params
      navigation.setParams({ capturedPhoto: undefined, photoSource: undefined });

      // Continue the same flow automatically after photo capture.
      if (photoSource === 'complete-delivery' || photoSource === 'start-delivery' || photoSource === 'take-photo') {
        navigation.navigate('QRScanner', {
          deliveryId,
          mode: 'delivery'
        });
      }
    }
  }, [deliveryId, navigation, route.params?.capturedPhoto]);

  const customer = delivery?.customer || {};
  const customerName = customer.name || delivery?.customerName || 'Customer';
  const address = customer.address || delivery?.address || 'Address not available';
  const customerZone =
    customer.zone || customer.area || customer.district || customer.sector ||
    delivery?.zone || delivery?.area || delivery?.district || delivery?.sector || 'Zone —';
  const customerPhone = customer.phone || delivery?.phone || delivery?.customerPhone || 'N/A';
  const bagsAssigned = delivery?.bagsAssigned ?? delivery?.items ?? 0;
  const stopNumber = delivery?.stop ?? delivery?.sequence ?? delivery?.order ?? null;
  const isCollectionStop = delivery?.type === 'Collection' || (delivery?.type === 'Task' && delivery?.taskType === 'Bag Collection');
  const statusMeta = isCollectionStop
    ? { label: 'Collection', color: colors.purple }
    : delivery?.displayStatus === 'delivered' ? { label: 'Delivered', color: colors.lime }
    : delivery?.displayStatus === 'cancelled' ? { label: 'Failed', color: colors.danger }
    : { label: 'Pending', color: colors.blue };
  const rawAddressDetails = customer.addressDetails || delivery?.addressDetails || {};
  const addressDetails = [
    {
      label: 'Apartment',
      value: pickAddressDetailValue(rawAddressDetails, ['areaApartment', 'apartment', 'Apartment', 'apartmentNo', 'flat', 'unit'])
    },
    {
      label: 'Area',
      value: pickAddressDetailValue(rawAddressDetails, ['area', 'Area'])
    },
    {
      label: 'Building',
      value: pickAddressDetailValue(rawAddressDetails, ['building', 'Building', 'buildingName'])
    },
    {
      label: 'Floor',
      value: pickAddressDetailValue(rawAddressDetails, ['floor', 'Floor'])
    },
    {
      label: 'Street',
      value: pickAddressDetailValue(rawAddressDetails, ['street', 'Street'])
    },
  ].filter((item) => hasValue(item.value));
  const hasAddressDetails = addressDetails.length > 0;
  const fullAddressText = hasAddressDetails ? addressDetails.map((d) => d.value).join(', ') : address;
  const hasAddressText = !!fullAddressText && fullAddressText !== 'Address not available';
  const gpsLocation = delivery?.gpsLocation || {};
  const hasCoords = typeof gpsLocation.lat === 'number' && typeof gpsLocation.lng === 'number';
  // Google Maps only lights up when a real pin (lat/lng) is provided — no
  // falling back to a text-search link, per product intent.
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${gpsLocation.lat},${gpsLocation.lng}`
    : '';
  const hasMapLink = hasCoords;
  const twoGisUrl = hasCoords
    ? `https://2gis.ae/search/${gpsLocation.lat},${gpsLocation.lng}`
    : hasAddressText
      ? `https://2gis.ae/search/${encodeURIComponent(fullAddressText)}`
      : '';
  const has2GisTarget = twoGisUrl.length > 0;
  const deliveryWindow = (() => {
    const rawWindow = typeof delivery?.deliveryTime === 'string' ? delivery.deliveryTime.trim() : '';

    if (rawWindow) {
      const parts = rawWindow.split('•').map((part) => part.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return {
          date: parts[0],
          time: parts.slice(1).join(' • '),
        };
      }

      return {
        date: '',
        time: rawWindow,
      };
    }

    if (delivery?.scheduledTime) {
      const date = new Date(delivery.scheduledTime);
      if (!Number.isNaN(date.getTime())) {
        return {
          date: date.toLocaleDateString(),
          time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
      }
    }

    return {
      date: 'Schedule pending',
      time: '',
    };
  })();
  const specialInstructions = customer.specialInstructions || delivery?.specialInstructions;

  const handleCopyAddress = async () => {
    if (!fullAddressText) return;

    try {
      await Clipboard.setStringAsync(fullAddressText);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 1500);
    } catch (error) {
      logger.error('Failed to copy address:', error);
      Alert.alert('Copy failed', 'Could not copy the address. Please try again.');
    }
  };

  const handleAcknowledgeChange = async () => {
    if (acknowledgingChange) return;
    setAcknowledgingChange(true);
    try {
      await deliveryService.acknowledgeChange(deliveryId);
      setDelivery((d) => (d ? { ...d, changeFlag: { ...d.changeFlag, active: false } } : d));
    } catch (error) {
      logger.error('Failed to acknowledge delivery change:', error);
      Alert.alert('Could not clear', 'Please try again.');
    } finally {
      setAcknowledgingChange(false);
    }
  };

  const handleOpenMap = async () => {
    if (!hasMapLink) {
      return;
    }

    try {
      const supported = await Linking.canOpenURL(mapsUrl);
      if (!supported) {
        Alert.alert('Map unavailable', 'This Google Maps link cannot be opened on this device.');
        return;
      }

      await Linking.openURL(mapsUrl);
    } catch (error) {
      logger.error('Failed to open map link:', error);
      Alert.alert('Map unavailable', 'Unable to open the Google Maps link right now.');
    }
  };

  const handleOpenIn2GIS = async () => {
    if (!has2GisTarget) return;

    try {
      await Clipboard.setStringAsync(fullAddressText);
      setAddressCopied(true);
      setTimeout(() => setAddressCopied(false), 1500);

      const supported = await Linking.canOpenURL(twoGisUrl);
      if (!supported) {
        Alert.alert('2GIS unavailable', 'Address copied, but 2GIS could not be opened on this device.');
        return;
      }

      await Linking.openURL(twoGisUrl);
    } catch (error) {
      logger.error('Failed to open 2GIS:', error);
      Alert.alert('2GIS unavailable', 'Address copied, but unable to open 2GIS right now.');
    }
  };

  const handleCompleteDeliveryFlow = () => {
    if (delivery?.displayStatus === 'delivered' || submitting) {
      return;
    }

    if (!deliveryPhoto) {
      navigation.navigate('Camera', {
        deliveryId,
        source: 'complete-delivery'
      });
      return;
    }

    navigation.navigate('QRScanner', {
      deliveryId,
      mode: 'delivery'
    });
  };

  const submitDeliveryCompletion = async (bagId) => {
    if (submitting) return;
    const session = offlineSyncService.getSessionGeneration();
    setSubmitting(true);
    try {
      // Best-effort, never blocks completion — see captureCompletionLocation.
      const location = await captureCompletionLocation();
      if (session !== offlineSyncService.getSessionGeneration()) throw new Error('Session changed. Please try again.');
      let photoUrl = null;

      // deliveryPhoto is already a remote URL (not a fresh local capture)
      // when this delivery carries a photo from an earlier attempt — e.g.
      // the photo uploaded fine but the completion call itself failed, and
      // the driver is retrying. Re-uploading it as if it were a local file
      // would fail immediately (it's not a file:// / content:// / data:
      // URI), and — worse, now that a failure here queues for background
      // retry — that failure would sit in the sync queue retrying forever
      // since it can never succeed. Treat an already-remote URL as done.
      if (typeof deliveryPhoto === 'string' && /^https?:\/\//i.test(deliveryPhoto)) {
        photoUrl = deliveryPhoto;
      } else if (deliveryPhoto) {
        logger.log('📸 Uploading delivery photo...');

        try {
          photoUrl = await deliveryService.uploadPhoto(deliveryPhoto);
          logger.log('✅ Photo uploaded:', photoUrl);
        } catch (uploadError) {
          if (!isRetryableError(uploadError)) throw uploadError;
          // The photo upload is a much bigger request than the completion
          // payload below, so it's the first thing to die on a bad
          // connection — treat that the same as every other failure in this
          // flow (queue for background sync) instead of hard-blocking the
          // driver here. Without this, poor connectivity during just the
          // photo step dead-ended the driver with no offline fallback,
          // unlike every other path in this screen.
          logger.error('❌ Photo upload failed, queuing offline:', uploadError);
          const queueItem = await offlineSyncService.addToSyncQueue(deliveryId, 'completeDeliveryWithPhoto', {
            photo: deliveryPhoto,
            proof: {
              timestamp: new Date().toISOString(),
              type: bagId ? 'qr_and_photo' : 'photo_only',
              verified: !!bagId,
              bagId: bagId || null,
              deliveryMethod: bagId ? 'qr_verified' : 'photo_only',
              qrSkipped: !bagId,
              notes: bagId ? 'Delivery verified with QR code' : 'Driver completed delivery without QR code',
            },
            bagId,
            location,
          }, session);
          dispatch(recordQueuedAction(queueItem));
          setDelivery((d) => (d ? { ...d, displayStatus: 'delivered' } : d));
          setDoneMode('delivered-offline');
          setStep('done');
          setSubmitting(false);
          return;
        }
      }

      // Prepare proof data matching web app structure
      const proofData = {
        timestamp: new Date().toISOString(),
        type: bagId ? 'qr_and_photo' : 'photo_only',
        verified: !!bagId,
        bagId: bagId || null,
        images: photoUrl ? [photoUrl] : [],
        deliveryMethod: bagId ? 'qr_verified' : 'photo_only',
        photoUrl: photoUrl,
        qrSkipped: !bagId,
        notes: bagId ? 'Delivery verified with QR code' : 'Driver completed delivery without QR code'
      };

      logger.log('📦 Submitting delivery with proof data:', {
        deliveryId: deliveryId,
        status: 'delivered',
        proof: proofData
      });

      // Routed through the Redux thunk (instead of calling deliveryService
      // directly) so that a failure here queues into offlineSyncService the
      // same way every other completion path in the app already does.
      if (session !== offlineSyncService.getSessionGeneration()) throw new Error('Session changed. Please try again.');
      const result = await dispatch(completeDelivery({ deliveryId, proof: proofData, photoUrl, bagId, location })).unwrap();

      setDelivery((d) => (d ? { ...d, displayStatus: 'delivered' } : d));
      setDoneMode(result?.queued ? 'delivered-offline' : 'delivered');
      setStep('done');
      setSubmitting(false);
    } catch (error) {
      logger.error('Could not complete delivery:', error);
      Alert.alert('Delivery not saved', typeof error === 'string' ? error : error?.message || 'Please try again.');
      setSubmitting(false);
    }
  };

  const handleReportFailed = async () => {
    if (!failReason || failSubmitting) return;
    setFailSubmitting(true);
    try {
      const result = await dispatch(updateDeliveryStatus({
        deliveryId,
        status: 'cancelled',
        proof: {
          timestamp: new Date().toISOString(),
          failReason,
          note: failNote.trim(),
        },
      })).unwrap();
      setDelivery((d) => (d ? { ...d, displayStatus: 'cancelled' } : d));
      setDoneMode(result?.queued ? 'failed-offline' : 'failed');
      setStep('done');
    } catch (error) {
      Alert.alert('Report not saved', typeof error === 'string' ? error : error?.message || 'Please try again.');
    } finally {
      setFailSubmitting(false);
    }
  };

  const handleRetryDelivery = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await dispatch(updateDeliveryStatus({ deliveryId, status: 'pending' })).unwrap();
      setDelivery((d) => (d ? { ...d, displayStatus: 'pending' } : d));
    } catch (error) {
      Alert.alert('Retry not saved', typeof error === 'string' ? error : error?.message || 'Please try again.');
    } finally {
      setRetrying(false);
    }
  };

  useEffect(() => {
    const scannedBagId = route.params?.scannedBagId;

    if (!scannedBagId) {
      return;
    }

    navigation.setParams({ scannedBagId: undefined });

    if (isBagCode(scannedBagId)) {
      submitDeliveryCompletion(scannedBagId);
      return;
    }

    Alert.alert('Invalid Bag', 'Please scan a valid bag QR code starting with BAG_');
  }, [navigation, route.params?.scannedBagId]);

  const getNextStep = () => {
    if (delivery?.displayStatus === 'delivered') {
      return {
        title: 'Delivery Complete',
        description: 'This delivery has been completed',
        buttonText: 'Delivered',
        onPress: null,
        icon: 'checkmark-circle',
        color: colors.lime,
        disabled: true
      };
    }

    return {
      title: 'Complete Delivery',
      description: deliveryPhoto
        ? 'Continue to QR scan and submit delivery proof'
        : 'Take photo first, then QR scanner opens automatically',
      buttonText: 'Complete Delivery',
      onPress: handleCompleteDeliveryFlow,
      icon: deliveryPhoto ? 'qr-code' : 'camera',
      color: colors.lime,
      disabled: false
    };
  };

  const nextStep = getNextStep();
  const isFailed = delivery?.displayStatus === 'cancelled';
  const backToDeliveries = () => navigation.navigate('Deliveries', {
    screen: 'DeliveriesList',
    params: { refresh: true },
  });

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-matterBg p-6">
        <ActivityIndicator size="large" color={colors.lime} />
        <Text className="mt-3 text-base text-matterMuted text-center">Loading delivery...</Text>
      </View>
    );
  }

  if (!delivery) {
    return (
      <View className="flex-1 justify-center items-center bg-matterBg p-6">
        <Ionicons name="alert-circle-outline" size={40} color={colors.muted} />
        <Text className="mt-3 text-base text-matterMuted text-center">Delivery details unavailable.</Text>
      </View>
    );
  }

  // ── STEP: FAIL — pick a reason, add a note, report the stop as failed ──
  if (step === 'fail') {
    const failReady = !!failReason;
    return (
      <View className="flex-1 bg-matterBg">
        <View className="px-5 flex-row items-center gap-3" style={{ paddingTop: insets.top + 16 }}>
          <TouchableOpacity
            className="w-10 h-10 rounded-full bg-matterCard items-center justify-center"
            onPress={() => setStep('details')}
          >
            <Ionicons name="arrow-back" size={20} color={colors.text} />
          </TouchableOpacity>
          <Text className="text-xl font-black text-matterText">Can't deliver</Text>
        </View>
        <ScrollView className="flex-1 px-5 pt-5">
          <Text className="text-sm text-matterMuted mb-4">Why can't this stop be delivered?</Text>
          <View className="gap-2.5">
            {FAIL_REASONS.map((reason) => {
              const active = failReason === reason.key;
              return (
                <TouchableOpacity
                  key={reason.key}
                  className="flex-row items-center gap-3 rounded-3xl p-4"
                  style={{
                    backgroundColor: active ? colors.danger : colors.card,
                    borderWidth: 1.5,
                    borderColor: active ? colors.danger : colors.border,
                  }}
                  onPress={() => setFailReason(reason.key)}
                  activeOpacity={0.85}
                >
                  <View
                    className="w-10 h-10 rounded-full items-center justify-center"
                    style={{ backgroundColor: active ? colors.bgAlt : colors.bg }}
                  >
                    <Ionicons name={reason.icon} size={18} color={colors.text} />
                  </View>
                  <View className="flex-1">
                    <Text className="text-base font-bold text-matterText">{reason.label}</Text>
                    <Text className="text-xs mt-0.5" style={{ color: active ? 'rgba(237,229,222,.8)' : colors.muted }}>
                      {reason.hint}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text className="text-xs uppercase tracking-[1px] text-matterMuted mt-5 mb-2">Note to ops (optional)</Text>
          <TextInput
            value={failNote}
            onChangeText={setFailNote}
            placeholder="Anything ops should know"
            placeholderTextColor={colors.muted}
            className="bg-matterCard border border-matterBorder rounded-2xl px-4 py-3.5 text-base text-matterText"
            multiline
          />

          <TouchableOpacity
            className="rounded-full py-4 items-center mt-5"
            style={{ backgroundColor: failReady ? colors.danger : colors.border, opacity: failSubmitting ? 0.7 : 1 }}
            onPress={handleReportFailed}
            disabled={!failReady || failSubmitting}
          >
            {failSubmitting ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text className="font-bold text-base" style={{ color: failReady ? colors.text : colors.muted }}>
                Report failed stop
              </Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity className="py-3.5 items-center" onPress={() => setStep('details')}>
            <Text className="text-matterMuted font-semibold">Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── STEP: DONE — confirmation after completing or failing a stop ──
  if (step === 'done') {
    const failedDone = doneMode === 'failed' || doneMode === 'failed-offline';
    const offline = doneMode === 'delivered-offline' || doneMode === 'failed-offline';
    return (
      <View className="flex-1 bg-matterBg items-center justify-center px-8">
        <View
          className="w-20 h-20 rounded-full items-center justify-center mb-4"
          style={{ backgroundColor: failedDone ? colors.danger : colors.lime }}
        >
          <Text className="text-4xl font-black" style={{ color: failedDone ? colors.text : colors.bgAlt }}>
            {failedDone ? '!' : '✓'}
          </Text>
        </View>
        <Text className="text-2xl font-black text-matterText text-center">
          {failedDone ? 'Reported failed' : 'Delivered'}
        </Text>
        <Text className="text-sm text-matterMuted text-center mt-2">
          {customerName} · {failedDone ? 'ops notified, stop moved to Failed' : 'proof submitted'}
        </Text>
        <Text className="text-xs font-bold mt-2" style={{ color: offline ? colors.blue : colors.lime }}>
          {offline ? "Saved offline — will sync when back online" : 'Synced to ops'}
        </Text>
        <TouchableOpacity
          className="rounded-full px-10 py-4 mt-7 bg-matterBlue"
          onPress={backToDeliveries}
        >
          <Text className="text-matterBgAlt font-bold text-base">Back to deliveries</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── STEP: DETAILS ──
  return (
    <View className="flex-1 bg-matterBg">
      <View className="px-5 flex-row items-center gap-3" style={{ paddingTop: insets.top + 16 }}>
        <TouchableOpacity
          className="w-10 h-10 rounded-full bg-matterCard items-center justify-center"
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text className="text-xl font-black text-matterText">Stop details</Text>
      </View>
      <ScrollView className="flex-1" contentContainerStyle={{ padding: 20 }}>
        <View className="bg-matterCard rounded-3xl p-[22px]">
          <View className="flex-row justify-between items-center gap-2">
            <View className="flex-row items-center gap-[10px] flex-1">
              <View className="rounded-[10px] w-7 h-7 items-center justify-center" style={{ backgroundColor: colors.cardAlt }}>
                <Text className="text-matterMuted text-[13px] font-bold">{stopNumber ?? '•'}</Text>
              </View>
              <Text className="text-[21px] font-black text-matterText flex-1" numberOfLines={1}>{customerName}</Text>
            </View>
            <View className="rounded-full px-3 py-[5px]" style={{ backgroundColor: statusMeta.color }}>
              <Text className="text-[11px] font-bold" style={{ color: colors.bgAlt }}>{statusMeta.label}</Text>
            </View>
          </View>

          <View className="mt-[18px] gap-3">
            <View className="flex-row justify-between gap-3">
              <Text className="text-sm text-matterMuted">Zone</Text>
              <Text className="text-sm font-semibold text-matterText">{customerZone}</Text>
            </View>
            <View className="flex-row justify-between items-start gap-3">
              <Text className="text-sm text-matterMuted mt-0.5">Address</Text>
              <TouchableOpacity
                className="flex-1 flex-row items-center justify-end gap-1.5 ml-4"
                onPress={handleCopyAddress}
                activeOpacity={0.6}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text className="text-sm font-semibold text-matterText text-right flex-1">
                  {fullAddressText}
                </Text>
                <Ionicons
                  name={addressCopied ? 'checkmark-circle' : 'copy-outline'}
                  size={16}
                  color={addressCopied ? colors.lime : colors.muted}
                />
              </TouchableOpacity>
            </View>
            <View className="flex-row justify-between gap-3">
              <Text className="text-sm text-matterMuted">Window</Text>
              <Text className="text-sm font-semibold text-matterText">
                {[deliveryWindow.date, deliveryWindow.time].filter(Boolean).join(' · ') || 'Schedule pending'}
              </Text>
            </View>
            <View className="flex-row justify-between gap-3">
              <Text className="text-sm text-matterMuted">Phone</Text>
              <Text className="text-sm font-semibold text-matterText">{customerPhone}</Text>
            </View>
            <View className="flex-row justify-between items-center gap-3">
              <Text className="text-sm text-matterMuted">Bags</Text>
              <View className="rounded-full px-3 py-[5px]" style={{ backgroundColor: 'rgba(77,158,255,0.16)' }}>
                <Text className="text-xs font-bold" style={{ color: colors.blue }}>
                  📦 {bagsAssigned} bag{bagsAssigned === 1 ? '' : 's'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {!!delivery?.changeFlag?.active && (
          <View
            className="mt-3.5 rounded-3xl p-4"
            style={{ backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.purple }}
          >
            <View className="flex-row gap-3 items-center">
              <View
                className="w-[34px] h-[34px] rounded-full items-center justify-center"
                style={{ backgroundColor: colors.purple }}
              >
                <Text style={{ color: colors.bgAlt, fontSize: 17 }}>⟳</Text>
              </View>
              <View className="flex-1">
                <Text className="text-[10.5px] uppercase tracking-[1px] font-bold" style={{ color: colors.purple }}>
                  Changed since assignment
                </Text>
                <Text className="text-sm font-semibold mt-1 text-matterText">{delivery.changeFlag.note}</Text>
              </View>
            </View>
            <TouchableOpacity
              className="rounded-full items-center mt-3 py-2.5"
              style={{ backgroundColor: colors.purple, opacity: acknowledgingChange ? 0.7 : 1 }}
              onPress={handleAcknowledgeChange}
              disabled={acknowledgingChange}
            >
              {acknowledgingChange ? (
                <ActivityIndicator size="small" color={colors.bgAlt} />
              ) : (
                <Text style={{ color: colors.bgAlt, fontWeight: '700', fontSize: 13 }}>Got it</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {!!specialInstructions && (
          <View
            className="mt-3.5 rounded-3xl p-5 flex-row gap-3.5 items-start overflow-hidden"
            style={{ backgroundColor: colors.paper }}
          >
            <View
              className="absolute rounded-full"
              style={{ right: -26, top: -26, width: 96, height: 96, backgroundColor: 'rgba(5,23,71,0.06)' }}
            />
            <View className="w-[38px] h-[38px] rounded-full items-center justify-center bg-matterBgAlt">
              <Text style={{ fontSize: 17 }}>📝</Text>
            </View>
            <View className="flex-1">
              <Text className="text-[11px] uppercase tracking-[1px] font-bold" style={{ color: colors.bgAlt, opacity: 0.6 }}>
                Customer note
              </Text>
              <Text className="text-[15px] font-semibold mt-1" style={{ color: colors.bgAlt }}>{specialInstructions}</Text>
            </View>
          </View>
        )}

        <View className="flex-row gap-2.5 mt-3.5">
          <TouchableOpacity
            className="flex-1 flex-row items-center justify-center rounded-full"
            style={{
              backgroundColor: colors.card,
              borderWidth: 1.5,
              borderColor: colors.border,
              paddingVertical: 13,
              gap: 10,
              opacity: hasMapLink ? 1 : 0.45,
            }}
            onPress={handleOpenMap}
            disabled={!hasMapLink}
            activeOpacity={0.7}
          >
            <GoogleMapsIcon size={22} />
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>Maps</Text>
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-1 flex-row items-center justify-center rounded-full"
            style={{
              backgroundColor: colors.card,
              borderWidth: 1.5,
              borderColor: colors.border,
              paddingVertical: 13,
              gap: 10,
              opacity: has2GisTarget ? 1 : 0.45,
            }}
            onPress={handleOpenIn2GIS}
            disabled={!has2GisTarget}
            activeOpacity={0.7}
          >
            <TwoGisIcon size={22} />
            <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>2GIS</Text>
          </TouchableOpacity>
        </View>

        {isFailed ? (
          <View className="mt-3.5 rounded-3xl p-5" style={{ borderWidth: 1.5, borderColor: colors.danger }}>
            <View className="flex-row items-start gap-3">
              <Text style={{ color: colors.danger, fontSize: 18 }}>⚠</Text>
              <View className="flex-1">
                <Text className="text-xs uppercase tracking-[1px] font-bold" style={{ color: colors.danger }}>
                  Marked failed
                </Text>
                <Text className="text-sm text-matterMuted mt-1.5">
                  Ops has been notified. Retry once resolved.
                </Text>
              </View>
            </View>
            <TouchableOpacity
              className="rounded-full py-3.5 items-center mt-4 bg-matterBlue"
              style={{ opacity: retrying ? 0.7 : 1 }}
              onPress={handleRetryDelivery}
              disabled={retrying}
            >
              {retrying ? (
                <ActivityIndicator size="small" color={colors.bgAlt} />
              ) : (
                <Text className="text-matterBgAlt font-bold">Retry this stop</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <TouchableOpacity
              className="flex-row items-center p-5 mt-3.5 rounded-3xl"
              style={{ backgroundColor: nextStep.color, opacity: nextStep.disabled || submitting ? 0.6 : 1 }}
              onPress={nextStep.onPress}
              disabled={nextStep.disabled || submitting}
            >
              {submitting ? (
                <>
                  <ActivityIndicator size="small" color={colors.bgAlt} />
                  <View className="flex-1 ml-3">
                    <Text className="text-matterBgAlt text-lg font-bold">Processing...</Text>
                    <Text className="text-matterBgAlt/80 text-sm mt-0.5">Completing delivery</Text>
                  </View>
                </>
              ) : (
                <>
                  <Ionicons name={nextStep.icon} size={24} color={colors.bgAlt} />
                  <View className="flex-1 ml-3">
                    <Text className="text-matterBgAlt text-lg font-bold">{nextStep.buttonText}</Text>
                    <Text className="text-matterBgAlt/80 text-sm mt-0.5">{nextStep.description}</Text>
                  </View>
                  {!nextStep.disabled && <Ionicons name="chevron-forward" size={20} color={colors.bgAlt} />}
                </>
              )}
            </TouchableOpacity>

            {!nextStep.disabled && (
              <TouchableOpacity
                className="items-center py-4"
                onPress={() => { setFailReason(null); setFailNote(''); setStep('fail'); }}
              >
                <Text className="text-matterMuted font-semibold">Can't deliver? Report an issue</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
};

export default DeliveryDetailsScreen;
