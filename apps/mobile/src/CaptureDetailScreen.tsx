import { useCallback, useEffect, useState, type ReactNode } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { CaptureDetailResponse } from "@svi/api-client";
import { ApiClientError } from "@svi/api-client";
import type { CaptureStage, ProcessingJob } from "@svi/shared-types";
import { useMobileApiClient } from "./api";

/** Detail view shared by native iOS and the React Native Web build. */
export function CaptureDetailScreen({ captureId }: { captureId: string | undefined }) {
  const api = useMobileApiClient();
  const [detail, setDetail] = useState<CaptureDetailResponse | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [selectingRepository, setSelectingRepository] = useState<string | undefined>();
  const [manualTranscript, setManualTranscript] = useState("");
  const [submittingTranscript, setSubmittingTranscript] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!captureId) {
      setMessage("This capture link is missing an id.");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      setMessage(undefined);
      setDetail(await api.getCapture(captureId));
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "Could not load this capture.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, captureId]);

  const handleRepositoryDecision = useCallback(async (decision: "accept" | "reject", fullName?: string) => {
    if (!captureId) return;
    try {
      setSelectingRepository(fullName ?? decision);
      setMessage(undefined);
      const result = await api.selectGitHubRepository(captureId, decision, fullName);
      setDetail((current) => current ? { ...current, githubRepositoryDiscovery: result.githubRepositoryDiscovery } : current);
      setMessage(decision === "accept" ? "Repository confirmed." : "Repository suggestions rejected.");
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "Could not save the repository decision.");
    } finally {
      setSelectingRepository(undefined);
    }
  }, [api, captureId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleRetry = useCallback(async () => {
    if (!captureId) return;
    try {
      setRetrying(true);
      setMessage(undefined);
      const result = await api.retryCapture(captureId);
      setDetail((current) => current ? { ...current, capture: result.capture, jobs: [...current.jobs, result.job] } : current);
      setMessage("Capture requeued. Processing will continue in the background.");
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "Could not retry this capture.");
    } finally {
      setRetrying(false);
    }
  }, [api, captureId]);

  const handleManualTranscript = useCallback(async () => {
    if (!captureId || !manualTranscript.trim()) return;
    try {
      setSubmittingTranscript(true);
      setMessage(undefined);
      const result = await api.submitManualTranscript(captureId, manualTranscript.trim());
      setDetail((current) => current ? {
        ...current,
        capture: result.capture,
        jobs: [...current.jobs, result.job],
        transcript: result.transcript,
      } : current);
      setManualTranscript("");
      setMessage("Transcript saved. Repository discovery has been queued.");
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "Could not save the transcript.");
    } finally {
      setSubmittingTranscript(false);
    }
  }, [api, captureId, manualTranscript]);

  if (loading) {
    return <CenteredState><ActivityIndicator color="#8ee5c1" /></CenteredState>;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} refreshControl={<RefreshControl onRefresh={() => { setRefreshing(true); void loadDetail(); }} refreshing={refreshing} tintColor="#8ee5c1" />}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹ Back to library</Text>
        </Pressable>

        {message ? <Text style={styles.message}>{message}</Text> : null}
        {detail ? (
          <CaptureDetails
            detail={detail}
            manualTranscript={manualTranscript}
            onRetry={() => void handleRetry()}
            onManualTranscript={() => void handleManualTranscript()}
            onRepositoryDecision={(decision, fullName) => void handleRepositoryDecision(decision, fullName)}
            retrying={retrying}
            selectingRepository={selectingRepository}
            setManualTranscript={setManualTranscript}
            submittingTranscript={submittingTranscript}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function CaptureDetails({
  detail,
  manualTranscript,
  onRetry,
  onManualTranscript,
  onRepositoryDecision,
  retrying,
  selectingRepository,
  setManualTranscript,
  submittingTranscript,
}: {
  detail: CaptureDetailResponse;
  manualTranscript: string;
  onRetry: () => void;
  onManualTranscript: () => void;
  onRepositoryDecision: (decision: "accept" | "reject", fullName?: string) => void;
  retrying: boolean;
  selectingRepository?: string | undefined;
  setManualTranscript: (value: string) => void;
  submittingTranscript: boolean;
}) {
  const { capture, jobs } = detail;
  const title = capture.title ?? capture.originalUrl ?? "Untitled capture";

  return (
    <View>
      <Text style={styles.eyebrow}>{capture.platform.toUpperCase()}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.status}>{formatStage(capture.currentStage)} · retry {capture.retryCount}</Text>

      {capture.caption ? <Text style={styles.caption}>{capture.caption}</Text> : null}
      {capture.errorMessage ? <Text style={styles.error}>{capture.errorMessage}</Text> : null}
      {capture.originalUrl ? (
        <Pressable onPress={() => void Linking.openURL(capture.originalUrl!)}>
          <Text style={styles.sourceLink}>{capture.originalUrl}</Text>
        </Pressable>
      ) : null}
      {detail.transcript ? (
        <View style={styles.transcriptBox}>
          <Text style={styles.sectionTitle}>Transcript</Text>
          <Text style={styles.muted}>Source: {detail.transcript.source} · {detail.transcript.provider}</Text>
          <Text style={styles.transcriptText}>{detail.transcript.text}</Text>
        </View>
      ) : null}
      {!detail.transcript && (capture.status === "failed" || capture.status === "needs_review" || capture.currentStage === "transcribing") ? (
        <View style={styles.manualTranscriptBox}>
          <Text style={styles.sectionTitle}>Add a transcript manually</Text>
          <Text style={styles.muted}>Use this fallback when automated transcript methods cannot access the source.</Text>
          <TextInput
            accessibilityLabel="Manual transcript"
            multiline
            onChangeText={setManualTranscript}
            placeholder="Paste the transcript here"
            placeholderTextColor="#7d8494"
            style={styles.manualTranscriptInput}
            textAlignVertical="top"
            value={manualTranscript}
          />
          <Pressable
            accessibilityLabel="Save manual transcript"
            accessibilityRole="button"
            disabled={submittingTranscript || !manualTranscript.trim()}
            onPress={onManualTranscript}
            style={({ pressed }) => [styles.smallButton, pressed && styles.pressed, (submittingTranscript || !manualTranscript.trim()) && styles.disabled]}
          >
            {submittingTranscript ? <ActivityIndicator color="#081018" size="small" /> : <Text style={styles.smallButtonText}>Save transcript</Text>}
          </Pressable>
        </View>
      ) : null}
      {detail.githubRepositoryDiscovery ? (
        <RepositoryDiscovery
          discovery={detail.githubRepositoryDiscovery}
          onDecision={onRepositoryDecision}
          selectingRepository={selectingRepository}
        />
      ) : null}
      {capture.status === "failed" ? (
        <Pressable disabled={retrying} onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed, retrying && styles.disabled]}>
          {retrying ? <ActivityIndicator color="#081018" size="small" /> : <Text style={styles.retryText}>Retry processing</Text>}
        </Pressable>
      ) : null}

      <Text style={styles.sectionTitle}>Processing history</Text>
      {jobs.length === 0 ? <Text style={styles.muted}>No processing jobs recorded.</Text> : jobs.map((job) => <JobRow job={job} key={job.id} />)}
    </View>
  );
}

