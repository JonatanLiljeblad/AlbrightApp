import HistoryDialog from "@/components/HistoryDialog";
import ReserveDialog from "@/components/ReserveDialog";
import { isAdmin as isAdminEnv, isOwner as isOwnerEnv } from "@/src/auth";
import { auth, db } from "@/src/firebase";
import type { AccessRequest } from "@/src/types";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Portal,
  Text,
  TextInput,
} from "react-native-paper";

type RoleDoc = { email: string; createdAt: number; createdBy: string };

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export default function AdminScreen() {
  const me = (auth.currentUser?.email ?? "").trim().toLowerCase();

  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [ownerDoc, setOwnerDoc] = useState(false);
  const [adminDoc, setAdminDoc] = useState(false);

  const [permOpen, setPermOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);
  const [owners, setOwners] = useState<RoleDoc[]>([]);
  const [admins, setAdmins] = useState<RoleDoc[]>([]);
  const [newOwner, setNewOwner] = useState("");
  const [newAdmin, setNewAdmin] = useState("");

  useEffect(() => {
    if (!me) return;
    const unsubOwner = onSnapshot(doc(db, "owners", me), (s) =>
      setOwnerDoc(s.exists()),
    );
    const unsubAdmin = onSnapshot(doc(db, "admins", me), (s) =>
      setAdminDoc(s.exists()),
    );
    return () => {
      unsubOwner();
      unsubAdmin();
    };
  }, [me]);

  const owner = useMemo(() => ownerDoc || isOwnerEnv(me), [ownerDoc, me]);
  const canAdmin = useMemo(
    () => owner || adminDoc || isAdminEnv(me),
    [owner, adminDoc, me],
  );

  useEffect(() => {
    if (!canAdmin) {
      setRequests([]);
      return;
    }
    const q = query(
      collection(db, "accessRequests"),
      where("status", "==", "pending"),
    );
    const unsub = onSnapshot(
      q,
      (snap) => setRequests(snap.docs.map((d) => d.data() as AccessRequest)),
      () => {},
    );
    return unsub;
  }, [canAdmin]);

  useEffect(() => {
    if (!owner) {
      setOwners([]);
      setAdmins([]);
      return;
    }

    const unsubOwners = onSnapshot(
      collection(db, "owners"),
      (snap) =>
        setOwners(
          snap.docs
            .map((d) => d.data() as RoleDoc)
            .sort((a, b) => a.email.localeCompare(b.email)),
        ),
      () => {},
    );
    const unsubAdmins = onSnapshot(
      collection(db, "admins"),
      (snap) =>
        setAdmins(
          snap.docs
            .map((d) => d.data() as RoleDoc)
            .sort((a, b) => a.email.localeCompare(b.email)),
        ),
      () => {},
    );

    return () => {
      unsubOwners();
      unsubAdmins();
    };
  }, [owner]);

  async function addRole(role: "owners" | "admins", email: string) {
    const by = auth.currentUser?.email ?? "";
    if (!owner) return;

    const key = normalizeEmail(email);
    if (!/.+@.+\..+/.test(key)) {
      Alert.alert("Invalid email", "Please enter a valid email.");
      return;
    }

    Alert.alert(`Add ${role === "owners" ? "owner" : "admin"}?`, key, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Add",
        style: "default",
        onPress: async () => {
          try {
            setBusy(true);
            await setDoc(
              doc(db, role, key),
              {
                email: key,
                createdAt: Date.now(),
                createdBy: by,
              } satisfies RoleDoc,
              { merge: true },
            );
          } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Failed");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function removeRole(role: "owners" | "admins", email: string) {
    if (!owner) return;

    const key = normalizeEmail(email);
    if (role === "owners" && owners.length <= 1) {
      Alert.alert(
        "Not allowed",
        "You must keep at least one owner to avoid lockout.",
      );
      return;
    }

    Alert.alert(`Remove ${role === "owners" ? "owner" : "admin"}?`, key, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            setBusy(true);
            await deleteDoc(doc(db, role, key));
          } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Failed");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  async function decide(email: string, allowed: boolean) {
    try {
      setBusy(true);
      const adminEmail = auth.currentUser?.email ?? "";
      if (!canAdmin) throw new Error("Not an admin");

      const key = email.trim().toLowerCase();
      await setDoc(
        doc(db, "accessRequests", key),
        {
          status: allowed ? "approved" : "denied",
          decidedAt: Date.now(),
          decidedBy: adminEmail,
        },
        { merge: true },
      );

      if (allowed) {
        await setDoc(
          doc(db, "allowedEmails", key),
          {
            email: key,
            createdAt: Date.now(),
            createdBy: adminEmail,
          },
          { merge: true },
        );
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!canAdmin) {
    return (
      <Card style={styles.card} mode="elevated">
        <Card.Title title="Admin" subtitle="No access" />
        <Card.Content>
          <Text>You don’t have access to this page.</Text>
        </Card.Content>
      </Card>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        <Card style={styles.card} mode="elevated">
          <Card.Content>
            {owner && (
              <>
                <Text style={styles.section}>Owners</Text>
                {owners.length === 0 ? (
                  <Text style={styles.muted}>No owners found.</Text>
                ) : (
                  owners.map((o) => (
                    <Card key={o.email} style={styles.req} mode="outlined">
                      <Card.Title title={o.email} subtitle="Owner" />
                    </Card>
                  ))
                )}

                <Text style={styles.section}>Admins</Text>
                {admins.length === 0 ? (
                  <Text style={styles.muted}>No admins found.</Text>
                ) : (
                  admins.map((a) => (
                    <Card key={a.email} style={styles.req} mode="outlined">
                      <Card.Title title={a.email} subtitle="Admin" />
                    </Card>
                  ))
                )}
              </>
            )}

            <View style={styles.btnGroup}>
              {owner && (
                <Button
                  mode="contained"
                  disabled={busy}
                  onPress={() => setPermOpen(true)}
                  contentStyle={styles.btnContent}
                >
                  Manage permissions
                </Button>
              )}
              <Button
                mode="contained"
                disabled={busy}
                onPress={() => setHistOpen(true)}
                contentStyle={styles.btnContent}
              >
                View history
              </Button>
              <View>
                <Button
                  mode="contained"
                  disabled={busy}
                  onPress={() => setReqOpen(true)}
                  contentStyle={styles.btnContent}
                >
                  Access requests
                </Button>
                {requests.length > 0 && (
                  <Badge style={styles.badge}>{requests.length}</Badge>
                )}
              </View>
              <Button
                mode="contained"
                disabled={busy}
                onPress={() => setResOpen(true)}
                contentStyle={styles.btnContent}
              >
                Reserve time
              </Button>
            </View>
          </Card.Content>
        </Card>
      </ScrollView>

      <Portal>
        <Dialog
          visible={permOpen}
          onDismiss={() => setPermOpen(false)}
          style={styles.dialog}
        >
          <Dialog.Title style={styles.dialogTitle}>Permissions</Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <Dialog.Content style={styles.dialogContent}>
              <Text style={styles.section}>Owners</Text>
              {owners.length === 0 ? (
                <Text style={styles.muted}>No owners found.</Text>
              ) : (
                owners.map((o) => (
                  <View key={o.email} style={styles.row}>
                    <Text
                      style={styles.rowEmail}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {o.email}
                    </Text>
                    <Button
                      mode="contained-tonal"
                      textColor="#D7263D"
                      disabled={busy}
                      onPress={() => removeRole("owners", o.email)}
                    >
                      Remove
                    </Button>
                  </View>
                ))
              )}

              <View style={styles.addRow}>
                <TextInput
                  label="Add owner email"
                  mode="outlined"
                  value={newOwner}
                  onChangeText={setNewOwner}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.input}
                />
                <Button
                  style={styles.addBtn}
                  mode="contained"
                  disabled={busy || newOwner.trim().length === 0}
                  onPress={async () => {
                    await addRole("owners", newOwner);
                    setNewOwner("");
                  }}
                >
                  Add
                </Button>
              </View>

              <Text style={styles.section}>Admins</Text>
              {admins.length === 0 ? (
                <Text style={styles.muted}>No admins found.</Text>
              ) : (
                admins.map((a) => (
                  <View key={a.email} style={styles.row}>
                    <Text
                      style={styles.rowEmail}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {a.email}
                    </Text>
                    <Button
                      mode="contained-tonal"
                      textColor="#D7263D"
                      disabled={busy}
                      onPress={() => removeRole("admins", a.email)}
                    >
                      Remove
                    </Button>
                  </View>
                ))
              )}

              <View style={styles.addRow}>
                <TextInput
                  label="Add admin email"
                  mode="outlined"
                  value={newAdmin}
                  onChangeText={setNewAdmin}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={styles.input}
                />
                <Button
                  style={styles.addBtn}
                  mode="contained"
                  disabled={busy || newAdmin.trim().length === 0}
                  onPress={async () => {
                    await addRole("admins", newAdmin);
                    setNewAdmin("");
                  }}
                >
                  Add
                </Button>
              </View>
            </Dialog.Content>
          </Dialog.ScrollArea>
          <Dialog.Actions style={styles.dialogActions}>
            <Button
              style={styles.closeBtn}
              contentStyle={styles.closeBtnContent}
              mode="contained"
              onPress={() => setPermOpen(false)}
            >
              Close
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <Portal>
        <Dialog
          visible={reqOpen}
          onDismiss={() => setReqOpen(false)}
          style={styles.dialog}
        >
          <Dialog.Title style={styles.dialogTitle}>
            Access Requests
          </Dialog.Title>
          <Dialog.ScrollArea style={styles.scrollArea}>
            <Dialog.Content style={styles.dialogContent}>
              {requests.length === 0 ? (
                <Text>No pending requests.</Text>
              ) : (
                requests.map((r) => (
                  <Card key={r.email} style={styles.req} mode="outlined">
                    <Card.Title title={r.name || r.email} subtitle={r.email} />
                    <Card.Actions style={styles.actions}>
                      <Button
                        disabled={busy}
                        mode="contained-tonal"
                        onPress={() => decide(r.email, false)}
                      >
                        Deny
                      </Button>
                      <Button
                        disabled={busy}
                        mode="contained"
                        onPress={() => decide(r.email, true)}
                      >
                        Allow
                      </Button>
                    </Card.Actions>
                  </Card>
                ))
              )}
            </Dialog.Content>
          </Dialog.ScrollArea>
          <Dialog.Actions style={styles.dialogActions}>
            <Button
              style={styles.closeBtn}
              contentStyle={styles.closeBtnContent}
              mode="contained"
              onPress={() => setReqOpen(false)}
            >
              Close
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <HistoryDialog visible={histOpen} onDismiss={() => setHistOpen(false)} />
      <ReserveDialog visible={resOpen} onDismiss={() => setResOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 16 },
  card: { margin: 16, borderRadius: 16 },

  dialog: { alignSelf: "center", width: "94%", maxWidth: 560 },
  dialogTitle: { width: "100%", textAlign: "center", paddingHorizontal: 0 },
  dialogContent: { paddingBottom: 16 },
  dialogActions: {
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  closeBtn: { minWidth: 160 },
  closeBtnContent: { paddingVertical: 6 },

  btnGroup: { marginTop: 18, gap: 15 },
  btnContent: { paddingVertical: 8 },
  badge: { position: "absolute", top: -4, right: -4 },
  req: { marginTop: 12 },
  muted: { opacity: 0.7, marginBottom: 10 },
  section: { marginTop: 18, marginBottom: 8, fontWeight: "700" },
  actions: { justifyContent: "flex-end", gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  rowEmail: { flex: 1, minWidth: 0, flexShrink: 1 },
  addRow: { marginTop: 10, gap: 8 },
  input: { width: "100%" },
  addBtn: { alignSelf: "flex-end" },
  scrollArea: { maxHeight: 620, borderTopWidth: 0, borderBottomWidth: 0 },
});
