import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { auth } from '@/src/firebase';
import { signOutUser, watchAuth } from '@/src/auth';

export default function Settings() {
  const [email, setEmail] = useState<string | null>(auth.currentUser?.email ?? null);

  useEffect(() => watchAuth((u) => setEmail(u?.email ?? null)), []);

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title title="Settings" />
      <Card.Content>
        <Text style={styles.muted}>Signed in as {email}</Text>
        <Button mode="contained" onPress={signOutUser} style={styles.btn}>
          Sign out
        </Button>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { margin: 16, borderRadius: 16 },
  muted: { opacity: 0.7 },
  btn: { marginTop: 14 },
});
