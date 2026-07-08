"use client";

import { useEffect } from "react";
import { initPushNotifications } from "@/lib/push/registerPush";

/**
 * Kicks off native push registration on app start.
 *
 * initPushNotifications() already guards on Capacitor.isNativePlatform(), so
 * mounting this in a normal browser (including path4aba.app) is a harmless
 * no-op. Renders nothing.
 */
export function PushInit() {
  useEffect(() => {
    initPushNotifications().catch((error) => {
      console.error("[push] init failed:", error);
    });
  }, []);

  return null;
}
