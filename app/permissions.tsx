import { StyleSheet } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { useRouter } from 'expo-router';

export default function PermissionsScreen() {
  const router = useRouter();

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title title="Permissions" />
      <Card.Content>
        <Text>Permissions are now managed from the Admin tab.</Text>
        <Button style={styles.btn} mode="contained" onPress={() => router.replace('/admin' as any)}>
          Go to Admin
        </Button>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { margin: 16, borderRadius: 16 },
  btn: { marginTop: 12 },
});