function RepositoryDiscovery({
  discovery,
  onDecision,
  selectingRepository,
}: {
  discovery: NonNullable<CaptureDetailResponse["githubRepositoryDiscovery"]>;
  onDecision: (decision: "accept" | "reject", fullName?: string) => void;
  selectingRepository?: string | undefined;
}) {
  return (
    <View style={styles.repositoryBox}>
      <Text style={styles.sectionTitle}>Possible GitHub repositories</Text>
      <Text style={styles.muted}>
        {discovery.selectionStatus === "accepted"
          ? `Accepted: ${discovery.selectedFullName}`
          : discovery.selectionStatus === "rejected"
            ? "Suggestions rejected"
            : discovery.status === "found"
              ? "High-confidence match"
              : discovery.status === "needs_review"
                ? "Review these suggestions"
                : "No repository found"}
      </Text>
      {discovery.candidates.map((candidate) => (
        <View key={candidate.fullName} style={styles.repositoryRow}>
          <Pressable onPress={() => void Linking.openURL(candidate.url)}>
            <Text style={styles.repositoryLink}>{candidate.fullName}</Text>
          </Pressable>
          <Text style={styles.muted}>{Math.round(candidate.confidence * 100)}% confidence</Text>
          {candidate.description ? <Text style={styles.repositoryDescription}>{candidate.description}</Text> : null}
          {discovery.selectionStatus === "unreviewed" ? (
            <Pressable
              disabled={Boolean(selectingRepository)}
              onPress={() => onDecision("accept", candidate.fullName)}
              style={({ pressed }) => [styles.smallButton, pressed && styles.pressed, selectingRepository && styles.disabled]}
            >
              <Text style={styles.smallButtonText}>{selectingRepository === candidate.fullName ? "Saving…" : "Accept repository"}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {discovery.selectionStatus === "unreviewed" && discovery.candidates.length > 0 ? (
        <Pressable
          disabled={Boolean(selectingRepository)}
          onPress={() => onDecision("reject")}
          style={({ pressed }) => [styles.rejectButton, pressed && styles.pressed, selectingRepository && styles.disabled]}
        >
          <Text style={styles.rejectButtonText}>Reject suggestions</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function JobRow({ job }: { job: ProcessingJob }) {
  return (
    <View style={styles.jobRow}>
      <View style={styles.jobDot} />
      <View style={styles.jobContent}>
        <Text style={styles.jobStage}>{formatStage(job.stage)}</Text>
        <Text style={styles.jobStatus}>{job.status} · retry {job.retryCount}</Text>
        {job.errorMessage ? <Text style={styles.error}>{job.errorMessage}</Text> : null}
      </View>
    </View>
  );
}

function CenteredState({ children }: { children: ReactNode }) {
  return <SafeAreaView style={styles.safeArea}><View style={styles.centered}>{children}</View></SafeAreaView>;
}

/** Render shared stage identifiers as human-readable labels. */
function formatStage(stage: CaptureStage): string {
  return stage.replaceAll("_", " ");
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#081018", flex: 1 },
  container: { alignSelf: "center", maxWidth: 760, padding: 20, width: "100%" },
  centered: { alignItems: "center", flex: 1, justifyContent: "center" },
  backButton: { alignSelf: "flex-start", marginBottom: 28 },
  backText: { color: "#8ee5c1", fontSize: 14, fontWeight: "600" },
  eyebrow: { color: "#8ee5c1", fontSize: 11, fontWeight: "700", letterSpacing: 2 },
  title: { color: "#f4f7fb", fontSize: 30, fontWeight: "700", lineHeight: 37, marginTop: 8 },
  status: { color: "#aab2c1", fontSize: 14, marginTop: 10, textTransform: "capitalize" },
  caption: { color: "#aab2c1", fontSize: 15, lineHeight: 23, marginTop: 20 },
  sourceLink: { color: "#8ee5c1", fontSize: 13, lineHeight: 20, marginTop: 18 },
  error: { color: "#f2a7a7", fontSize: 13, lineHeight: 19, marginTop: 12 },
  message: { color: "#8ee5c1", fontSize: 13, lineHeight: 19, marginBottom: 18 },
  retryButton: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "#8ee5c1", borderRadius: 10, justifyContent: "center", marginTop: 18, minHeight: 40, paddingHorizontal: 14 },
  retryText: { color: "#081018", fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
  sectionTitle: { color: "#f4f7fb", fontSize: 18, fontWeight: "700", marginTop: 36 },
  muted: { color: "#7d8494", fontSize: 14, marginTop: 12 },
  jobRow: { borderBottomColor: "#243447", borderBottomWidth: 1, flexDirection: "row", paddingVertical: 16 },
  jobDot: { backgroundColor: "#8ee5c1", borderRadius: 5, height: 10, marginRight: 12, marginTop: 4, width: 10 },
  jobContent: { flex: 1 },
  jobStage: { color: "#f4f7fb", fontSize: 15, textTransform: "capitalize" },
  jobStatus: { color: "#aab2c1", fontSize: 13, marginTop: 4, textTransform: "capitalize" },
  transcriptBox: { marginTop: 24 },
  manualTranscriptBox: { backgroundColor: "#101c28", borderRadius: 12, marginTop: 24, padding: 16 },
  manualTranscriptInput: { backgroundColor: "#081018", borderColor: "#243447", borderRadius: 10, borderWidth: 1, color: "#f4f7fb", fontSize: 15, lineHeight: 22, marginTop: 16, minHeight: 150, padding: 12 },
  transcriptText: { color: "#d7dde8", fontSize: 15, lineHeight: 23, marginTop: 10 },
  repositoryBox: { marginTop: 24 },
  repositoryRow: { borderBottomColor: "#243447", borderBottomWidth: 1, paddingVertical: 12 },
  repositoryLink: { color: "#8ee5c1", fontSize: 15, fontWeight: "700" },
  repositoryDescription: { color: "#d7dde8", fontSize: 13, lineHeight: 19, marginTop: 6 },
  smallButton: { alignSelf: "flex-start", backgroundColor: "#8ee5c1", borderRadius: 8, marginTop: 10, paddingHorizontal: 10, paddingVertical: 8 },
  smallButtonText: { color: "#081018", fontSize: 12, fontWeight: "700" },
  rejectButton: { alignSelf: "flex-start", borderColor: "#657083", borderRadius: 8, borderWidth: 1, marginTop: 14, paddingHorizontal: 10, paddingVertical: 8 },
  rejectButtonText: { color: "#d7dde8", fontSize: 12, fontWeight: "700" },
});
