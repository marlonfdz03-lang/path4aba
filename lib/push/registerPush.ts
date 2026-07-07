import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

/**
 * Registers the device for push notifications.
 *
 * Everything is guarded behind Capacitor.isNativePlatform() so this is a
 * no-op in a normal browser (including the production web app and the
 * remote-URL webview before native APIs are ready). Safe to call from a
 * client component's effect.
 *
 * For now the device token is only logged — sending it to the backend is a
 * later step.
 */
export async function initPushNotifications(): Promise<void> {
  // Never run outside the native Capacitor runtime (web/browser).
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  // Listeners must be registered before we call register().
  await PushNotifications.addListener('registration', (token) => {
    // TODO(next step): POST token.value to the backend to persist it.
    console.log('[push] registration token:', token.value);
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.error('[push] registration error:', error);
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.log('[push] notification received:', notification);
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    console.log('[push] notification action performed:', action);
  });

  // Ask the user for permission; only register with APNs if granted.
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') {
    console.warn('[push] permission not granted:', permission.receive);
    return;
  }

  await PushNotifications.register();
}
