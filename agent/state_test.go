package main

import (
	"path/filepath"
	"testing"
)

func TestStateStorePersistsPendingTrafficAndAcknowledgement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store := NewStateStore(path)

	state := AgentState{
		DesiredState: "active",
		PendingTraffic: []TrafficBatch{{
			ID:     "batch-1",
			Deltas: []TrafficDelta{{Username: "alice", Uplink: 100, Downlink: 200}},
		}},
		AppliedConfigVersion: 7,
		AppliedConfigHash:    "hash-7",
	}
	if err := store.Save(state); err != nil {
		t.Fatalf("save state: %v", err)
	}

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("load state: %v", err)
	}
	if len(loaded.PendingTraffic) != 1 || loaded.PendingTraffic[0].ID != "batch-1" {
		t.Fatalf("pending batch was not persisted: %#v", loaded.PendingTraffic)
	}
	if loaded.AppliedConfigVersion != 7 || loaded.AppliedConfigHash != "hash-7" {
		t.Fatalf("applied config acknowledgement was not persisted: %#v", loaded)
	}

	if err := store.AcknowledgeTraffic("batch-1"); err != nil {
		t.Fatalf("acknowledge batch: %v", err)
	}
	loaded, err = store.Load()
	if err != nil {
		t.Fatalf("reload state: %v", err)
	}
	if len(loaded.PendingTraffic) != 0 {
		t.Fatalf("acknowledged batch remains pending: %#v", loaded.PendingTraffic)
	}

	// Test multi-batch acknowledge
	multi := []TrafficBatch{
		{ID: "b-1", Deltas: []TrafficDelta{{Username: "u1", Uplink: 10}}},
		{ID: "b-2", Deltas: []TrafficDelta{{Username: "u2", Uplink: 20}}},
		{ID: "b-3", Deltas: []TrafficDelta{{Username: "u3", Uplink: 30}}},
	}
	_ = store.Update(func(s *AgentState) error {
		s.PendingTraffic = multi
		return nil
	})
	if err := store.AcknowledgeTrafficBatches([]string{"b-1", "b-3"}); err != nil {
		t.Fatalf("acknowledge multiple batches: %v", err)
	}
	loaded, err = store.Load()
	if err != nil || len(loaded.PendingTraffic) != 1 || loaded.PendingTraffic[0].ID != "b-2" {
		t.Fatalf("expected only b-2 remaining, got: %#v", loaded.PendingTraffic)
	}
}

func TestStateStorePersistsRevokedDesiredStateAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	store := NewStateStore(path)
	if err := store.Save(AgentState{DesiredState: "revoked"}); err != nil {
		t.Fatalf("save revoked state: %v", err)
	}

	restarted := NewStateStore(path)
	loaded, err := restarted.Load()
	if err != nil {
		t.Fatalf("load after restart: %v", err)
	}
	if loaded.DesiredState != "revoked" {
		t.Fatalf("desired state was not persisted: %q", loaded.DesiredState)
	}
}
