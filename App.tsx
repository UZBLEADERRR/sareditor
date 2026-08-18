import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as NavigationBar from 'expo-navigation-bar';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { registerFonts } from './src/ffmpeg/engine';
import type { RootStackParamList } from './src/navigation';
import { EditorScreen } from './src/screens/EditorScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useProjects } from './src/store/projects';
import { useSettings } from './src/store/settings';
import { colors } from './src/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    text: colors.text,
    primary: colors.accent,
    border: colors.borderSoft,
  },
};

export default function App() {
  const [ready, setReady] = React.useState(false);
  const hydrateProjects = useProjects((state) => state.hydrate);
  const hydrateSettings = useSettings((state) => state.hydrate);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      await SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);
      if (Platform.OS === 'android') {
        try {
          NavigationBar.setStyle('dark');
        } catch {
          // Edge-to-edge devices manage the bar themselves.
        }
      }

      await Promise.all([hydrateProjects(), hydrateSettings()]);

      // libass needs its font directories before the first caption render; doing
      // it at boot means the first export is not the one that pays for it.
      await registerFonts().catch(() => undefined);

      if (!cancelled) {
        setReady(true);
        await SplashScreen.hideAsync().catch(() => undefined);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrateProjects, hydrateSettings]);

  if (!ready) return <View style={styles.boot} />;

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer theme={navigationTheme}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Editor" component={EditorScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, backgroundColor: colors.bg },
});
