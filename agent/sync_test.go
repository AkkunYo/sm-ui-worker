package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func stateFixture(t *testing.T) (string, *StateStore) {
	t.Helper()
	stopSingBox()
	t.Cleanup(stopSingBox)
	dir := t.TempDir()
	for _, part := range []string{"configs", "bin"} {
		if err := os.MkdirAll(filepath.Join(dir, part), 0700); err != nil {
			t.Fatal(err)
		}
	}
	store := NewStateStore(filepath.Join(dir, "agent-state.json"))
	if err := store.Save(AgentState{DesiredState: "disabled", AppliedConfigVersion: 7, AppliedConfigHash: "known-good", PendingTraffic: []TrafficBatch{{ID: "pending", Deltas: []TrafficDelta{{Username: "alice", Uplink: 1}}}}}); err != nil {
		t.Fatal(err)
	}
	return dir, store
}
func TestSyncNeverAcknowledgesUnappliedVersion(t *testing.T) {
	dir, store := stateFixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(SyncResponse{ProtocolVersion: 2, Status: "ok", DesiredState: "disabled", ConfigVersion: 99, Reload: false})
	}))
	defer server.Close()
	syncWithMaster(Config{MasterURL: server.URL, NodeToken: "token", BaseDir: dir}, 7, store)
	state, _ := store.Load()
	if state.AppliedConfigVersion != 7 {
		t.Fatalf("unapplied version acknowledged: %d", state.AppliedConfigVersion)
	}
}
func TestRevocationIgnoresConfigAndSurvivesRestart(t *testing.T) {
	dir, store := stateFixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(SyncResponse{ProtocolVersion: 2, Status: "ok", DesiredState: "revoked", ConfigVersion: 99, Reload: true, Config: json.RawMessage(`{}`), ConfigHash: "new"})
	}))
	defer server.Close()
	syncWithMaster(Config{MasterURL: server.URL, NodeToken: "token", BaseDir: dir}, 7, store)
	state, _ := NewStateStore(store.path).Load()
	if state.DesiredState != "revoked" {
		t.Fatalf("revocation lost")
	}
	if _, err := os.Stat(filepath.Join(dir, "configs", "next.json")); !os.IsNotExist(err) {
		t.Fatal("revoked node attempted to install config")
	}
}
func TestUnauthorizedStopsCachedNodePermanently(t *testing.T) {
	dir, store := stateFixture(t)
	_ = store.Update(func(s *AgentState) error { s.DesiredState = "active"; return nil })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }))
	defer server.Close()
	syncWithMaster(Config{MasterURL: server.URL, NodeToken: "invalid", BaseDir: dir}, 7, store)
	state, _ := store.Load()
	if state.DesiredState != "revoked" {
		t.Fatal("unauthorized node can restart cached core")
	}
}
func TestApplyRejectsWrongHashAndKeepsKnownGoodFile(t *testing.T) {
	dir, _ := stateFixture(t)
	current := filepath.Join(dir, "configs", "current.json")
	os.WriteFile(current, []byte(`{"old":true}`), 0600)
	os.WriteFile(filepath.Join(dir, "bin", "sing-box"), []byte("#!/bin/sh\nexit 0\n"), 0700)
	defer stopSingBox()
	if err := applyConfiguration(dir, []byte(`{}`), "incorrect-hash"); err == nil {
		t.Fatal("accepted mismatching config hash")
	}
	data, _ := os.ReadFile(current)
	if string(data) != `{"old":true}` {
		t.Fatal("lost last good config")
	}
}
func TestImmediateCoreExitIsNotSuccessful(t *testing.T) {
	dir, _ := stateFixture(t)
	os.WriteFile(filepath.Join(dir, "bin", "sing-box"), []byte("#!/bin/sh\nexit 0\n"), 0700)
	defer stopSingBox()
	config := []byte(`{}`)
	if err := applyConfiguration(dir, config, fmt.Sprintf("%x", sha256.Sum256(config))); err == nil {
		t.Fatal("crashed core acknowledged")
	}
}

func TestSyncSubmitsAndAcknowledgesMultipleBatches(t *testing.T) {
	dir, store := stateFixture(t)
	_ = store.Update(func(s *AgentState) error {
		s.DesiredState = "active"
		s.PendingTraffic = []TrafficBatch{
			{ID: "batch-1", Deltas: []TrafficDelta{{Username: "alice", Uplink: 10}}},
			{ID: "batch-2", Deltas: []TrafficDelta{{Username: "bob", Uplink: 20}}},
		}
		return nil
	})

	var receivedBatches []TrafficBatch
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req SyncRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		receivedBatches = req.TrafficBatches
		json.NewEncoder(w).Encode(SyncResponse{
			ProtocolVersion:         2,
			Status:                  "ok",
			DesiredState:            "active",
			AcceptedTrafficBatchIDs: []string{"batch-1", "batch-2"},
			Reload:                  false,
		})
	}))
	defer server.Close()

	syncWithMaster(Config{MasterURL: server.URL, NodeToken: "token", BaseDir: dir}, 7, store)
	if len(receivedBatches) != 2 {
		t.Fatalf("expected 2 batches submitted, got: %d", len(receivedBatches))
	}
	state, _ := store.Load()
	if len(state.PendingTraffic) != 0 {
		t.Fatalf("expected all batches cleared, got: %#v", state.PendingTraffic)
	}
}

func TestDoSyncRequestRetriesOnTransientError(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			// Simulate a closed/reset connection on the first attempt
			hj, ok := w.(http.Hijacker)
			if ok {
				conn, _, _ := hj.Hijack()
				conn.Close()
				return
			}
			http.Error(w, "server error", 500)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()

	resp, err := doSyncRequest(server.URL, "test-token", []byte(`{}`))
	if err != nil {
		t.Fatalf("expected retry to succeed, got: %v", err)
	}
	defer resp.Body.Close()
	if attempts != 2 {
		t.Fatalf("expected 2 attempts (1 failure + 1 retry), got: %d", attempts)
	}
}
