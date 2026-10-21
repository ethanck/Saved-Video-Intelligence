import { Stack } from "expo-router";
import { AuthGate, AuthProvider } from "../src/auth";

/** Root navigation stays deliberately small until detail, recipe, and review routes land. */
export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGate>
    </AuthProvider>
  );
}

