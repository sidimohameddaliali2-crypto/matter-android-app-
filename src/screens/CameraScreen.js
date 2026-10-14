// screens/CameraScreen.js
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Alert, Image, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { Ionicons } from '@expo/vector-icons';
import logger from '../utils/logger';
import { useIsFocused } from '@react-navigation/native';
import { persistProofPhoto, deletePhotoFile } from '../services/photoStorage';

const CameraScreen = ({ navigation, route }) => {
  const { source } = route.params || {};
  const [permission, requestPermission] = useCameraPermissions();
  const [isFlashOn, setIsFlashOn] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef(null);
  const isFocused = useIsFocused();
  const captureLock = useRef(false);
  const generation = useRef(0);
  const ownedPhoto = useRef(null);

  useEffect(() => {
    setIsCameraReady(false);
    setPhoto(null);
    setCompressing(false);
    setIsCapturing(false);
    return () => {
      generation.current += 1;
      const abandoned = ownedPhoto.current;
      ownedPhoto.current = null;
      deletePhotoFile(abandoned?.uri);
    };
  }, [isFocused]);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  const handleCapture = async () => {
    if (!isFocused || !cameraRef.current || !isCameraReady || captureLock.current) return;
    captureLock.current = true;
    const captureGeneration = generation.current;
    const isCurrent = () => captureGeneration === generation.current;
    let raw;
    let compressed;
    let saved;
    setIsCapturing(true);
    try {
      raw = await cameraRef.current.takePictureAsync({ quality: 1, base64: false, skipProcessing: true });
      if (!isCurrent()) return;
      setCompressing(true);
      compressed = await ImageManipulator.manipulateAsync(
        raw.uri,
        raw.width > 1200 ? [{ resize: { width: 1200 } }] : [],
        { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG, base64: false }
      );
      if (!isCurrent()) return;
      saved = await persistProofPhoto(compressed.uri);
      if (!isCurrent()) return;
      // Await the local gallery operation before allowing retake to remove its
      // source file. No full-resolution or base64 copy is kept in JS state.
      try {
        const mediaPermission = await MediaLibrary.requestPermissionsAsync();
        if (mediaPermission.granted && isCurrent()) await MediaLibrary.saveToLibraryAsync(saved.uri);
      } catch (error) {
        logger.warn('Could not save delivery photo to gallery:', error?.message || error);
      }
      if (!isCurrent()) return;
      ownedPhoto.current = saved;
      setIsCameraReady(false);
      setPhoto(saved);
      saved = null;
    } catch (error) {
      if (isCurrent()) {
        logger.error('Error capturing / compressing photo:', error);
        Alert.alert('Error', `Failed to capture photo${error?.message ? `: ${error.message}` : ''}. If you're on a call, try again after it ends.`);
      }
    } finally {
      await Promise.all([deletePhotoFile(raw?.uri), deletePhotoFile(compressed?.uri), deletePhotoFile(saved?.uri)]);
      captureLock.current = false;
      if (isCurrent()) {
        setCompressing(false);
        setIsCapturing(false);
      }
    }
  };

  const handleRetake = () => {
    const discarded = ownedPhoto.current;
    ownedPhoto.current = null;
    setIsCameraReady(false);
    setPhoto(null);
    deletePhotoFile(discarded?.uri);
  };

  const toggleFlash = () => setIsFlashOn((prev) => !prev);

  const handleConfirm = () => {
    if (!photo) return;
    ownedPhoto.current = null; // DeliveryDetails/offline queue now owns this file.
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

  if (!isFocused) return <View style={styles.flex} />;

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
    const previewUri = photo.uri;

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
        pictureSize={Platform.OS === 'android' ? '1600x1200' : undefined}
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
            accessibilityLabel="Take delivery photo"
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
