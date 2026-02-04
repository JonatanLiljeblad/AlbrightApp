import { StyleSheet } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { auth } from '@/src/firebase';
import { signOutUser } from '@/src/auth';

export default function Settings() {
  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title title="Settings" />
      <Card.Content>
        <Text style={styles.muted}>Signed in as {auth.currentUser?.email}</Text>
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
