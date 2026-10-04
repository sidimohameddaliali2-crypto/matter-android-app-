import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDispatch, useSelector } from 'react-redux';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { fetchDriverDeliveries } from '../store/deliveriesSlice';
import { isTodayUAE } from '../utils/uaeTime';
import logger from '../utils/logger';
import MatterLogo from '../components/MatterLogo';
import NotificationsModal from '../components/NotificationsModal';
import { colors } from '../theme/matterTheme';

const DashboardScreen = ({ navigation }) => {
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const { user, driverProfile } = useAuth();
  const { deliveries } = useSelector((state) => state.deliveries);
  const unreadCount = useSelector((state) => state.notifications.items.filter((i) => !i.read).length);
  const [refreshing, setRefreshing] = useState(false);
  const [notificationsVisible, setNotificationsVisible] = useState(false);

  const displayName = (() => {
    const candidates = [
      user?.name,
      user?.profile?.name,
      user?.profile?.fullName,
      driverProfile?.name,
      driverProfile?.fullName,
      driverProfile?.profile?.name,
      user?.email ? user.email.split('@')[0] : null,
    ].filter(Boolean);
    const name = candidates[0];
    if (!name) return 'Driver';
    return String(name)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  })();

  const firstName = displayName.split(' ')[0] || displayName;

  // Was hardcoded to "Morning" regardless of actual time of day — every
  // driver opening the app in the afternoon or evening saw a wrong greeting.
  const greetingWord = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Morning';
    if (hour < 18) return 'Afternoon';
    return 'Evening';
  })();

  const loadData = async () => {
    try {
      const driverId = driverProfile?.id || user?.id || user?._id;
      logger.log('📊 Redux DashboardScreen: Dispatching fetchDriverDeliveries for:', driverId);
      
      if (driverId) {
        await dispatch(fetchDriverDeliveries(driverId)).unwrap();
      }
    } catch (error) {
      logger.error('Error loading dashboard data:', error);
    }
  };

  const isCollectionItem = (d) =>
    d.type === 'Collection' || (d.type === 'Task' && d.taskType === 'Bag Collection');

  // Calculate stats from Redux deliveries
  const stats = React.useMemo(() => {
    const todaysDeliveries = deliveries.filter(
      (d) => d && d.scheduledTime && isTodayUAE(d.scheduledTime)
    );

    const collectionItems = todaysDeliveries.filter(isCollectionItem);
    const normalDeliveries = todaysDeliveries.filter((d) => !isCollectionItem(d));
    const deliveredCount = normalDeliveries.filter((d) => d.displayStatus === 'delivered').length;
    const pendingCount = normalDeliveries.filter((d) => d.displayStatus === 'pending').length;

    return {
      today: todaysDeliveries.length,
      delivered: deliveredCount,
      pending: pendingCount,
      collection: collectionItems.length,
    };
  }, [deliveries]);

  const nextStop = React.useMemo(() => {
    return deliveries
      .filter((d) => d && d.displayStatus === 'pending' && !isCollectionItem(d))
      .find(Boolean) || null;
  }, [deliveries]);

  const nextStopName = nextStop?.customer?.name || nextStop?.customerName || 'Customer';
  const nextStopAddress = nextStop?.customer?.address || nextStop?.address || 'Address not available';
  const nextStopZone =
    nextStop?.customer?.zone || nextStop?.customer?.area || nextStop?.customer?.district || nextStop?.customer?.sector ||
    nextStop?.zone || nextStop?.area || nextStop?.district || nextStop?.sector || null;
  const nextStopNumber = nextStop?.stop ?? nextStop?.sequence ?? nextStop?.order ?? null;
  const nextStopTiming = (() => {
    if (!nextStop?.scheduledTime) return 'Time pending';
    const date = new Date(nextStop.scheduledTime);
    if (Number.isNaN(date.getTime())) return 'Time pending';
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  })();

  useEffect(() => {
    loadData();
  }, [driverProfile, user]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const shiftPercent = stats.today > 0 ? Math.round((stats.delivered / stats.today) * 100) : 0;

  const StatCard = ({ title, value, color }) => (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );

  return (
    <>
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, { paddingTop: insets.top + 16 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.lime} />}
    >
      <View style={styles.header}>
        <MatterLogo size={20} />
        <TouchableOpacity
          style={styles.bellButton}
          activeOpacity={0.8}
          onPress={() => setNotificationsVisible(true)}
        >
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
          {unreadCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      <Text style={styles.greeting}>{greetingWord},{'\n'}{firstName}</Text>

      <View style={styles.heroCard}>
        <View style={styles.heroHeadingRow}>
          <Text style={styles.heroLabel}>Shift progress</Text>
          <Text style={styles.heroPercent}>{shiftPercent}%</Text>
        </View>
        <Text style={styles.heroBig}>{stats.delivered || 0} of {stats.today || 0} delivery done</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${shiftPercent}%` }]} />
        </View>
      </View>

      <View style={styles.statsContainer}>
        <StatCard title="Pending" value={stats.pending || 0} color={colors.blue} />
        <StatCard title="Delivered" value={stats.delivered || 0} color={colors.lime} />
        <StatCard title="Collection" value={stats.collection || 0} color={colors.purple} />
      </View>

      <Text style={styles.sectionLabel}>Next up</Text>
      {nextStop ? (
        <TouchableOpacity
          style={styles.nextCard}
          activeOpacity={0.85}
          onPress={() => navigation?.navigate('Deliveries', {
            screen: 'DeliveryDetails',
            params: { deliveryId: nextStop._id, delivery: nextStop },
          })}
        >
          <View style={styles.nextCardRow}>
            <Text style={styles.nextCardTitle} numberOfLines={1}>
              {nextStopNumber ? `Stop ${nextStopNumber} · ` : ''}{nextStopName}
            </Text>
            {!!nextStopZone && (
              <View style={styles.nextCardZoneTag}>
                <Text style={styles.nextCardZoneText}>{nextStopZone}</Text>
              </View>
            )}
          </View>
          <Text style={styles.nextCardAddress} numberOfLines={1}>{nextStopAddress}</Text>
          <Text style={styles.nextCardTiming}>⏱ {nextStopTiming}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[styles.nextCard, styles.nextCardEmpty]}>
          <Text style={styles.nextCardEmptyText}>No pending stops right now</Text>
        </View>
      )}

      <Text style={styles.sectionLabel}>Bags to return</Text>
      <TouchableOpacity
        style={styles.returnsCard}
        activeOpacity={0.85}
        onPress={() => navigation?.navigate('BagReturn')}
      >
        <Text style={styles.returnsCardText}>Return empty bags at the depot</Text>
        <Text style={styles.returnsCardLink}>Scan returns →</Text>
      </TouchableOpacity>
    </ScrollView>

    <NotificationsModal
      visible={notificationsVisible}
      onClose={() => setNotificationsVisible(false)}
    />
    </>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  screenContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  bellButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  bellBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.text,
  },
  greeting: {
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 34,
    color: colors.text,
    marginBottom: 22,
  },
  heroCard: {
    backgroundColor: colors.card,
    borderRadius: 26,
    padding: 20,
  },
  heroHeadingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  heroLabel: {
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  heroPercent: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.lime,
  },
  heroBig: {
    fontSize: 24,
    fontWeight: '900',
    color: colors.text,
    marginTop: 8,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.bg,
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: colors.lime,
  },
  statsContainer: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    width: '48%',
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 14,
  },
  statValue: {
    marginTop: 8,
    fontSize: 26,
    fontWeight: '900',
    color: colors.text,
  },
  statTitle: {
    marginTop: 4,
    fontSize: 12,
    color: colors.muted,
  },
  sectionLabel: {
    fontSize: 13,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: 26,
    marginBottom: 10,
  },
  nextCard: {
    backgroundColor: colors.blue,
    borderRadius: 22,
    padding: 18,
  },
  nextCardEmpty: {
    backgroundColor: colors.card,
  },
  nextCardEmptyText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.muted,
  },
  nextCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  nextCardTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: colors.bgAlt,
    flex: 1,
  },
  nextCardZoneTag: {
    backgroundColor: colors.bgAlt,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginLeft: 8,
  },
  nextCardZoneText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  nextCardAddress: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.bgAlt,
    marginTop: 8,
  },
  nextCardTiming: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.bgAlt,
    marginTop: 10,
  },
  returnsCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  returnsCardText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  returnsCardLink: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.lime,
    marginLeft: 8,
  },
});

export default DashboardScreen;
