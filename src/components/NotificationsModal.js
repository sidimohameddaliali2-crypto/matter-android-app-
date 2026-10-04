import React, { useEffect } from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { markAllRead } from '../store/notificationsSlice';
import { navigate } from '../navigation/navigationRef';
import { colors } from '../theme/matterTheme';

const TYPE_META = {
  delivery_created: { color: colors.blue, icon: 'cube-outline' },
  delivery_reassigned: { color: colors.purple, icon: 'swap-horizontal-outline' },
  delivery_removed: { color: colors.danger, icon: 'close-circle-outline' },
  delivery_updated: { color: colors.lime, icon: 'refresh-outline' },
};

const formatRelativeTime = (timestamp) => {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const NotificationsModal = ({ visible, onClose }) => {
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const items = useSelector((state) => state.notifications.items);

  // Viewing the list is the "read" action — clears the bell badge without
  // needing a separate "mark all read" control.
  useEffect(() => {
    if (visible) dispatch(markAllRead());
  }, [visible, dispatch]);

  const handlePress = (item) => {
    onClose();
    if (item.deliveryId && item.type !== 'delivery_removed') {
      navigate('Main', {
        screen: 'Deliveries',
        params: { screen: 'DeliveryDetails', params: { deliveryId: item.deliveryId } },
      });
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-matterBg" style={{ paddingTop: insets.top + 16 }}>
        <View className="px-5 flex-row items-center justify-between mb-2">
          <Text className="text-2xl font-black text-matterText">Notifications</Text>
          <TouchableOpacity
            className="w-10 h-10 rounded-full bg-matterCard items-center justify-center"
            onPress={onClose}
          >
            <Ionicons name="close" size={20} color={colors.text} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 20, paddingTop: 8, flexGrow: 1 }}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center py-24">
              <Ionicons name="notifications-off-outline" size={40} color={colors.border} />
              <Text className="text-matterMuted mt-4">No notifications yet</Text>
            </View>
          }
          renderItem={({ item }) => {
            const meta = TYPE_META[item.type] || { color: colors.blue, icon: 'notifications-outline' };
            return (
              <TouchableOpacity
                className="bg-matterCard rounded-3xl p-4 mb-3 border-l-[5px] flex-row gap-3"
                style={{ borderLeftColor: meta.color }}
                activeOpacity={0.85}
                onPress={() => handlePress(item)}
              >
                <View
                  className="w-10 h-10 rounded-full items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: colors.bg }}
                >
                  <Ionicons name={meta.icon} size={18} color={meta.color} />
                </View>
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    {!item.read && <View className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.lime }} />}
                    <Text className="text-base font-bold text-matterText flex-1" numberOfLines={1}>{item.title}</Text>
                  </View>
                  {!!item.body && (
                    <Text className="text-sm text-matterMuted mt-1" numberOfLines={2}>{item.body}</Text>
                  )}
                  <Text className="text-xs text-matterMuted mt-2">{formatRelativeTime(item.receivedAt)}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </View>
    </Modal>
  );
};

export default NotificationsModal;
