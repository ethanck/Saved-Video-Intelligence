import { useCallback, useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CaptureRecord } from "@svi/shared-types";
import { ApiClientError } from "@svi/api-client";
import { useMobileApiClient } from "./api";
import { useAuth } from "./auth";
import { saveSource } from "./libraryActions";

/**
 * The first universal screen intentionally focuses on capture and Inbox review.
 * It contains no Note Chat or "Discuss" action; that belongs to the separate app.
 */
export function LibraryScreen() {
  const api = useMobileApiClient();
  const { user, signOut } = useAuth();
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [query, setQuery] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [message, setMessage] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retryingId, setRetryingId] = useState<string | undefined>();

  const loadCaptures = useCallback(async () => {
    try {
      setMessage(undefined);
      setCaptures(await api.listCaptures(query));
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "Could not load the library.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, query]);

  useEffect(() => {
    void loadCaptures();
  }, [loadCaptures]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    void loadCaptures();
  }, [loadCaptures]);

  const handleSave = useCallback(async () => {
    const url = draftUrl.trim();
    if (!url) return;
    try {
      setSaving(true);
      setMessage(undefined);
      const result = await saveSource(api, url, Platform.OS === "web" ? "web" : "ios-library");
      if (!result) return;
      setCaptures((current) => [result.capture, ...current]);
      setDraftUrl("");
      setMessage("Saved to Inbox. Processing will continue in the background.");
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "Could not save this source.");
    } finally {
      setSaving(false);
    }
  }, [api, draftUrl]);

  const handleRetry = useCallback(async (captureId: string) => {
    try {
      setRetryingId(captureId);
      setMessage(undefined);
      const result = await api.retryCapture(captureId);
      setCaptures((current) => current.map((capture) => capture.id === captureId ? result.capture : capture));
      setMessage("Capture requeued. Processing will continue in the background.");
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "Could not retry this capture.");
    } finally {
      setRetryingId(undefined);
    }
  }, [api]);

  const visibleCaptures = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return captures;
    return captures.filter((capture) =>
      [capture.title, capture.caption, capture.originalUrl, capture.platform]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized)),
    );
  }, [captures, query]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>KNOWLEDGE LIBRARY</Text>
            <Text style={styles.title}>Saved videos</Text>
            {user?.email ? <Text style={styles.account}>{user.email}</Text> : null}
          </View>
          <View style={styles.headerActions}>
            <View style={styles.inboxBadge}>
              <Text style={styles.inboxBadgeText}>{captures.length}</Text>
            </View>
            {user ? <Pressable onPress={() => void signOut()} style={styles.signOutButton}><Text style={styles.signOutText}>Sign out</Text></Pressable> : null}
          </View>
        </View>

        <Text style={styles.subtitle}>Capture now. Learn from it when processing is complete.</Text>

        <View style={styles.captureBox}>
          <TextInput
            accessibilityLabel="Source URL"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setDraftUrl}
            onSubmitEditing={() => void handleSave()}
            placeholder="Paste a TikTok, Instagram, YouTube, or web link"
            placeholderTextColor="#7d8494"
            returnKeyType="done"
            style={styles.input}
            value={draftUrl}
          />
          <Pressable accessibilityLabel="Save source" accessibilityRole="button" disabled={saving || !draftUrl.trim()} onPress={() => void handleSave()} style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, (saving || !draftUrl.trim()) && styles.disabled]}>
            {saving ? <ActivityIndicator color="#081018" /> : <Text style={styles.saveButtonText}>Save</Text>}
          </Pressable>
        </View>

        <TextInput
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder="Search your library"
          placeholderTextColor="#7d8494"
          style={styles.searchInput}
          value={query}
        />

        {message ? <Text style={styles.message}>{message}</Text> : null}

        {loading ? (
          <View style={styles.emptyState}><ActivityIndicator color="#8ee5c1" /></View>
        ) : (
          <FlatList
            contentContainerStyle={visibleCaptures.length === 0 ? styles.emptyList : styles.list}
            data={visibleCaptures}
            keyExtractor={(item) => item.id}
            refreshControl={<RefreshControl onRefresh={handleRefresh} refreshing={refreshing} tintColor="#8ee5c1" />}
            renderItem={({ item }) => <CaptureCard capture={item} onOpen={() => router.push(`/capture/${item.id}`)} onRetry={handleRetry} retrying={retryingId === item.id} />}
            ListEmptyComponent={<Text style={styles.emptyText}>Your Inbox is ready for its first saved source.</Text>}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function CaptureCard({ capture, onOpen, onRetry, retrying }: { capture: CaptureRecord; onOpen: () => void; onRetry: (captureId: string) => void; retrying: boolean }) {
  const sourceLabel = capture.platform.toUpperCase();
  const title = capture.title ?? capture.originalUrl ?? "Untitled capture";

  return (
    <View style={styles.card}>
      <View style={styles.cardTopLine}>
        <Text style={styles.platform}>{sourceLabel}</Text>
        <Text style={styles.status}>{formatStatus(capture.status)}</Text>
      </View>
      <Text numberOfLines={2} style={styles.cardTitle}>{title}</Text>
      {capture.caption ? <Text numberOfLines={2} style={styles.caption}>{capture.caption}</Text> : null}
      {capture.errorMessage ? <Text style={styles.error}>{capture.errorMessage}</Text> : null}
      {capture.originalUrl ? (
        <Pressable onPress={() => void Linking.openURL(capture.originalUrl!)}>
          <Text numberOfLines={1} style={styles.sourceLink}>{capture.originalUrl}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={onOpen} style={({ pressed }) => [styles.detailsButton, pressed && styles.pressed]}>
        <Text style={styles.detailsText}>Open details</Text>
      </Pressable>
      {capture.status === "failed" ? (
        <Pressable disabled={retrying} onPress={() => onRetry(capture.id)} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed, retrying && styles.disabled]}>
          {retrying ? <ActivityIndicator color="#8ee5c1" size="small" /> : <Text style={styles.retryText}>Retry processing</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

/** Keep machine-readable stage names readable in the Inbox UI. */
function formatStatus(status: CaptureRecord["status"]): string {
  return status.replaceAll("_", " ");
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#081018", flex: 1 },
  container: { alignSelf: "center", flex: 1, maxWidth: 760, paddingHorizontal: 20, width: "100%" },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingTop: 24 },
  headerCopy: { flex: 1 },
  headerActions: { alignItems: "flex-end", gap: 8 },
  eyebrow: { color: "#8ee5c1", fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  title: { color: "#f4f7fb", fontSize: 32, fontWeight: "700", marginTop: 6 },
  subtitle: { color: "#aab2c1", fontSize: 15, lineHeight: 22, marginTop: 8 },
  account: { color: "#7d8494", fontSize: 12, marginTop: 6 },
  inboxBadge: { alignItems: "center", backgroundColor: "#16332e", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  inboxBadgeText: { color: "#8ee5c1", fontSize: 16, fontWeight: "700" },
  signOutButton: { paddingVertical: 2 },
  signOutText: { color: "#8ee5c1", fontSize: 12, fontWeight: "600" },
  captureBox: { alignItems: "center", backgroundColor: "#111c27", borderColor: "#243447", borderRadius: 16, borderWidth: 1, flexDirection: "row", marginTop: 24, padding: 8 },
  input: { color: "#f4f7fb", flex: 1, fontSize: 15, minHeight: 44, paddingHorizontal: 12 },
  saveButton: { alignItems: "center", backgroundColor: "#8ee5c1", borderRadius: 11, justifyContent: "center", minHeight: 44, paddingHorizontal: 18 },
  saveButtonText: { color: "#081018", fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.42 },
  searchInput: { backgroundColor: "#111c27", borderColor: "#243447", borderRadius: 12, borderWidth: 1, color: "#f4f7fb", fontSize: 15, marginTop: 12, minHeight: 46, paddingHorizontal: 14 },
  message: { color: "#8ee5c1", fontSize: 13, lineHeight: 19, marginTop: 12 },
  list: { gap: 12, paddingBottom: 32, paddingTop: 18 },
  emptyList: { flexGrow: 1, justifyContent: "center", paddingBottom: 80 },
  emptyState: { alignItems: "center", flex: 1, justifyContent: "center" },
  emptyText: { color: "#7d8494", fontSize: 15, lineHeight: 22, textAlign: "center" },
  card: { backgroundColor: "#111c27", borderColor: "#243447", borderRadius: 16, borderWidth: 1, padding: 16 },
  cardTopLine: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  platform: { color: "#8ee5c1", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  status: { color: "#aab2c1", fontSize: 12, textTransform: "capitalize" },
  cardTitle: { color: "#f4f7fb", fontSize: 17, fontWeight: "600", lineHeight: 23, marginTop: 12 },
  caption: { color: "#aab2c1", fontSize: 13, lineHeight: 19, marginTop: 8 },
  error: { color: "#f2a7a7", fontSize: 13, lineHeight: 19, marginTop: 8 },
  sourceLink: { color: "#8ee5c1", fontSize: 12, marginTop: 12 },
  retryButton: { alignItems: "center", alignSelf: "flex-start", borderColor: "#8ee5c1", borderRadius: 9, borderWidth: 1, justifyContent: "center", marginTop: 14, minHeight: 36, paddingHorizontal: 12 },
  retryText: { color: "#8ee5c1", fontSize: 13, fontWeight: "600" },
  detailsButton: { alignSelf: "flex-start", marginTop: 14 },
  detailsText: { color: "#f4f7fb", fontSize: 13, fontWeight: "600" },
});
