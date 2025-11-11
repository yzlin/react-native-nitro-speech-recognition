import "@/init";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native";

// biome-ignore lint/style/useNamingConvention: expo router specific const
export const unstable_settings = {
  anchor: "index",
};

export default function RootLayout() {
  return (
    <HeroUINativeProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style="auto" />
    </HeroUINativeProvider>
  );
}
