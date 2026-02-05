import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { auth, db } from '@/src/firebase';
import { isAdmin as isAdminEnv, isOwner as isOwnerEnv } from '@/src/auth';
import type { AccessRequest } from '@/src/types';
import { collection, doc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { useRouter } from 'expo-router';

export default function AdminScreen() {
  const router = useRouter();
  const me = (auth.currentUser?.email ?? '').trim().toLowerCase();

  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [ownerDoc, setOwnerDoc] = useState(false);
  const [adminDoc, setAdminDoc] = useState(false);

  async function load() {
    const q = query(collection(db, 'accessRequests'), where('status', '==', 'pending'));
    const snap = await getDocs(q);
    setRequests(snap.docs.map((d) => d.data() as AccessRequest));
  }

  useEffect(() => {
    load();
    const q = query(collection(db, 'accessRequests'), where('status', '==', 'pending'));
    const unsub = onSnapshot(q, () => load());
    return unsub;
  }, []);

  useEffect(() => {
    if (!me) return;
    const unsubOwner = onSnapshot(doc(db, 'owners', me), (s) => setOwnerDoc(s.exists()));
    const unsubAdmin = onSnapshot(doc(db, 'admins', me), (s) => setAdminDoc(s.exists()));
    return () => {
      unsubOwner();
      unsubAdmin();
    };
  }, [me]);

  const owner = useMemo(() => ownerDoc || isOwnerEnv(me), [ownerDoc, me]);
  const canAdmin = useMemo(() => owner || adminDoc || isAdminEnv(me), [owner, adminDoc, me]);

  async function decide(email: string, allowed: boolean) {
    try {
      setBusy(true);
      const adminEmail = auth.currentUser?.email ?? '';
      if (!canAdmin) throw new Error('Not an admin');

      const key = email.trim().toLowerCase();
      await setDoc(
        doc(db, 'accessRequests', key),
        {
          status: allowed ? 'approved' : 'denied',
          decidedAt: Date.now(),
          decidedBy: adminEmail,
        },
        { merge: true }
      );

      if (allowed) {
        await setDoc(
          doc(db, 'allowedEmails', key),
          {
            email: key,
            createdAt: Date.now(),
            createdBy: adminEmail,
          },
          { merge: true }
        );
      }

      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }


  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title title="Admin" />
      <Card.Content>
        {owner && (
          <Button mode="outlined" disabled={busy} onPress={() => router.push('/permissions' as any)}>
            Edit permissions
          </Button>
        )}

        {requests.length === 0 ? (
          <Text>No pending requests.</Text>
        ) : (
          requests.map((r) => (
            <Card key={r.email} style={styles.req} mode="outlined">
              <Card.Title title={r.name || r.email} subtitle={r.email} />
              <Card.Actions>
                <Button disabled={busy} onPress={() => decide(r.email, false)}>
                  Deny
                </Button>
                <Button disabled={busy} mode="contained" onPress={() => decide(r.email, true)}>
                  Allow
                </Button>
              </Card.Actions>
            </Card>
          ))
        )}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { margin: 16, borderRadius: 16 },
  req: { marginTop: 12 },
});
