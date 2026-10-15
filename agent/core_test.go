package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeCore installs a sing-box stand-in: `check` always passes, `run` exits
// immediately (like a port bind failure) when the config contains "bad",
// otherwise it keeps running. Every `run` is appended to runs.log.
func fakeCore(t *testing.T, dir string) string {
	t.Helper()
	runs := filepath.Join(dir, "runs.log")
	script := fmt.Sprintf(`#!/bin/sh
if [ "$1" = "check" ]; then exit 0; fi
echo run >> %q
if grep -q bad "$3"; then exit 1; fi
exec sleep 30
`, runs)
	if err := os.WriteFile(filepath.Join(dir, "bin", "sing-box"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	window := startHealthWindow
	startHealthWindow = 300 * time.Millisecond
	t.Cleanup(func() { stopSingBox(); startHealthWindow = window })
	return runs
}

func runCount(t *testing.T, path string) int {
	t.Helper()
	deadline := time.Now().Add(1 * time.Second)
	var lastCount int
	for {
		data, err := os.ReadFile(path)
		if err == nil {
			lastCount = strings.Count(string(data), "run")
			if lastCount > 0 {
				return lastCount
			}
		}
		if time.Now().After(deadline) {
			return lastCount
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func hashOf(b []byte) string { return fmt.Sprintf("%x", sha256.Sum256(b)) }

func reloadServer(t *testing.T, config []byte) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(SyncResponse{ProtocolVersion: 2, Status: "ok", DesiredState: "active", ConfigVersion: 2, ConfigHash: hashOf(config), Reload: true, Config: json.RawMessage(config)})
	}))
	t.Cleanup(server.Close)
	return server
}

func TestFailedStartRollsBackToPreviousConfig(t *testing.T) {
	dir, _ := stateFixture(t)
	runs := fakeCore(t, dir)
	good, bad := []byte(`{"ok":true}`), []byte(`{"bad":true}`)
	if err := applyConfiguration(dir, good, hashOf(good)); err != nil {
		t.Fatalf("good config rejected: %v", err)
	}
	if err := applyConfiguration(dir, bad, hashOf(bad)); err == nil {
		t.Fatal("config whose core exits at startup was reported as applied")
	}
	data, _ := os.ReadFile(filepath.Join(dir, "configs", "current.json"))
	if string(data) != string(good) {
		t.Fatalf("current config not rolled back: %s", data)
	}
	if !coreRunning() {
		t.Fatal("previous config was not restarted after rollback")
	}
	if n := runCount(t, runs); n != 3 {
		t.Fatalf("expected good, bad and rollback starts, got %d", n)
	}
}

func TestSameHashReloadDoesNotRestartCore(t *testing.T) {
	dir, store := stateFixture(t)
	runs := fakeCore(t, dir)
	config := []byte(`{"ok":true}`)
	current := filepath.Join(dir, "configs", "current.json")
	os.WriteFile(current, config, 0600)
	if err := startSingBox(dir, current); err != nil {
		t.Fatal(err)
	}
	if n := runCount(t, runs); n != 1 {
		t.Fatalf("expected initial start, got %d", n)
	}
	_ = store.Update(func(s *AgentState) error {
		s.DesiredState = "active"
		s.PendingTraffic = nil
		s.AppliedConfigHash = hashOf(config)
		s.LastApplyError = "stale error"
		return nil
	})
	syncWithMaster(Config{MasterURL: reloadServer(t, config).URL, NodeToken: "token", BaseDir: dir}, 1, store)
	time.Sleep(50 * time.Millisecond)
	data, _ := os.ReadFile(runs)
	if n := strings.Count(string(data), "run"); n != 1 {
		t.Fatalf("identical config restarted the core: %d starts", n)
	}
	if state, _ := store.Load(); state.LastApplyError != "" {
		t.Fatalf("stale apply error kept: %q", state.LastApplyError)
	}
}

func TestFailedConfigIsNotRetriedEveryHeartbeat(t *testing.T) {
	dir, store := stateFixture(t)
	runs := fakeCore(t, dir)
	good, bad := []byte(`{"ok":true}`), []byte(`{"bad":true}`)
	if err := applyConfiguration(dir, good, hashOf(good)); err != nil {
		t.Fatal(err)
	}
	_ = store.Update(func(s *AgentState) error {
		s.DesiredState = "active"
		s.PendingTraffic = nil
		s.AppliedConfigHash = hashOf(good)
		return nil
	})
	cfg := Config{MasterURL: reloadServer(t, bad).URL, NodeToken: "token", BaseDir: dir}
	syncWithMaster(cfg, 1, store)
	afterFirst := runCount(t, runs)
	syncWithMaster(cfg, 1, store)
	if n := runCount(t, runs); n != afterFirst {
		t.Fatalf("failed config retried within cooldown: %d -> %d starts", afterFirst, n)
	}
	state, _ := store.Load()
	if state.FailedConfigHash != hashOf(bad) || state.LastApplyError == "" || state.AppliedConfigHash != hashOf(good) {
		t.Fatalf("unexpected state after failed apply: %#v", state)
	}
}
