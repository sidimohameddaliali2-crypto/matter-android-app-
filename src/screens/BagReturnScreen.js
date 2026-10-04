// screens/BagReturnScreen.js
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, Alert, Modal, ActivityIndicator, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch } from 'react-redux';
import { returnBag } from '../store/deliveriesSlice';
import { isBagCode, toBagResourceId } from '../utils/bagId';
import { colors } from '../theme/matterTheme';

const BagReturnScreen = () => {
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const [scannedBags, setScannedBags] = useState([]);
  const [showScanner, setShowScanner] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [manualCode, setManualCode] = useState('BAG-0');
  const [isFlashOn, setIsFlashOn] = useState(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  const handleScanBag = (bagData) => {
    const raw = (bagData?.data || bagData || '').toString();

    if (!isBagCode(raw)) {
      Alert.alert('Invalid Scan', 'Could not read a valid bag ID from scan.');
      return;
    }

    const bagId = toBagResourceId(raw);

    if (scannedBags.some((bag) => bag.id === bagId)) {
      Alert.alert('Already Scanned', `Bag ${bagId} is already in the list.`);
      return;
    }

    const newBag = {
      id: bagId,
      timestamp: new Date().toISOString(),
    };

    setScannedBags((prev) => [...prev, newBag]);
  };

  const handleBarcodeScanned = ({ data }) => {
    if (scanLocked || isProcessing) {
      return;
    }

    setScanLocked(true);
    handleScanBag(data);

    // Small cooldown to prevent duplicate rapid scans of same code.
    setTimeout(() => setScanLocked(false), 900);
  };

  const handleManualSubmit = () => {
    if (!manualCode.trim()) {
      Alert.alert('Bag ID Required', 'Please enter a bag code like BAG-0.');
      return;
    }

    handleScanBag(manualCode);
  };

  const removeBag = (bagId) => {
    setScannedBags((prev) => prev.filter((bag) => bag.id !== bagId));
  };

  const clearAll = () => {
    setScannedBags([]);
  };

  const handleDone = async () => {
    if (scannedBags.length === 0) {
      Alert.alert('No Bags', 'Please scan at least one bag before pressing Done.');
      return;
    }

    setIsProcessing(true);

    const successfulIds = [];
    const failedIds = [];

    for (const bag of scannedBags) {
      try {
        await dispatch(
          returnBag({
            bagId: bag.id,
            notes: '',
            photoUrl: null,
          })
        ).unwrap();

        successfulIds.push(bag.id);
      } catch (error) {
        failedIds.push(bag.id);
      }
    }

    setIsProcessing(false);

    if (failedIds.length === 0) {
      Alert.alert('Success', `${successfulIds.length} bag(s) returned successfully.`);
      setScannedBags([]);
      return;
    }

    setScannedBags((prev) => prev.filter((bag) => failedIds.includes(bag.id)));

    Alert.alert(
      'Partial Success',
      `${successfulIds.length} bag(s) returned. ${failedIds.length} failed and remain in the list for retry.`
    );
  };

  return (
    <View className="flex-1 bg-matterBg">
      <View className="p-5 bg-matterCard border-b border-matterBorder" style={{ paddingTop: insets.top + 20 }}>
        <Text className="text-xl font-bold text-matterText">Return Bags</Text>
        <Text className="text-sm text-matterMuted mt-1">Scan multiple bag QR codes, then tap Done to return all.</Text>
      </View>

      <View className="p-5">
        <TouchableOpacity
          className="items-center p-6 border-[1.5px] border-matterBlue border-dashed rounded-3xl bg-matterCard"
          onPress={() => setShowScanner(true)}
          disabled={isProcessing}
        >
          <Ionicons name="qr-code-outline" size={40} color={colors.blue} />
          <Text className="text-matterBlue text-lg font-bold mt-3">Scan Bag QR Code</Text>
          <Text className="text-matterMuted text-sm mt-1">Each scan adds one bag to return list</Text>
        </TouchableOpacity>

        <View className="mt-6">
          <View className="flex-row justify-between items-center mb-3">
            <Text className="text-lg font-bold text-matterText">Scanned Bags ({scannedBags.length})</Text>
            {scannedBags.length > 0 && (
              <TouchableOpacity onPress={clearAll} disabled={isProcessing}>
                <Text className="text-matterDanger text-sm font-semibold">Clear All</Text>
              </TouchableOpacity>
            )}
          </View>

          <FlatList
            data={scannedBags}
            renderItem={({ item }) => (
              <View className="flex-row justify-between items-center p-3 rounded-2xl mb-2 bg-matterCard">
                <View className="flex-1">
                  <Text className="text-base font-bold text-matterText">{item.id}</Text>
                  <Text className="text-xs text-matterMuted mt-1">Ready to return</Text>
                </View>
                <TouchableOpacity className="p-2" onPress={() => removeBag(item.id)} disabled={isProcessing}>
                  <Ionicons name="close-circle" size={24} color={colors.danger} />
                </TouchableOpacity>
              </View>
            )}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View className="py-10 items-center">
                <Ionicons name="cube-outline" size={36} color={colors.border} />
                <Text className="text-matterMuted mt-2">No bags scanned yet</Text>
              </View>
            }
          />
        </View>
      </View>

      <View className="px-5 pb-6 pt-2 bg-matterCard border-t border-matterBorder">
        <TouchableOpacity
          className="bg-matterLime py-4 rounded-full flex-row items-center justify-center"
          onPress={handleDone}
          disabled={isProcessing || scannedBags.length === 0}
          style={{ opacity: isProcessing || scannedBags.length === 0 ? 0.6 : 1 }}
        >
          {isProcessing ? (
            <>
              <ActivityIndicator size="small" color={colors.bgAlt} />
              <Text className="text-matterBgAlt text-center font-bold text-base ml-2">Returning bags...</Text>
            </>
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={colors.bgAlt} />
              <Text className="text-matterBgAlt text-center font-bold text-base ml-2">
                Done - Return {scannedBags.length} Bag{scannedBags.length === 1 ? '' : 's'}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      <Modal visible={showScanner} animationType="slide">
        <View className="flex-1 bg-black">
          <View className="absolute top-0 left-0 right-0 flex-row justify-between items-center p-5 bg-white z-10">
            <TouchableOpacity onPress={() => setShowScanner(false)}>
              <Ionicons name="close" size={24} color="#000" />
            </TouchableOpacity>
            <Text className="text-lg font-bold">Scan QR Code</Text>
            <TouchableOpacity
              className="w-10 h-10 rounded-full justify-center items-center"
              style={{ backgroundColor: isFlashOn ? '#FFD60A' : 'rgba(0,0,0,0.1)' }}
              onPress={() => setIsFlashOn(prev => !prev)}
            >
              <Ionicons name={isFlashOn ? 'flash' : 'flash-off'} size={22} color={isFlashOn ? '#000' : '#555'} />
            </TouchableOpacity>
          </View>

          {permission && !permission.granted ? (
            <View className="flex-1 justify-center items-center px-6">
              <Ionicons name="camera-outline" size={56} color="#9CA3AF" />
              <Text className="text-white text-base text-center mt-4">Camera permission is required for scanning.</Text>
              <TouchableOpacity
                className="bg-matterBlue px-6 py-3 rounded-full mt-6"
                onPress={requestPermission}
              >
                <Text className="text-matterBgAlt font-bold">Grant Permission</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              enableTorch={isFlashOn}
              onBarcodeScanned={scanLocked ? undefined : handleBarcodeScanned}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            >
              <View className="flex-1 bg-black/35 justify-between pt-24 pb-8 px-5">
                <View className="items-center">
                  <Text className="text-white text-lg font-semibold">Scan Bag QR</Text>
                  <Text className="text-white/80 text-sm mt-2">Scan multiple bags, then tap Done Scanning.</Text>
                </View>

                <View className="items-center">
                  <View className="w-[250px] h-[250px] relative">
                    <View className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-matterBlue rounded-tl-xl" />
                    <View className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-matterBlue rounded-tr-xl" />
                    <View className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-matterBlue rounded-bl-xl" />
                    <View className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-matterBlue rounded-br-xl" />
                  </View>
                </View>

                <View className="bg-black/55 rounded-2xl p-4">
                  <Text className="text-white text-sm font-semibold mb-2">Enter Bag ID Manually</Text>
                  <TextInput
                    value={manualCode}
                    onChangeText={setManualCode}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    placeholder="BAG-0"
                    placeholderTextColor="#9CA3AF"
                    className="bg-matterCard rounded-full px-4 py-3 text-base text-matterText"
                    editable={!isProcessing}
                  />
                  <TouchableOpacity
                    className="mt-3 rounded-full px-4 py-3 items-center bg-matterBlue"
                    onPress={handleManualSubmit}
                    disabled={isProcessing}
                  >
                    <Text className="text-matterBgAlt font-bold">Add Bag ID</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    className="mt-3 rounded-full px-4 py-3 items-center bg-matterLime"
                    onPress={() => setShowScanner(false)}
                  >
                    <Text className="text-matterBgAlt font-bold">Done Scanning</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </CameraView>
          )}
        </View>
      </Modal>
    </View>
  );
};

export default BagReturnScreen;
