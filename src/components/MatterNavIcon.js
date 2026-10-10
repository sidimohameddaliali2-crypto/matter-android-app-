import React from 'react';
import Svg, { Path } from 'react-native-svg';

// Paths lifted directly from the MATTER Driver App mockup's bottom nav.
const PATHS = {
  dashboard: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  delivery: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 100-.1M18 19a2 2 0 100-.1',
  returns: 'M9 5L4 10l5 5M4 10h11a5 5 0 010 10h-4',
  profile: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.5-6 8-6s8 2 8 6',
  route: 'M12 21s-7-5.5-7-11a7 7 0 1114 0c0 5.5-7 11-7 11zM12 13a3 3 0 100-6 3 3 0 000 6z',
};

const MatterNavIcon = ({ name, size = 22, color = '#a8ccf5' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path
      d={PATHS[name]}
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

export default MatterNavIcon;
