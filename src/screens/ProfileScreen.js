// screens/ProfileScreen.js
import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';

const ProfileScreen = () => {
  const insets = useSafeAreaInsets();
  const { user, driverProfile, logout } = useAuth();

  const displayName = (() => {
    const candidates = [
      user?.name, user?.profile?.name, user?.profile?.fullName,
      driverProfile?.name, driverProfile?.fullName, driverProfile?.profile?.name,
      user?.email ? user.email.split('@')[0] : null,
    ].filter(Boolean);
    const name = candidates[0];
    if (!name) return 'Driver';
    return String(name).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  })();

  const initials = displayName.split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || 'DR';

  const driverId = driverProfile?.driverId || user?._id?.slice(-8) || 'N/A';
  const phone = driverProfile?.phone || driverProfile?.profile?.phone || user?.phone || user?.profile?.phone || 'N/A';
  const zone = driverProfile?.zone || driverProfile?.profile?.zone || driverProfile?.area || 'N/A';
  const vehicle = driverProfile?.vehicle || driverProfile?.profile?.vehicle || driverProfile?.vehicleNumber || 'N/A';
  const shift = driverProfile?.shift || driverProfile?.profile?.shift || 'N/A';
  const lastSync = driverProfile?.lastSync || 'Just now';

  const handleLogout = () => {
    Alert.alert(
      'Sign out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            await logout();
          }
        }
      ]
    );
  };

  const InfoRow = ({ label, value, isLast }) => (
    <View
      className={`flex-row justify-between py-4 ${isLast ? '' : 'border-b border-matterBorder'}`}
    >
      <Text className="text-sm text-matterMuted">{label}</Text>
      <Text className="text-sm font-semibold text-matterText">{value}</Text>
    </View>
  );

  return (
    <ScrollView className="flex-1 bg-matterBg">
      <View className="px-5 pb-6" style={{ paddingTop: insets.top + 20 }}>
        <Text className="text-3xl font-black text-matterText mb-6">Profile</Text>

        <View className="flex-row items-center">
          <View className="w-16 h-16 rounded-full bg-matterBlue items-center justify-center">
            <Text className="text-xl font-black text-matterBgAlt">{initials}</Text>
          </View>
          <View className="ml-4">
            <Text className="text-lg font-bold text-matterText">{displayName}</Text>
            <Text className="text-sm text-matterMuted mt-1">Driver ID · {driverId}</Text>
          </View>
        </View>

        <View className="bg-matterCard rounded-3xl px-5 mt-6">
          <InfoRow label="Phone" value={phone} />
          <InfoRow label="Zone" value={zone} />
          <InfoRow label="Vehicle" value={vehicle} />
          <InfoRow label="Shift" value={shift} />
          <InfoRow label="Last sync" value={lastSync} isLast />
        </View>

        <TouchableOpacity
          className="rounded-full flex-row items-center justify-center mt-6 py-4 border-[1.5px] border-matterDanger"
          onPress={handleLogout}
        >
          <Text className="text-matterDanger text-base font-bold">Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

export default ProfileScreen;