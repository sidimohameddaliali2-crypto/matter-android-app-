module.exports = {
  content: [
    './App.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        iosBlue: '#4fa1ff',
        iosGray: '#8E8E93',
        iosGrayLight: '#F2F2F7',
        iosBackground: '#F8F9FB',
        iosSeparator: '#C6C6C8',
        // MATTER Driver App palette
        matterBg: '#050f2b',
        matterBgAlt: '#051747',
        matterCard: '#051747',
        matterBorder: '#12275e',
        matterText: '#ede5de',
        matterMuted: '#a8ccf5',
        matterLime: '#bcf679',
        matterLimeHover: '#cdff8f',
        matterBlue: '#4d9eff',
        matterBlueHover: '#66acff',
        matterPurple: '#c994ff',
        matterDanger: '#ff3b00',
        matterPaper: '#e3d1c2',
      },
      fontSize: {
        'title-xl': '32px',
        'title-lg': '24px',
        'body': '16px',
        'caption': '12px',
      },
      borderRadius: {
        'xl': '20px',
      }
    }
  },
  plugins: []
};
