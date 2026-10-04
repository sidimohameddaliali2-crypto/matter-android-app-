import React from 'react';
import { Image } from 'react-native';

// Cropped from the MATTER Driver App design's matter-logo.png (which ships
// on a mostly-transparent 640x640 canvas) down to its opaque bounds —
// otherwise the wordmark renders as a sliver surrounded by empty space.
const ASPECT_RATIO = 483 / 92;

const MatterLogo = ({ size = 28, style }) => (
  <Image
    source={require('../../assets/matter-logo-cropped.png')}
    resizeMode="contain"
    style={[{ height: size, width: size * ASPECT_RATIO }, style]}
  />
);

export default MatterLogo;
