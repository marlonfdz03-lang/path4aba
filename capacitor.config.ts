import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.marlonfmservices.path4abamobile',
  appName: 'Path4ABA',
  webDir: 'public', // placeholder — we load the remote URL, not a static export
  server: {
    url: 'https://path4aba.app/app',
    cleartext: false,
  },
};

export default config;
