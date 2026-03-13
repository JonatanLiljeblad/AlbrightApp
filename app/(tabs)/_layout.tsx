import React, { useCallback, useEffect, useMemo, useState } from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';

import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { isAdmin, isOwner, watchAuth } from '@/src/auth';
import { AdminAccessProvider } from '@/src/adminAccessContext';
import { auth, db } from '@/src/firebase';
import type { AccessRequest } from '@/src/types';
import { collection, doc, getDocs, onSnapshot, query, where } from 'firebase/firestore';

// You can explore the built-in icon families and icons on the web at https://icons.expo.fyi/
function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={28} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const [email, setEmail] = useState<string | null>(auth.currentUser?.email ?? null);
  const headerShown = useClientOnlyValue(false, true);

  useEffect(() => {
    return watchAuth((u) => setEmail(u?.email ?? null));
  }, []);

  const envOwner = useMemo(() => isOwner(email), [email]);
  const envAdmin = useMemo(() => isAdmin(email), [email]);

  // Listen to Firestore for dynamically assigned admin/owner roles.
  const [isOwnerDoc, setIsOwnerDoc] = useState(false);
  const [isAdminDoc, setIsAdminDoc] = useState(false);

  useEffect(() => {
    if (!email) {
      setIsOwnerDoc(false);
      setIsAdminDoc(false);
      return;
    }
    const key = email.trim().toLowerCase();
    const unsubOwner = onSnapshot(doc(db, 'owners', key), (s) => setIsOwnerDoc(s.exists()), () => setIsOwnerDoc(false));
    const unsubAdmin = onSnapshot(doc(db, 'admins', key), (s) => setIsAdminDoc(s.exists()), () => setIsAdminDoc(false));
    return () => { unsubOwner(); unsubAdmin(); };
  }, [email]);

  const owner = envOwner || isOwnerDoc;
  const admin = envAdmin || owner || isAdminDoc;

  const [pendingRequests, setPendingRequests] = useState<AccessRequest[]>([]);

  const refreshPendingRequests = useCallback(async () => {
    if (!admin) {
      setPendingRequests([]);
      return;
    }

    try {
      const q = query(collection(db, 'accessRequests'), where('status', '==', 'pending'));
      const snap = await getDocs(q);
      setPendingRequests(snap.docs.map((d) => d.data() as AccessRequest));
    } catch (e) {
      console.warn('[TabLayout] Failed loading pending requests', e);
      setPendingRequests([]);
    }
  }, [admin]);

  useEffect(() => {
    void refreshPendingRequests();
  }, [refreshPendingRequests]);

  return (
    <AdminAccessProvider value={{ email, owner, canAdmin: admin, pendingRequests, refreshPendingRequests }}>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: '#D7263D',
          tabBarInactiveTintColor: '#7A7A7A',
          tabBarStyle: { backgroundColor: '#0B0B0B', borderTopColor: '#141414' },
          headerStyle: { backgroundColor: '#0B0B0B' },
          headerTintColor: '#FFFFFF',
          headerShown,
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Schedule',
            tabBarIcon: ({ color }) => <TabBarIcon name="calendar" color={color} />,
          }}
        />
        <Tabs.Screen
          name="bookings"
          options={{
            title: 'My bookings',
            tabBarIcon: ({ color }) => <TabBarIcon name="bookmark" color={color} />,
          }}
        />
        <Tabs.Screen
          name="coming-soon"
          options={{
            title: 'Coming soon',
            tabBarIcon: ({ color }) => <TabBarIcon name="rocket" color={color} />,
          }}
        />
        <Tabs.Screen
          name="admin"
          options={{
            href: admin ? undefined : null,
            title: 'Admin',
            tabBarIcon: ({ color }) => <TabBarIcon name="shield" color={color} />,
            tabBarBadge: pendingRequests.length > 0 ? pendingRequests.length : undefined,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color }) => <TabBarIcon name="cog" color={color} />,
          }}
        />
      </Tabs>
    </AdminAccessProvider>
  );
}
