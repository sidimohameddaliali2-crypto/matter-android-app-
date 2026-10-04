import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';
import MatterLogo from '../components/MatterLogo';

// Mirrors the mockup's `@keyframes pulse` (opacity 1 -> .35 -> 1, 1.4s loop),
// used there for the offline/waiting indicator — the closest analog to a
// splash/boot screen's "working" state.
const LoadingScreen = () => {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <View className="flex-1 justify-center items-center bg-matterBg">
      <Animated.View style={{ opacity }}>
        <MatterLogo size={40} />
      </Animated.View>
    </View>
  );
};

export default LoadingScreen;
