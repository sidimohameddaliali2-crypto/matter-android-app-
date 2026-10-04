import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  StyleSheet,
  TextInput,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { fetchDriverDeliveries, markDeliveryCompleted, processSyncQueue } from '../store/deliveriesSlice';
import { useAuth } from '../contexts/AuthContext';
import { notificationService } from '../services/notificationService';
import { isTodayUAE } from '../utils/uaeTime';
import { colors } from '../theme/matterTheme';

const isCollectionItem = (d) =>
  d.type === 'Collection' || (d.type === 'Task' && d.taskType === 'Bag Collection');

const STATUS_TABS = [
  { key: 'pending', label: 'Pending', color: colors.blue },
  { key: 'collection', label: 'Collection', color: colors.purple },
  { key: 'delivered', label: 'Delivered', color: colors.lime },
  { key: 'failed', label: 'Failed', color: colors.danger },
];

const STATUS_META = {
  pending: { label: 'Pending', color: colors.blue },
  delivered: { label: 'Delivered', color: colors.lime },
  cancelled: { label: 'Failed', color: colors.danger },
};

const formatTiming = (scheduledTime) => {
  if (!scheduledTime) return 'Time pending';
  const date = new Date(scheduledTime);
  if (Number.isNaN(date.getTime())) return 'Time pending';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const noteIcon = (text) => {
  if (/dog|animal|pet/i.test(text)) return '🐕';
  if (/call/i.test(text)) return '📞';
  if (/gate|lift|lobby|door/i.test(text)) return '🔑';
  return '📝';
};

const DeliveryItem = ({ item, index, onPress }) => {
  const customer = item.customer || {};
  const customerName = customer.name || item.customerName || 'Customer';
  const customerAddress = customer.address || item.address || 'Address not available';
  const customerZone =
    customer.zone || customer.area || customer.district || customer.sector ||
    item.zone || item.area || item.district || item.sector || 'Zone —';
  const instructions = customer.specialInstructions || item.specialInstructions || item.notes;
  const bagsAssigned = item.bagsAssigned ?? item.items ?? 0;
  const stopNumber = item.stop ?? item.sequence ?? item.order ?? index + 1;

  const isCollection = isCollectionItem(item);
  const meta = isCollection
    ? { label: 'Collection', color: colors.purple }
    : STATUS_META[item.displayStatus] || STATUS_META.pending;

  return (
    <TouchableOpacity
      className="bg-matterCard rounded-3xl p-[18px] mb-3 border-l-[5px]"
      style={{ borderLeftColor: meta.color }}
      onPress={() => onPress(item)}
      activeOpacity={0.85}
    >
      <View className="flex-row justify-between items-center gap-2">
        <View className="flex-row items-center gap-[9px] flex-1">
          <View className="bg-matterBg rounded-lg w-6 h-6 items-center justify-center">
            <Text className="text-matterMuted text-xs font-bold">{stopNumber}</Text>
          </View>
          <Text className="text-[17px] font-bold text-matterText flex-1" numberOfLines={1}>{customerName}</Text>
        </View>
        <View className="flex-row items-center gap-[6px]">
          {!!item.changeFlag?.active && (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.purple }} />
          )}
          <View className="rounded-full px-[11px] py-1" style={{ backgroundColor: meta.color }}>
            <Text className="text-xs font-bold" style={{ color: colors.bgAlt }}>{meta.label}</Text>
          </View>
        </View>
      </View>

      <View className="flex-row items-center gap-2 mt-2.5">
        <View className="rounded-full px-2.5 py-0.5 flex-shrink-0" style={{ borderWidth: 1.5, borderColor: colors.blue }}>
          <Text className="text-[11px] font-bold" style={{ color: colors.blue }}>{customerZone}</Text>
        </View>
        <Text className="text-matterPaper text-[13px] flex-1" numberOfLines={1}>{customerAddress}</Text>
      </View>

      <View className="flex-row items-center gap-2 mt-[9px]">
        <View className="rounded-full px-[11px] py-1" style={{ backgroundColor: 'rgba(77,158,255,0.16)' }}>
          <Text className="text-[11px] font-bold" style={{ color: colors.blue }}>
            📦 {bagsAssigned} bag{bagsAssigned === 1 ? '' : 's'}
          </Text>
        </View>
        <Text className="text-matterMuted text-[13px] font-semibold">⏱ {formatTiming(item.scheduledTime)}</Text>
      </View>

      {!!instructions && (
        <View className="flex-row items-start gap-2 mt-3 bg-matterBg rounded-2xl px-[13px] py-[11px]">
          <Text className="text-matterPaper text-[13px] leading-[18px] flex-1">
            {noteIcon(instructions)} {instructions}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const DeliveriesScreen = ({ navigation, route }) => {
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const { user, driverProfile } = useAuth();
  const { deliveries, loading, showTodayOnly, completedDeliveries } = useSelector((state) => state.deliveries);
  const [refreshing, setRefreshing] = useState(false);
  const [statusTab, setStatusTab] = useState('pending');
  const [searchTerm, setSearchTerm] = useState('');
  // Track previous delivery count to detect newly assigned deliveries
  const prevDeliveryCountRef = React.useRef(null);

  // Request notification permissions once when the screen first mounts
  useEffect(() => {
    notificationService.requestPermissions();
  }, []);

  // Fire a notification when new deliveries are added since the last fetch
  useEffect(() => {
    const current = Array.isArray(deliveries) ? deliveries.length : 0;
    if (prevDeliveryCountRef.current !== null && current > prevDeliveryCountRef.current) {
      notificationService.notifyNewDeliveries(current - prevDeliveryCountRef.current);
    }
    prevDeliveryCountRef.current = current;
  }, [deliveries]);

  const loadDeliveries = useCallback(async () => {
    setRefreshing(true);
    try {
      const driverId = driverProfile?.id || user?.id || user?._id;
      if (driverId) {
        await dispatch(fetchDriverDeliveries(driverId)).unwrap();
        try {
          await dispatch(processSyncQueue()).unwrap();
        } catch {
          // Non-fatal
        }
      } else {
        Alert.alert('Error', 'Driver profile not loaded. Please log in again.');
      }
    } catch (error) {
      Alert.alert('Error', error?.message || 'Unable to load deliveries');
    } finally {
      setRefreshing(false);
    }
  }, [dispatch, driverProfile, user]);

  useFocusEffect(
    useCallback(() => {
      loadDeliveries();
    }, [loadDeliveries])
  );

  useEffect(() => {
    const shouldRefresh = route?.params?.refresh;
    const openTab = route?.params?.openTab;
    const completedDeliveryId = route?.params?.completedDeliveryId;

    if (!shouldRefresh && !openTab && !completedDeliveryId) {
      return;
    }

    if (openTab && STATUS_TABS.some((tab) => tab.key === openTab)) {
      setStatusTab(openTab);
    }

    if (completedDeliveryId) {
      dispatch(markDeliveryCompleted(completedDeliveryId));
    }

    loadDeliveries();

    navigation.setParams({
      refresh: undefined,
      openTab: undefined,
      completedDeliveryId: undefined,
    });
  }, [
    route?.params?.refresh,
    route?.params?.openTab,
    route?.params?.completedDeliveryId,
    loadDeliveries,
    navigation,
    dispatch,
  ]);

  // Memoized filtering and searching
  const filteredDeliveries = useMemo(() => {
    let filtered = deliveries;

    if (showTodayOnly) {
      const todaysOnly = filtered.filter(d => isTodayUAE(d.scheduledTime));
      if (todaysOnly.length > 0) filtered = todaysOnly;
    }

    if (statusTab === 'collection') {
      filtered = filtered.filter(d => isCollectionItem(d));
      filtered = filtered.filter(d => !completedDeliveries.includes(d._id));
    } else if (statusTab === 'pending') {
      filtered = filtered.filter(d => d.displayStatus === 'pending' && !isCollectionItem(d));
      filtered = filtered.filter(d => !completedDeliveries.includes(d._id));
    } else if (statusTab === 'failed') {
      filtered = filtered.filter(d => d.displayStatus === 'cancelled' && !isCollectionItem(d));
    } else {
      filtered = filtered.filter(d => d.displayStatus === statusTab && !isCollectionItem(d));
    }

    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(d => {
        const customerName = (d.customerName || '').toLowerCase();
        const address = (d.address || '').toLowerCase();
        const customerId = (d.customerId || '').toLowerCase();
        const phone = (d.phone || '').toLowerCase();
        return customerName.includes(searchLower) || address.includes(searchLower) ||
               customerId.includes(searchLower) || phone.includes(searchLower);
      });
    }

    return filtered;
  }, [deliveries, statusTab, completedDeliveries, searchTerm, showTodayOnly]);

  const stats = useMemo(() => {
    const statsDeliveries = showTodayOnly
      ? deliveries.filter(d => isTodayUAE(d.scheduledTime))
      : deliveries;
    const collections = statsDeliveries.filter(d => isCollectionItem(d) && !completedDeliveries.includes(d._id));
    const normalDeliveries = statsDeliveries.filter(d => !isCollectionItem(d));
    return {
      pending: normalDeliveries.filter(d => d.displayStatus === 'pending' && !completedDeliveries.includes(d._id)).length,
      delivered: normalDeliveries.filter(d => d.displayStatus === 'delivered').length,
      failed: normalDeliveries.filter(d => d.displayStatus === 'cancelled').length,
      collection: collections.length,
    };
  }, [deliveries, showTodayOnly, completedDeliveries]);

  const handleOpenDelivery = useCallback((delivery) => {
    if (!delivery?._id) return;
    navigation.navigate('DeliveryDetails', { deliveryId: delivery._id, delivery });
  }, [navigation]);

  const renderDeliveryItem = useCallback(({ item, index }) => (
    <DeliveryItem item={item} index={index} onPress={handleOpenDelivery} />
  ), [handleOpenDelivery]);

  const emptyStateLabel = STATUS_TABS.find((tab) => tab.key === statusTab)?.label.toLowerCase() ?? 'current';

  const statusCountMap = { pending: stats.pending, delivered: stats.delivered, collection: stats.collection, failed: stats.failed };

  const renderEmptyState = useMemo(() => {
    if (loading) {
      return (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={colors.lime} />
          <Text style={styles.emptySubtitle}>Loading deliveries...</Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{`No ${emptyStateLabel} deliveries`}</Text>
        <Text style={styles.emptySubtitle}>Pull to refresh to check for new assignments</Text>
      </View>
    );
  }, [loading, emptyStateLabel]);

  return (
    <View style={styles.screen}>
      {/* ── Fixed header ── */}
      <View style={[styles.fixedHeader, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.screenTitle}>Deliveries</Text>

        {/* Search bar */}
        <View style={styles.searchWrapper}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, address or phone…"
            placeholderTextColor={colors.muted}
            value={searchTerm}
            onChangeText={setSearchTerm}
            clearButtonMode="while-editing"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>

        {/* Filter pills */}
        <View style={styles.tabBar}>
          {STATUS_TABS.map((tab) => {
            const isActive = statusTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.tabPill,
                  {
                    backgroundColor: isActive ? tab.color : 'transparent',
                    borderColor: isActive ? tab.color : colors.border,
                  },
                ]}
                onPress={() => setStatusTab(tab.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.tabPillText, { color: isActive ? colors.bgAlt : colors.muted }]}>
                  {tab.label} · {statusCountMap[tab.key] ?? 0}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <FlatList
        data={filteredDeliveries}
        renderItem={renderDeliveryItem}
        keyExtractor={(item) => item._id || item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={loadDeliveries} tintColor={colors.lime} />}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        initialNumToRender={8}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  fixedHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
    backgroundColor: colors.bg,
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.text,
    marginBottom: 16,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  searchWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  tabBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  tabPill: {
    borderRadius: 999,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderWidth: 1.5,
  },
  tabPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyTitle: {
    fontSize: 18,
    color: colors.muted,
    fontWeight: '600',
  },
  emptySubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  loadingState: {
    alignItems: 'center',
    paddingVertical: 60,
  },
});

export default DeliveriesScreen;
