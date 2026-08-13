self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'Productivity Reminder', body: event.data ? event.data.text() : 'Scheduled activity reminder.' };
    }

    event.waitUntil(
        self.registration.showNotification(data.title || 'Productivity Reminder', {
            body: data.body || 'You have a scheduled activity.',
            tag: data.tag || 'productivity-reminder',
            requireInteraction: true,
            data: { url: data.url || '/index.html' }
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = new URL(event.notification.data?.url || '/index.html', self.location.origin).href;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
