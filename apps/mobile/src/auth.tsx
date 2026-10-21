import { getApp, getApps, initializeApp } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type Auth,
  type User,
} from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { ActivityIndicator, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiBaseUrl, firebaseAuthConfigured, firebaseClientConfig, localDevelopmentApi } from "./config";

function createFirebaseAuth(): Auth | undefined {
  if (!firebaseAuthConfigured) return undefined;

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseClientConfig);
  if (Platform.OS === "web") return getAuth(app);

  try {
    // Firebase's React Native conditional entry is selected by Metro. Keep
    // this require behind the native branch so Expo web uses browser Auth.
    const { getReactNativePersistence } = require("@firebase/auth") as {
      getReactNativePersistence: (storage: typeof AsyncStorage) => Parameters<typeof initializeAuth>[1] extends { persistence?: infer Persistence } ? Persistence : never;
    };
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    // Fast refresh can initialize Auth more than once; reuse the existing instance.
    return getAuth(app);
  }
}

const firebaseAuth = createFirebaseAuth();

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(firebaseAuth?.currentUser ?? null);
  const [loading, setLoading] = useState(Boolean(firebaseAuth));

  useEffect(() => {
    if (!firebaseAuth) {
      setLoading(false);
      return;
    }

    return onAuthStateChanged(firebaseAuth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    configured: firebaseAuthConfigured,
    loading,
    user,
    signIn: async (email, password) => {
      if (!firebaseAuth) throw new Error("Firebase Auth is not configured for this build.");
      await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
    },
    signUp: async (email, password) => {
      if (!firebaseAuth) throw new Error("Firebase Auth is not configured for this build.");
      await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password);
    },
    signOut: async () => {
      if (firebaseAuth) await firebaseSignOut(firebaseAuth);
    },
  }), [loading, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

export function AuthGate({ children }: PropsWithChildren) {
  const { configured, loading, user } = useAuth();

  if (loading) return <CenteredState message="Restoring your session…" />;
  if (configured && !user) return <AuthScreen />;
  if (!configured && !localDevelopmentApi) return <AuthConfigurationState />;
  return <>{children}</>;
}

function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    try {
      setSubmitting(true);
      setMessage(undefined);
      if (mode === "signIn") await signIn(email, password);
      else await signUp(email, password);
    } catch (error) {
      setMessage(formatAuthError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.authCard}>
        <Text style={styles.eyebrow}>KNOWLEDGE LIBRARY</Text>
        <Text style={styles.title}>Sign in to Saved Video Intelligence</Text>
        <Text style={styles.subtitle}>Your captures and processing history are private to your account.</Text>
        <TextInput accessibilityLabel="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" onChangeText={setEmail} placeholder="Email" placeholderTextColor="#7d8494" style={styles.input} value={email} />
        <TextInput accessibilityLabel="Password" onChangeText={setPassword} placeholder="Password" placeholderTextColor="#7d8494" secureTextEntry style={styles.input} value={password} />
        {message ? <Text style={styles.error}>{message}</Text> : null}
        <Pressable accessibilityRole="button" disabled={submitting || !email.trim() || !password} onPress={() => void submit()} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (submitting || !email.trim() || !password) && styles.disabled]}>
          {submitting ? <ActivityIndicator color="#081018" /> : <Text style={styles.primaryButtonText}>{mode === "signIn" ? "Sign in" : "Create account"}</Text>}
        </Pressable>
        <Pressable onPress={() => { setMode(mode === "signIn" ? "signUp" : "signIn"); setMessage(undefined); }} style={styles.linkButton}>
          <Text style={styles.linkText}>{mode === "signIn" ? "Create a new account" : "I already have an account"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function AuthConfigurationState() {
  return <CenteredState message={`Add the Firebase client configuration before using this API: ${apiBaseUrl}`} />;
}

function CenteredState({ message }: { message: string }) {
  return <SafeAreaView style={styles.safeArea}><View style={styles.centered}><ActivityIndicator color="#8ee5c1" /><Text style={styles.subtitle}>{message}</Text></View></SafeAreaView>;
}

function formatAuthError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password": return "The email or password is incorrect.";
    case "auth/email-already-in-use": return "That email already has an account. Try signing in.";
    case "auth/invalid-email": return "Enter a valid email address.";
    case "auth/weak-password": return "Use a stronger password.";
    case "auth/too-many-requests": return "Too many attempts. Try again later.";
    default: return error instanceof Error ? error.message : "Authentication failed.";
  }
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#081018", flex: 1 },
  authCard: { alignSelf: "center", justifyContent: "center", maxWidth: 520, padding: 24, width: "100%" },
  centered: { alignItems: "center", flex: 1, gap: 16, justifyContent: "center", padding: 24 },
  eyebrow: { color: "#8ee5c1", fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  title: { color: "#f4f7fb", fontSize: 28, fontWeight: "700", lineHeight: 36, marginTop: 8 },
  subtitle: { color: "#aab2c1", fontSize: 15, lineHeight: 22, marginTop: 8 },
  input: { backgroundColor: "#111c27", borderColor: "#243447", borderRadius: 12, borderWidth: 1, color: "#f4f7fb", fontSize: 15, marginTop: 14, minHeight: 48, paddingHorizontal: 14 },
  error: { color: "#f2a7a7", fontSize: 13, lineHeight: 19, marginTop: 12 },
  primaryButton: { alignItems: "center", backgroundColor: "#8ee5c1", borderRadius: 11, justifyContent: "center", marginTop: 16, minHeight: 48, paddingHorizontal: 18 },
  primaryButtonText: { color: "#081018", fontSize: 15, fontWeight: "700" },
  linkButton: { alignSelf: "flex-start", marginTop: 16 },
  linkText: { color: "#8ee5c1", fontSize: 14, fontWeight: "600" },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.42 },
});
