import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as NavigationBar from "expo-navigation-bar";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import React from "react";
import { AppState, Platform, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useBrand } from "./src/brand";
import { CrashReport } from "./src/components/CrashReport";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { registerFonts } from "./src/ffmpeg/engine";
import type { RootStackParamList } from "./src/navigation";
import { EditorScreen } from "./src/screens/EditorScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { useProjects } from "./src/store/projects";
import { useSettings } from "./src/store/settings";
import {
  describe,
  markClean,
  previousSessionCrashed,
  previousTrace,
  trace,
} from "./src/services/diagnostics";
import { colors } from "./src/theme";

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
  // Breadcrumbs from the session before this one, shown only if it ended badly.
  const [crashReport, setCrashReport] = React.useState<string | null>(null);
  const hydrateProjects = useProjects((state) => state.hydrate);
  const hydrateSettings = useSettings((state) => state.hydrate);
  const hydrateBrand = useBrand((state) => state.hydrate);

  // A JS error thrown outside a render — inside a promise, an event handler, a
  // native callback — otherwise takes the whole app down in a release build
  // with nothing written anywhere. Record it before the default handler runs.
  React.useEffect(() => {
    const globals = global as unknown as {
      ErrorUtils?: {
        getGlobalHandler(): (error: unknown, isFatal?: boolean) => void;
        setGlobalHandler(
          handler: (error: unknown, isFatal?: boolean) => void,
        ): void;
      };
    };
    const errorUtils = globals.ErrorUtils;
    if (!errorUtils) return undefined;

    const chain = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error, isFatal) => {
      trace(`FATAL js${isFatal ? "" : " (non-fatal)"}: ${describe(error)}`);
      chain(error, isFatal);
    });
    return () => errorUtils.setGlobalHandler(chain);
  }, []);

  // "The app was closed on purpose" vs "the app disappeared" is the difference
  // between a quiet next launch and a crash report, and backgrounding is the
  // last moment we are reliably alive.
  React.useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") markClean();
    });
    return () => subscription.remove();
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      const previous = previousTrace();
      if (previousSessionCrashed(previous)) setCrashReport(previous);

      await SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);
      if (Platform.OS === "android") {
        try {
          NavigationBar.setStyle("dark");
        } catch {
          // Edge-to-edge devices manage the bar themselves.
        }
      }

      await Promise.all([hydrateProjects(), hydrateSettings(), hydrateBrand()]);

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
  }, [hydrateProjects, hydrateSettings, hydrateBrand]);

  if (!ready) return <View style={styles.boot} />;

  if (crashReport) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <CrashReport
          report={crashReport}
          onDismiss={() => setCrashReport(null)}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <ErrorBoundary>
          <NavigationContainer theme={navigationTheme}>
            <Stack.Navigator
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: "slide_from_right",
              }}
            >
              <Stack.Screen name="Home" component={HomeScreen} />
              <Stack.Screen name="Editor" component={EditorScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  boot: { flex: 1, backgroundColor: colors.bg },
});
