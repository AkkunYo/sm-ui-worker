package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// TrafficBatch is an immutable, retryable unit of traffic accounting.
// The batch ID is generated once and reused until the master acknowledges it.
type TrafficBatch struct {
	ID     string         `json:"id"`
	Deltas []TrafficDelta `json:"deltas"`
}

// AgentState is the durable control-plane state kept beside the node config.
// It deliberately stores the desired state and the last confirmed config so a
// process restart cannot resurrect a revoked node or lose accounting data.
type AgentState struct {
	DesiredState         string         `json:"desired_state"`
	PendingTraffic       []TrafficBatch `json:"pending_traffic"`
	AppliedConfigVersion int            `json:"applied_config_version"`
	AppliedConfigHash    string         `json:"applied_config_hash"`
	LastApplyError       string         `json:"last_apply_error,omitempty"`
}

type StateStore struct {
	path string
	mu   sync.Mutex
}

func NewStateStore(path string) *StateStore {
	return &StateStore{path: path}
}

func (s *StateStore) Load() (AgentState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *StateStore) loadLocked() (AgentState, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return AgentState{DesiredState: "active", PendingTraffic: []TrafficBatch{}}, nil
	}
	if err != nil {
		return AgentState{}, err
	}
	var state AgentState
	if err := json.Unmarshal(data, &state); err != nil {
		return AgentState{}, err
	}
	if state.DesiredState == "" {
		state.DesiredState = "active"
	}
	if state.PendingTraffic == nil {
		state.PendingTraffic = []TrafficBatch{}
	}
	return state, nil
}

func (s *StateStore) Save(state AgentState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(state)
}

func (s *StateStore) saveLocked(state AgentState) error {
	if state.DesiredState == "" {
		state.DesiredState = "active"
	}
	if state.PendingTraffic == nil {
		state.PendingTraffic = []TrafficBatch{}
	}
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0755); err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

func (s *StateStore) Update(fn func(*AgentState) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.loadLocked()
	if err != nil {
		return err
	}
	if err := fn(&state); err != nil {
		return err
	}
	return s.saveLocked(state)
}

func (s *StateStore) AcknowledgeTraffic(batchID string) error {
	return s.Update(func(state *AgentState) error {
		remaining := state.PendingTraffic[:0]
		for _, batch := range state.PendingTraffic {
			if batch.ID != batchID {
				remaining = append(remaining, batch)
			}
		}
		state.PendingTraffic = remaining
		return nil
	})
}
