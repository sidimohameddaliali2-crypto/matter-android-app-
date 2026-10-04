// screens/CameraScreen.js
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Alert, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import logger from '../utils/logger';

const CameraScreen = ({ navigation, route }) => {
  const { source } = route.params || {};
  const [permission, requestPermission] = useCameraPermissions();
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  const handleCapture = async () => {
    if (!cameraRef.current || !isCameraReady || compressing || isCapturing) return;
    setIsCapturing(true);
    try {
      // skipProcessing: false (the previous setting) makes expo-camera do
      // extra native post-processing (EXIF/orientation normalization,
      // mirroring) on the raw capture before returning it — this is a
      // well-documented source of takePictureAsync throwing outright on a
      // meaningful slice of Android devices/chipsets, and matches drivers
      // reporting "Failed to capture photo" consistently, not intermittently.
      // Safe to skip here regardless: the ImageManipulator resize step right
      // below re-encodes the image anyway (and still honors EXIF orientation
      // when reading the source), so nothing is actually lost downstream.
      const raw = await cameraRef.current.takePictureAsync({
        quality: 1,
        base64: false,
        skipProcessing: true,
      });

      // Save a copy to the driver's own gallery, independent of everything
      // below — it's a purely local file-system write, no network involved,
      // so it happens identically whether the device is online or offline
      // (unlike the upload flow, which the completion screen already
      // queues for later sync when offline). Best-effort and silent: a
      // driver who's never granted media-library access still completes
      // the delivery exactly as before, just without a personal copy.
      MediaLibrary.requestPermissionsAsync()
        .then((permission) => (permission.granted ? MediaLibrary.saveToLibraryAsync(raw.uri) : null))
        .catch((saveError) => {
          logger.warn('Could not save delivery photo to gallery:', saveError?.message || saveError);
        });

      setCompressing(true);
      const compressed = await ImageManipulator.manipulateAsync(
        raw.uri,
        [{ resize: { width: 1200 } }],
        {
          compress: 0.75,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        }
      );

      setPhoto({ uri: compressed.uri, base64: compressed.base64 });
    } catch (error) {
      // Include the real error message in the alert (not just logger.error,
      // which console.error's — release builds have no crash reporting wired
      // up, so that's otherwise invisible to us). A driver reporting a
      // generic "Failed to capture photo" gives us nothing to diagnose from;
      // this at least lets them relay the actual reason next time. Camera
      // hardware can also be legitimately preempted by an active phone call
      // on some devices, hence the added hint.
      logger.error('Error capturing / compressing photo:', error);
      Alert.alert(
        'Error',
        `Failed to capture photo${error?.message ? `: ${error.message}` : ''}. If you're on a call, try again after it ends.`
      );
    } finally {
      setCompressing(false);
      setIsCapturing(false);
    }
  };

  const handleRetake = () => setPhoto(null);

  const toggleFlash = () => setIsFlashOn((prev) => !prev);

  const handleConfirm = () => {
    navigation.navigate({
      name: 'DeliveryDetails',
      params: {
        capturedPhoto: photo,
        photoSource: source,
      },
      merge: true,
    });
  };

  // ── Permission states ──────────────────────────────────────────────────────

  if (!permission) {
    return (
      <View style={styles.centered}>
        <Text style={styles.whiteText}>Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.centered, { paddingHorizontal: 24 }]}>
        <Ionicons name="camera-outline" size={64} color="#666" />
        <Text style={[styles.whiteText, { textAlign: 'center', marginTop: 16, marginBottom: 10 }]}>
          We need your permission to use the camera
        </Text>
        <TouchableOpacity style={styles.grantBtn} onPress={requestPermission}>
          <Text style={styles.btnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Review screen (photo taken) ────────────────────────────────────────────

  if (photo) {
    const previewUri = photo.base64
      ? `data:image/jpeg;base64,${photo.base64}`
      : photo.uri;

    return (
      <View style={styles.flex}>
        <Image source={{ uri: previewUri }} style={styles.flex} resizeMode="contain" />
        <View style={styles.reviewBar}>
          <View style={styles.reviewRow}>
            <TouchableOpacity style={[styles.reviewBtn, { backgroundColor: '#4b5563' }]} onPress={handleRetake}>
              <Text style={styles.btnText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.reviewBtn, { backgroundColor: '#2563eb' }]} onPress={handleConfirm}>
              <Text style={styles.btnText}>Use Photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Live viewfinder ────────────────────────────────────────────────────────

  const isBusy = compressing || isCapturing;

  return (
    <View style={styles.flex}>
      {/* Camera fills the whole screen — no pointerEvents manipulation */}
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFillObject}
        facing="back"
        enableTorch={isFlashOn}
        onCameraReady={() => setIsCameraReady(true)}
        onMountError={(error) => {
          // A real hardware-level failure (e.g. camera resource unavailable
          // — can happen if another app, like an active phone call's camera
          // hooks, is holding it) — unlike a takePictureAsync failure, the
          // camera never finished initializing here, so the shutter button
          // must stay disabled rather than let the driver tap into a broken
          // capture.
          logger.error('Camera failed to mount:', error);
          setIsCameraReady(false);
        }}
      />

      {/* UI overlay sits OUTSIDE <Camera> — normal touch handling */}
      <View style={[StyleSheet.absoluteFillObject, styles.overlay]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="close" size={28} color="white" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, isFlashOn && styles.flashActive]}
            onPress={toggleFlash}
            activeOpacity={0.8}
          >
            <Ionicons name={isFlashOn ? 'flash' : 'flash-off'} size={20} color="white" />
          </TouchableOpacity>
        </View>

        {/* Capture button */}
        <View style={styles.captureArea}>
          {!isCameraReady && (
            <Text style={styles.readyText}>Camera initializing...</Text>
          )}
          <TouchableOpacity
            style={[styles.captureBtn, isBusy && styles.captureBtnBusy]}
            onPress={handleCapture}
            activeOpacity={0.7}
            disabled={isBusy || !isCameraReady}
          >
            {isBusy ? (
              <ActivityIndicator size="small" color="#4fa1ff" />
            ) : (
              <View style={styles.captureInner} />
            )}
          </TouchableOpacity>
          {isBusy && (
            <Text style={styles.statusText}>
              {isCapturing && !compressing ? 'Taking photo…' : 'Compressing…'}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  whiteText: { color: '#fff', fontSize: 16 },
  overlay: { justifyContent: 'space-between' },
  header: { paddingTop: 48, paddingHorizontal: 24, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  flashActive: { backgroundColor: 'rgba(234,179,8,0.8)' },
  captureArea: { paddingBottom: 40, paddingHorizontal: 24, alignItems: 'center' },
  captureBtn: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#d1d5db' },
  captureBtnBusy: { opacity: 0.7 },
  captureInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  statusText: { color: '#fff', fontSize: 12, marginTop: 12, opacity: 0.7 },
  readyText: { color: '#fff', fontSize: 12, marginBottom: 12, opacity: 0.6 },
  grantBtn: { backgroundColor: '#2563eb', paddingHorizontal: 24, paddingVertical: 16, borderRadius: 8, marginTop: 20 },
  reviewBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingBottom: 40, paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.8)' },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-around', gap: 16 },
  reviewBtn: { flex: 1, paddingVertical: 16, borderRadius: 8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
});

export default CameraScreen;
