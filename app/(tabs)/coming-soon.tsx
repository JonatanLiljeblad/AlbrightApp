import { StyleSheet } from 'react-native';
import { Card, Text } from 'react-native-paper';

export default function ComingSoon() {
  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title title="Coming soon" />
      <Card.Content>
        <Text>More features are on the way.</Text>
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { margin: 16, borderRadius: 16 },
});
