import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Button, Card, Text, TextInput } from 'react-native-paper';
import { auth, db } from '@/src/firebase';
import { isOwner } from '@/src/auth';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';

type RoleDoc = { email: string; createdAt: number; createdBy: string };

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export default function PermissionsScreen() {
  const me = auth.currentUser?.email ?? '';
  const canEdit = useMemo(() => isOwner(me), [me]);

  const [busy, setBusy] = useState(false);
  const [owners, setOwners] = useState<RoleDoc[]>([]);
  const [admins, setAdmins] = useState<RoleDoc[]>([]);
  const [newOwner, setNewOwner] = useState('');
  const [newAdmin, setNewAdmin] = useState('');

  async function load() {
    const [o, a] = await Promise.all([getDocs(collection(db, 'owners')), getDocs(collection(db, 'admins'))]);
    setOwners(o.docs.map((d) => d.data() as RoleDoc).sort((x, y) => x.email.localeCompare(y.email)));
    setAdmins(a.docs.map((d) => d.data() as RoleDoc).sort((x, y) => x.email.localeCompare(y.email)));
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function add(role: 'owners' | 'admins', email: string) {
    const by = auth.currentUser?.email ?? '';
    if (!canEdit) return;

    const key = normalizeEmail(email);
    if (!/.+@.+\..+/.test(key)) {
      Alert.alert('Invalid email', 'Please enter a valid email.');
      return;
    }

    try {
      setBusy(true);
      await setDoc(
        doc(db, role, key),
        { email: key, createdAt: Date.now(), createdBy: by } satisfies RoleDoc,
        { merge: true }
      );
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(role: 'owners' | 'admins', email: string) {
    if (!canEdit) return;
    try {
      setBusy(true);
      await deleteDoc(doc(db, role, normalizeEmail(email)));
      await load();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title title="Permissions" />
      <Card.Content>
        {!canEdit && (
          <Text style={styles.muted}>
            Only the owner can edit permissions.
          </Text>
        )}

        <Text style={styles.section}>Owners</Text>
        {owners.length === 0 ? (
          <Text style={styles.muted}>No owners found.</Text>
        ) : (
          owners.map((o) => (
            <View key={o.email} style={styles.row}>
              <Text>{o.email}</Text>
              <Button disabled={!canEdit || busy} onPress={() => remove('owners', o.email)}>
                Remove
              </Button>
            </View>
          ))
        )}

        {canEdit && (
          <View style={styles.addRow}>
            <TextInput
              label="Add owner email"
              mode="outlined"
              value={newOwner}
              onChangeText={setNewOwner}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <Button
              mode="contained"
              disabled={busy || newOwner.trim().length === 0}
              onPress={async () => {
                await add('owners', newOwner);
                setNewOwner('');
              }}>
              Add
            </Button>
          </View>
        )}

        <Text style={styles.section}>Admins</Text>
        {admins.length === 0 ? (
          <Text style={styles.muted}>No admins found.</Text>
        ) : (
          admins.map((a) => (
            <View key={a.email} style={styles.row}>
              <Text>{a.email}</Text>
              <Button disabled={!canEdit || busy} onPress={() => remove('admins', a.email)}>
                Remove
              </Button>
            </View>
          ))
        )}

        {canEdit && (
          <View style={styles.addRow}>
            <TextInput
              label="Add admin email"
              mode="outlined"
              value={newAdmin}
              onChangeText={setNewAdmin}
              autoCapitalize="none"
              keyboardType="email-address"
              style={styles.input}
            />
            <Button
              mode="contained"
              disabled={busy || newAdmin.trim().length === 0}
              onPress={async () => {
                await add('admins', newAdmin);
                setNewAdmin('');
              }}>
              Add
            </Button>
          </View>
        )}

        <Text style={styles.small}>Note: enforce this in Firestore Security Rules (UI gating only right now).</Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { margin: 16, borderRadius: 16 },
  muted: { opacity: 0.7, marginBottom: 10 },
  section: { marginTop: 14, marginBottom: 6, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  addRow: { marginTop: 8 },
  input: { marginBottom: 10 },
  small: { marginTop: 12, opacity: 0.7, fontSize: 12 },
});
