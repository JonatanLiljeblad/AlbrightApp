import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { Button, Card, HelperText, Switch, Text, TextInput } from 'react-native-paper';
import { isAllowedEmail, requestAccess, signIn, signUpAllowed } from '@/src/auth';

export default function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [rememberMe, setRememberMe] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const emailOk = useMemo(() => /.+@.+\..+/.test(email.trim()), [email]);

  async function onSubmit() {
    setError(null);
    setInfo(null);
    try {
      setBusy(true);
      if (mode === 'signin') {
        await signIn(email, password, rememberMe);
        return;
      }

      const allowed = await isAllowedEmail(email);
      if (!allowed) {
        await requestAccess(name, email);
        setInfo('Access requested. An admin will review it.');
        return;
      }

      await signUpAllowed(name, email, password);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}>
      <Card style={styles.card} mode="elevated">
        <Card.Title title={mode === 'signin' ? 'Welcome back' : 'Create account'} />
        <Card.Content>
          {mode === 'signup' && (
            <TextInput
              label="Name"
              mode="outlined"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              style={styles.input}
            />
          )}

          <TextInput
            label="Email"
            mode="outlined"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            style={styles.input}
          />

          <TextInput
            label="Password"
            mode="outlined"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={styles.input}
          />

          {mode === 'signin' && (
            <View style={styles.rememberRow}>
              <Text>Remember me</Text>
              <Switch value={rememberMe} onValueChange={setRememberMe} disabled={busy} />
            </View>
          )}

          {!!error && <HelperText type="error">{error}</HelperText>}
          {!!info && <HelperText type="info">{info}</HelperText>}
          {!emailOk && email.length > 0 && <HelperText type="error">Enter a valid email.</HelperText>}

          <Button
            mode="contained"
            onPress={onSubmit}
            disabled={
              busy ||
              !emailOk ||
              password.length < 6 ||
              (mode === 'signup' && name.trim().length < 2)
            }
            loading={busy}
            style={styles.primary}
            contentStyle={{ paddingVertical: 6 }}>
            {mode === 'signin' ? 'Sign in' : 'Sign up'}
          </Button>

          <Text style={styles.switchText}>
            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}
          </Text>
          <Button
            mode="text"
            onPress={() => {
              setError(null);
              setInfo(null);
              setMode(mode === 'signin' ? 'signup' : 'signin');
            }}>
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </Button>

          {mode === 'signup' && (
            <Text style={styles.small}>
              If your email isn’t allowed yet, we’ll send an access request to the admin.
            </Text>
          )}
        </Card.Content>
      </Card>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center' },
  card: { borderRadius: 16 },
  input: { marginBottom: 12 },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 2,
  },
  primary: { marginTop: 6 },
  switchText: { marginTop: 14, textAlign: 'center' },
  small: { marginTop: 10, opacity: 0.8 },
});
