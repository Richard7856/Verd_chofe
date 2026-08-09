import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.verdfrut.choferes',
  appName: 'VerdFrut Choferes',
  webDir: 'dist',
  android: {
    // Los choferes están al sol: sin esto el WebView permite zoom accidental.
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#2f9e44',
      showSpinner: false,
    },
    Camera: {
      // Android 13+ usa permisos granulares de medios.
      androidxMaterialVersion: '1.11.0',
    },
  },
}

export default config
