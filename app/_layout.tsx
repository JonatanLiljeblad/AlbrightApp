import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useState } from 'react';
import 'react-native-reanimated';
import { MD3DarkTheme, PaperProvider } from 'react-native-paper';

import { watchAuth } from '@/src/auth';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Start in auth to avoid mounting Firestore listeners before auth state is ready.
  initialRouteName: '(auth)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const [user, setUser] = useState<import('firebase/auth').User | null>(null);
  const [ready, setReady] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const unsub = watchAuth((u) => {
      setUser(u);
      setReady(true);
    });
    return unsub;
  }, []);

  const paperTheme = useMemo(() => {
    const base = MD3DarkTheme;
    return {
      ...base,
      roundness: 16,
      colors: {
        ...base.colors,
        // Brand
        primary: '#D7263D',
        onPrimary: '#FFFFFF',
        primaryContainer: '#3A0B12',
        onPrimaryContainer: '#FFFFFF',

        secondary: '#111111',
        onSecondary: '#FFFFFF',
        secondaryContainer: '#141414',
        onSecondaryContainer: '#FFFFFF',

        // App surfaces
        background: '#000000',
        surface: '#0B0B0B',
        surfaceVariant: '#141414',
        onSurface: '#FFFFFF',
        onSurfaceVariant: '#E6E6E6',
        outline: '#2A2A2A',
      },
    };
  }, []);

  const navTheme = useMemo(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        primary: '#D7263D',
        background: '#000000',
        card: '#0B0B0B',
        text: '#FFFFFF',
        border: '#141414',
        notification: '#D7263D',
      },
    }),
    []
  );

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === '(auth)';
    if (!user && !inAuth) router.replace('/(auth)');
    if (user && inAuth) router.replace('/(tabs)');
  }, [ready, user, segments, router]);

  return (
    <PaperProvider theme={paperTheme}>
      <ThemeProvider value={navTheme}>
        <Stack>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </PaperProvider>
  );
}
