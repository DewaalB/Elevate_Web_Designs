/* =========================================================
   Firebase Cloud Messaging — background handler
   =========================================================
   This runs even when every tab of the site is closed (as long as the
   browser itself is running), and is what lets a push notification show
   up on the admin's device for a new lead. It only ever displays a
   notification — it doesn't touch Firestore or anything else.
   ========================================================= */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyBCXFn13dHeCQ1-SO7-rAXQ2VKy75Vxqjg",
  authDomain:        "elevatewebdesigns-1fc3d.firebaseapp.com",
  projectId:         "elevatewebdesigns-1fc3d",
  storageBucket:     "elevatewebdesigns-1fc3d.firebasestorage.app",
  messagingSenderId: "778173951248",
  appId:             "1:778173951248:web:5922c9dcd1623b9e658995"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'New lead — Elevate Admin';
  const body  = payload.notification?.body  || '';
  self.registration.showNotification(title, {
    body,
    tag: 'elevate-lead',
    requireInteraction: false
  });
});

/* Clicking the notification focuses/opens the admin dashboard. */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('admin.html') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/admin.html');
    })
  );
});
