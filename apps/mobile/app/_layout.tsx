import { Stack } from "expo-router";

/** Root navigation stays deliberately small until detail, recipe, and review routes land. */
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

