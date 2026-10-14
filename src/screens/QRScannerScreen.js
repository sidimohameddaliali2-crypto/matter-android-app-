// screens/QRScannerScreen.js
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Alert, Modal, TextInput, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useDispatch } from 'react-redux';
import { returnBag } from '../store/deliveriesSlice';
import { isBagCode, toBagScanCode } from '../utils/bagId';

const QRScannerScreen = ({ navigation, route }) => {
  const dispatch = useDispatch();
  const isFocused = useIsFocused();
  const successTimer = useRef(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = isFocused;
    setScanned(false);
    setShowSuccess(false);
    setReturning(false);
    return () => { active.current = false; clearTimeout(successTimer.current); };
  }, [isFocused]);
  const [facing, setFacing] = useState('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [manualCode, setManualCode] = useState('BAG-0');
  const [returning, setReturning] = useState(false);
  const [returnQueued, setReturnQueued] = useState(false);
  const [isFlashOn, setIsFlashOn] = useState(false);

  const { mode, deliveryId } = route.params || {};

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  if (!isFocused || !permission) return <View />;

  if (!permission.granted) {
    return (
      <View className="flex-1 justify-center items-center bg-black px-6">
        <Text className="text-white text-base text-center pb-2.5">We need your permission to use the camera</Text>
        <TouchableOpacity className="bg-iosBlue px-4 py-4 rounded-lg mt-5" onPress={requestPermission}>
          <Text className="text-white text-base font-bold text-center">Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const processBagCode = (rawCode) => {
    if (!isBagCode(rawCode)) {
      handleInvalidScan();
      return;
    }

    if (mode === 'return') {
      // bagService normalizes to the REST resource-id format internally.
      handleReturnScan(rawCode.toString().trim().toUpperCase());
    } else {
      // Delivery-completion proof carries the literal QR scan-code format.
      handleDeliveryScan(toBagScanCode(rawCode));
    }
  };

  const handleBarcodeScanned = ({ type, data }) => {
    if (active.current && !scanned) {
      setScanned(true);
      processBagCode(data);
    }
  };

  const handleDeliveryScan = (bagId) => {
    setShowSuccess(true);
    
    successTimer.current = setTimeout(() => {
      setShowSuccess(false);
      navigation.navigate({
        name: 'DeliveryDetails',
        params: {
          deliveryId,
          scannedBagId: bagId,
        },
        merge: true,
      });
    }, 1500);
  };

  const handleReturnScan = async (bagId) => {
    setReturning(true);
    try {
      const result = await dispatch(returnBag({ bagId, notes: '', photoUrl: null })).unwrap();
      if (!active.current) return;
      setReturnQueued(!!result?.queued);
      setShowSuccess(true);
      successTimer.current = setTimeout(() => {
        setShowSuccess(false);
        setReturning(false);
        Alert.alert(result?.queued ? 'Saved offline' : 'Bag Returned', result?.queued ? `Bag ${bagId} saved offline for sync` : `Bag ${bagId} has been returned successfully`, [
          { text: 'OK', onPress: () => navigation.navigate('BagReturn') },
        ]);
      }, 1500);
    } catch (error) {
      if (!active.current) return;
      setReturning(false);
      setScanned(false);
      Alert.alert(
        'Return Failed',
        error?.message || 'Failed to return bag. Please try again.',
        [{ text: 'Try Again' }]
      );
    }
  };

  const handleInvalidScan = () => {
    Alert.alert('Invalid QR Code', 'Please scan a valid bag QR code', [
      { text: 'Try Again', onPress: () => setScanned(false) }
    ]);
  };

  const handleManualSubmit = () => {
    if (!manualCode.trim()) {
      Alert.alert('QR Code Required', 'Please enter the bag QR code.');
      return;
    }

    setScanned(true);
    processBagCode(manualCode);
  };

  const getTitle = () => mode === 'return' ? 'Scan Bag for Return' : 'Scan Bag QR Code';
  const getInstruction = () => mode === 'return' 
    ? 'Position the bag QR code within the frame to mark as returned'
    : 'Position the bag QR code within the frame to complete delivery';

  return (
    <View className="flex-1 bg-black">
      <CameraView
        style={{ flex: 1 }}
        facing={facing}
        enableTorch={facing === 'back' && isFlashOn}
        onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      >
        <View className="flex-1 bg-black/40">
          <View className="flex-row justify-between items-center p-5 pt-14">
            <TouchableOpacity
              className="w-10 h-10 rounded-full bg-black/60 justify-center items-center"
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="close" size={24} color="white" />
            </TouchableOpacity>

            <Text className="text-white text-lg font-bold text-center flex-1 mx-4">{getTitle()}</Text>

            <View className="flex-row items-center gap-2.5">
              {facing === 'back' && (
                <TouchableOpacity
                  className="w-10 h-10 rounded-full justify-center items-center"
                  style={{ backgroundColor: isFlashOn ? '#FFD60A' : 'rgba(0,0,0,0.6)' }}
                  onPress={() => setIsFlashOn((prev) => !prev)}
                >
                  <Ionicons name={isFlashOn ? 'flash' : 'flash-off'} size={22} color={isFlashOn ? '#000' : 'white'} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                className="w-10 h-10 rounded-full bg-black/60 justify-center items-center"
                onPress={() => {
                  setIsFlashOn(false);
                  setFacing((current) => (current === 'back' ? 'front' : 'back'));
                }}
              >
                <Ionicons name="camera-reverse" size={24} color="white" />
              </TouchableOpacity>
            </View>
          </View>

          <View className="flex-1 justify-center items-center relative">
            <View className="w-[250px] h-[250px] relative">
              <View className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-iosBlue rounded-tl-xl" />
              <View className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-iosBlue rounded-tr-xl" />
              <View className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-iosBlue rounded-bl-xl" />
              <View className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-iosBlue rounded-br-xl" />
            </View>
            
            <View className="w-[200px] h-0.5 bg-iosBlue rounded-sm absolute top-1/2" />
          </View>

          <View className="p-5 items-center pb-10">
            <Text className="text-white text-base text-center mb-3 font-medium">{getInstruction()}</Text>

            <View className="w-full bg-black/55 rounded-2xl p-4 mb-4">
              <Text className="text-white text-sm font-semibold mb-2">Enter QR Code Manually</Text>
              <TextInput
                value={manualCode}
                onChangeText={setManualCode}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!showSuccess}
                placeholder="BAG-0"
                placeholderTextColor="#9CA3AF"
                className="bg-white rounded-xl px-4 py-3 text-base text-neutral-900"
              />
              <TouchableOpacity
                className="mt-3 rounded-xl px-4 py-3 items-center"
                style={{ backgroundColor: showSuccess ? '#6B7280' : '#0A84FF' }}
                onPress={handleManualSubmit}
                disabled={showSuccess}
              >
                <Text className="text-white font-semibold">Submit Code</Text>
              </TouchableOpacity>
            </View>
            
            {!scanned && (
              <View className="flex-row items-center bg-white/10 px-3 py-1.5 rounded-2xl gap-1.5">
                <Ionicons name="scan" size={16} color="white" />
                <Text className="text-white text-xs font-medium">Auto-scanning enabled</Text>
              </View>
            )}
            
            {scanned && !showSuccess && (
              <View className="flex-row items-center bg-green-500/20 px-3 py-1.5 rounded-2xl gap-1.5 border border-green-500/30">
                <Ionicons name="checkmark-circle" size={16} color="#34C759" />
                <Text className="text-green-500 text-xs font-medium">QR Code Detected</Text>
              </View>
            )}
          </View>
        </View>
      </CameraView>

      <Modal visible={showSuccess || returning} transparent animationType="fade" statusBarTranslucent>
        <View className="flex-1 bg-black/90 justify-center items-center">
          <View className="items-center bg-white/10 p-10 rounded-2xl m-5">
            {returning && !showSuccess ? (
              <>
                <ActivityIndicator size="large" color="#4fa1ff" style={{ marginBottom: 20 }} />
                <Text className="text-white text-xl font-bold mb-2">Returning bag…</Text>
              </>
            ) : (
              <>
                <View className="mb-5">
                  <Ionicons name="checkmark-circle" size={80} color="#34C759" />
                </View>
                <Text className="text-white text-2xl font-bold mb-2">Success!</Text>
                <Text className="text-white/80 text-base text-center mb-5">
                  {mode === 'return' ? (returnQueued ? 'Bag return saved offline' : 'Bag returned successfully') : 'Bag scanned. Submitting delivery proof next.'}
                </Text>
                <View className="w-5 h-5 rounded-full border-2 border-green-500 border-t-transparent" />
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default QRScannerScreen;