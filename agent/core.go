package main

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// coreProcess is one running sing-box instance. done is closed once the
// process has exited, so callers can wait for its ports to be released.
type coreProcess struct {
	cmd  *exec.Cmd
	done chan struct{}
}

var (
	procMu sync.Mutex
	core   *coreProcess

	// startHealthWindow is how long a freshly started core must stay up before
	// a config counts as applied. sing-box binds every inbound during startup
	// and exits on failure (e.g. port in use), well within this window.
	startHealthWindow = 3 * time.Second
	stopGracePeriod   = 5 * time.Second
)

// coreRunningLocked reports whether the current core process is still alive.
func coreRunningLocked() bool {
	if core == nil {
		return false
	}
	select {
	case <-core.done:
		return false
	default:
		return true
	}
}

func coreRunning() bool {
	procMu.Lock()
	defer procMu.Unlock()
	return coreRunningLocked()
}

func startSingBox(baseDir, configPath string) error {
	procMu.Lock()
	defer procMu.Unlock()
	return startSingBoxLocked(baseDir, configPath)
}

// startSingBoxLocked starts sing-box and only succeeds if the process survives
// the health window.
func startSingBoxLocked(baseDir, configPath string) error {
	binPath := filepath.Join(baseDir, "bin", "sing-box")
	if _, err := os.Stat(binPath); err != nil {
		return fmt.Errorf("sing-box binary not found at %s", binPath)
	}

	cmd := exec.Command(binPath, "run", "-c", configPath)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start sing-box: %w", err)
	}
	proc := &coreProcess{cmd: cmd, done: make(chan struct{})}
	core = proc
	log.Printf("sing-box core started (PID: %d)", cmd.Process.Pid)

	go func() {
		_ = cmd.Wait()
		close(proc.done)
		procMu.Lock()
		if core == proc {
			core = nil
		}
		procMu.Unlock()
		log.Printf("sing-box process exited.")
	}()

	select {
	case <-proc.done:
		return fmt.Errorf("sing-box exited during startup health check")
	case <-time.After(startHealthWindow):
		return nil
	}
}

func stopSingBox() {
	procMu.Lock()
	defer procMu.Unlock()
	stopSingBoxLocked()
}

// stopSingBoxLocked stops the core gracefully and waits for it to exit so the
// next instance can bind the same ports.
func stopSingBoxLocked() {
	proc := core
	core = nil
	if proc == nil || proc.cmd.Process == nil {
		return
	}
	select {
	case <-proc.done:
		return
	default:
	}
	_ = proc.cmd.Process.Signal(syscall.SIGTERM)
	select {
	case <-proc.done:
	case <-time.After(stopGracePeriod):
		_ = proc.cmd.Process.Kill()
		<-proc.done
	}
}

// restartWithRollback replaces the running core with currentPath. sing-box's
// own SIGHUP reload exits the process when the new config fails at runtime,
// so restart explicitly and fall back to the previous config on failure.
func restartWithRollback(baseDir, currentPath string, previous []byte) error {
	procMu.Lock()
	defer procMu.Unlock()

	stopSingBoxLocked()
	startErr := startSingBoxLocked(baseDir, currentPath)
	if startErr == nil {
		return nil
	}
	if previous == nil {
		_ = os.Remove(currentPath)
		return startErr
	}
	if err := writeFileAtomic(currentPath, previous, 0644); err != nil {
		return fmt.Errorf("%v; restoring previous config failed: %w", startErr, err)
	}
	if err := startSingBoxLocked(baseDir, currentPath); err != nil {
		return fmt.Errorf("%v; previous config also failed to start: %w", startErr, err)
	}
	return fmt.Errorf("%w (rolled back to previous config)", startErr)
}
