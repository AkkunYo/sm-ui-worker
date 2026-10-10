package main

import (
	"archive/tar"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type Config struct {
	MasterURL string
	NodeToken string
	BaseDir   string
	Interval  time.Duration
}

type SyncRequest struct {
	ProtocolVersion      int            `json:"protocol_version"`
	Token                string         `json:"token"`
	Status               string         `json:"status"`
	RTTMs                int64          `json:"rtt_ms"`
	CPUPercent           float64        `json:"cpu_percent"`
	MemoryPercent        float64        `json:"memory_percent"`
	UptimeSeconds        int64          `json:"uptime_seconds"`
	CoreVersion          string         `json:"core_version"`
	AgentVersion         string         `json:"agent_version,omitempty"`
	AppliedConfigVersion int            `json:"applied_config_version"`
	AppliedConfigHash    string         `json:"applied_config_hash,omitempty"`
	ApplyError           string         `json:"apply_error,omitempty"`
	TrafficBatchID       string         `json:"traffic_batch_id,omitempty"`
	TrafficDeltas        []TrafficDelta `json:"traffic_deltas,omitempty"`
}

type TrafficDelta struct {
	Username string `json:"username"`
	Uplink   int64  `json:"uplink"`
	Downlink int64  `json:"downlink"`
}

type SyncResponse struct {
	ProtocolVersion        int             `json:"protocol_version"`
	Status                 string          `json:"status"`
	DesiredState           string          `json:"desired_state"`
	ConfigVersion          int             `json:"config_version"`
	ConfigHash             string          `json:"config_hash,omitempty"`
	Reload                 bool            `json:"reload"`
	Config                 json.RawMessage `json:"config,omitempty"`
	AcceptedTrafficBatchID string          `json:"accepted_traffic_batch_id,omitempty"`
}

var (
	// Version metadata injected at compile time via -ldflags "-X"
	Version   = "dev"
	GitCommit = "none"
	BuildTime = "unknown"

	procMu      sync.Mutex
	singBoxCmd  *exec.Cmd
	cpuMu       sync.Mutex
	lastTotalCP uint64
	lastIdleCP  uint64
)

const protocolVersion = 2

func main() {
	var cfg Config
	showVersion := flag.Bool("version", false, "Print agent version and exit")
	flag.StringVar(&cfg.MasterURL, "master", os.Getenv("MASTER_URL"), "Cloudflare Worker Master API URL")
	flag.StringVar(&cfg.NodeToken, "token", os.Getenv("NODE_TOKEN"), "Node HostId Token UUID")
	flag.StringVar(&cfg.BaseDir, "dir", "/var/lib/sm-ui", "Base directory for runtime configs and certs")
	intervalSec := flag.Int("interval", 30, "Sync polling interval in seconds")
	flag.Parse()

	if *showVersion {
		fmt.Printf("sm-node version %s (commit: %s, built: %s)\n", Version, GitCommit, BuildTime)
		os.Exit(0)
	}
	if envDir := os.Getenv("BASE_DIR"); envDir != "" {
		cfg.BaseDir = envDir
	}
	if envInt := os.Getenv("INTERVAL"); envInt != "" {
		if sec, err := strconv.Atoi(envInt); err == nil && sec > 0 {
			*intervalSec = sec
		}
	}
	cfg.Interval = time.Duration(*intervalSec) * time.Second
	if cfg.MasterURL == "" || cfg.NodeToken == "" {
		log.Fatalf("Fatal: MASTER_URL and NODE_TOKEN must be specified via environment variables or flags.")
	}
	cfg.MasterURL = strings.TrimRight(cfg.MasterURL, "/")

	log.Printf("==================================================")
	log.Printf("  SM-UI Node Agent %s (%s)", Version, GitCommit)
	log.Printf("  Master URL: %s", cfg.MasterURL)
	log.Printf("  Token UUID: %s***", cfg.NodeToken[:min(6, len(cfg.NodeToken))])
	log.Printf("  Base Dir:   %s", cfg.BaseDir)
	log.Printf("  Interval:   %v", cfg.Interval)
	log.Printf("  Protocol:   v%d", protocolVersion)
	log.Printf("==================================================")

	_ = os.MkdirAll(filepath.Join(cfg.BaseDir, "bin"), 0755)
	_ = os.MkdirAll(filepath.Join(cfg.BaseDir, "configs"), 0755)
	_ = os.MkdirAll(filepath.Join(cfg.BaseDir, "certs"), 0755)
	stateStore := NewStateStore(filepath.Join(cfg.BaseDir, "agent-state.json"))
	state, err := stateStore.Load()
	if err != nil {
		log.Fatalf("Fatal: cannot load durable agent state: %v", err)
	}
	ensureSelfSignedCert(filepath.Join(cfg.BaseDir, "certs", "selfsigned.crt"), filepath.Join(cfg.BaseDir, "certs", "selfsigned.key"))
	ensureSelfSignedCert(filepath.Join(cfg.BaseDir, "certs", "hy2.crt"), filepath.Join(cfg.BaseDir, "certs", "hy2.key"))

	if err := ensureSingBoxBinary(cfg.BaseDir); err != nil {
		log.Printf("Warning: sing-box binary preparation warning: %v", err)
	}

	cachedConfig := filepath.Join(cfg.BaseDir, "configs", "current.json")
	if state.DesiredState == "active" {
		if _, err := os.Stat(cachedConfig); err == nil {
			log.Printf("Cached configuration found at %s, starting sing-box...", cachedConfig)
			if err := startSingBox(cfg.BaseDir, cachedConfig); err != nil {
				log.Printf("Cached configuration start failed: %v", err)
			}
		} else {
			log.Printf("No local configuration yet. Fetching initial configuration from Master...")
		}
	} else {
		log.Printf("Node desired state is %q; keeping sing-box stopped until Master changes it.", state.DesiredState)
	}

	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, syscall.SIGINT, syscall.SIGTERM)
	currentConfigVer := state.AppliedConfigVersion
	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()
	currentConfigVer = syncWithMaster(cfg, currentConfigVer, stateStore)

	for {
		select {
		case <-stopChan:
			log.Printf("Received termination signal, stopping sing-box...")
			stopSingBox()
			log.Printf("Agent stopped.")
			return
		case <-ticker.C:
			currentConfigVer = syncWithMaster(cfg, currentConfigVer, stateStore)
		}
	}
}

func syncWithMaster(cfg Config, currentVer int, stateStore *StateStore) int {
	state, err := stateStore.Load()
	if err != nil {
		log.Printf("[State] Load failed: %v", err)
		return currentVer
	}

	procMu.Lock()
	if state.DesiredState == "active" && singBoxCmd == nil {
		currentPath := filepath.Join(cfg.BaseDir, "configs", "current.json")
		if _, err := os.Stat(currentPath); err == nil {
			log.Printf("[Watchdog] sing-box core is stopped, attempting recovery restart...")
			if err := startSingBoxLocked(cfg.BaseDir, currentPath); err != nil {
				log.Printf("[Watchdog] Recovery restart failed: %v", err)
			}
		}
	}
	nodeStatus := "online"
	if state.DesiredState != "active" {
		procMu.Unlock()
		stopSingBox()
		nodeStatus = "stopped"
	} else {
		if singBoxCmd == nil {
			nodeStatus = "offline"
		}
		procMu.Unlock()
	}

	freshDeltas := queryTrafficDeltas()
	if len(freshDeltas) > 0 {
		log.Printf("[Traffic] Captured deltas for %d users from sing-box", len(freshDeltas))
		batchID, idErr := newBatchID()
		if idErr != nil {
			log.Printf("[Traffic] Cannot create batch ID: %v", idErr)
		} else if err := stateStore.Update(func(s *AgentState) error {
			s.PendingTraffic = append(s.PendingTraffic, TrafficBatch{ID: batchID, Deltas: freshDeltas})
			return nil
		}); err != nil {
			log.Printf("[Traffic] Cannot persist batch: %v", err)
		}
	}
	state, err = stateStore.Load()
	if err != nil {
		log.Printf("[State] Reload failed: %v", err)
		return currentVer
	}

	var batchID string
	var trafficDeltas []TrafficDelta
	if len(state.PendingTraffic) > 0 {
		batchID = state.PendingTraffic[0].ID
		trafficDeltas = state.PendingTraffic[0].Deltas
	}
	reqPayload := SyncRequest{
		ProtocolVersion:      protocolVersion,
		Token:                cfg.NodeToken,
		Status:               nodeStatus,
		RTTMs:                measureRTT(cfg.MasterURL),
		CPUPercent:           readCPUPercent(),
		MemoryPercent:        readMemPercent(),
		UptimeSeconds:        readSystemUptime(),
		CoreVersion:          "v1.14.2",
		AgentVersion:         Version,
		AppliedConfigVersion: state.AppliedConfigVersion,
		AppliedConfigHash:    state.AppliedConfigHash,
		ApplyError:           state.LastApplyError,
		TrafficBatchID:       batchID,
		TrafficDeltas:        trafficDeltas,
	}

	data, err := json.Marshal(reqPayload)
	if err != nil {
		return currentVer
	}
	syncURL := fmt.Sprintf("%s/api/v2/node/sync", cfg.MasterURL)
	req, err := http.NewRequest("POST", syncURL, bytes.NewBuffer(data))
	if err != nil {
		return currentVer
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Node-Token", cfg.NodeToken)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("[Heartbeat] Sync failed: %v", err)
		return currentVer
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("[Heartbeat] Master responded with status %d: %s", resp.StatusCode, string(body))
		if resp.StatusCode == http.StatusUnauthorized {
			_ = stateStore.Update(func(s *AgentState) error { s.DesiredState = "revoked"; return nil })
			stopSingBox()
		}
		return currentVer
	}

	var syncResp SyncResponse
	if err := json.NewDecoder(resp.Body).Decode(&syncResp); err != nil {
		return currentVer
	}
	if syncResp.ProtocolVersion != protocolVersion {
		log.Printf("[Heartbeat] Unsupported master protocol version %d", syncResp.ProtocolVersion)
		return currentVer
	}
	if syncResp.AcceptedTrafficBatchID != "" {
		if err := stateStore.AcknowledgeTraffic(syncResp.AcceptedTrafficBatchID); err != nil {
			log.Printf("[Traffic] Cannot acknowledge batch %s: %v", syncResp.AcceptedTrafficBatchID, err)
		}
	}
	if syncResp.DesiredState != "" && syncResp.DesiredState != state.DesiredState {
		if err := stateStore.Update(func(s *AgentState) error {
			s.DesiredState = syncResp.DesiredState
			return nil
		}); err != nil {
			log.Printf("[State] Cannot persist desired state: %v", err)
		}
		if syncResp.DesiredState != "active" {
			stopSingBox()
		}
	}

	if syncResp.Reload && len(syncResp.Config) > 0 {
		log.Printf("[Sync] New configuration received (version: %d, hash: %s). Applying...", syncResp.ConfigVersion, syncResp.ConfigHash)
		if err := applyConfiguration(cfg.BaseDir, syncResp.Config, syncResp.ConfigHash); err != nil {
			log.Printf("[Sync] Failed to apply configuration: %v", err)
			_ = stateStore.Update(func(s *AgentState) error { s.LastApplyError = err.Error(); return nil })
			return currentVer
		}
		log.Printf("[Sync] Configuration v%d applied successfully!", syncResp.ConfigVersion)
		_ = stateStore.Update(func(s *AgentState) error {
			s.AppliedConfigVersion = syncResp.ConfigVersion
			s.AppliedConfigHash = syncResp.ConfigHash
			s.LastApplyError = ""
			return nil
		})
		return syncResp.ConfigVersion
	}

	if !syncResp.Reload {
		// A no-reload response is not an application acknowledgement. The
		// master may be returning a stop command or merely reporting desired
		// state; only applyConfiguration() advances durable applied state.
		return currentVer
	}
	return currentVer
}

func newBatchID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", raw[:]), nil
}

func applyConfiguration(baseDir string, configBytes []byte, configHash string) error {
	nextPath := filepath.Join(baseDir, "configs", "next.json")
	currentPath := filepath.Join(baseDir, "configs", "current.json")
	previousPath := filepath.Join(baseDir, "configs", "previous.json")
	hashPath := filepath.Join(baseDir, "configs", "current.hash")
	binPath := filepath.Join(baseDir, "bin", "sing-box")

	if configHash != "" {
		actual := fmt.Sprintf("%x", sha256.Sum256(configBytes))
		if !strings.EqualFold(actual, strings.TrimSpace(configHash)) {
			return fmt.Errorf("configuration hash mismatch: expected %s, got %s", configHash, actual)
		}
	}
	if err := os.WriteFile(nextPath, configBytes, 0644); err != nil {
		return err
	}

	// Validate config via `sing-box check` if binary exists
	if _, err := os.Stat(binPath); err == nil {
		cmd := exec.Command(binPath, "check", "-c", nextPath)
		if out, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("sing-box check failed: %s (%w)", string(out), err)
		}
	}

	// Keep the last known-good configuration so a reload or process health
	// failure never strands the node on an unverified file.
	previous, previousErr := os.ReadFile(currentPath)
	if previousErr == nil {
		if err := os.WriteFile(previousPath, previous, 0644); err != nil {
			return err
		}
	}

	// Atomic swap config
	if err := os.Rename(nextPath, currentPath); err != nil {
		return err
	}

	// Reload or Start
	if err := reloadSingBox(baseDir, currentPath); err != nil {
		if previousErr == nil {
			_ = os.WriteFile(currentPath, previous, 0644)
		} else {
			_ = os.Remove(currentPath)
		}
		return err
	}

	// Persist active config hash only after sing-box has actually picked up the new config,
	// so a failed reload is retried on the next heartbeat instead of being reported as applied.
	if configHash != "" {
		if err := writeFileAtomic(hashPath, []byte(configHash), 0644); err != nil {
			log.Printf("[Sync] Failed to persist config hash: %v", err)
		}
	}
	_ = os.Remove(previousPath)
	return nil
}

func reloadSingBox(baseDir, currentPath string) error {
	procMu.Lock()
	defer procMu.Unlock()

	if singBoxCmd != nil && singBoxCmd.Process != nil {
		if err := singBoxCmd.Process.Signal(syscall.SIGHUP); err != nil {
			_ = singBoxCmd.Process.Kill()
			singBoxCmd = nil
			return startSingBoxLocked(baseDir, currentPath)
		}
		log.Printf("Sent SIGHUP to sing-box (PID: %d)", singBoxCmd.Process.Pid)
		return nil
	}

	return startSingBoxLocked(baseDir, currentPath)
}

// writeFileAtomic writes to a temp file and renames it into place
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, perm); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func startSingBox(baseDir, configPath string) error {
	procMu.Lock()
	defer procMu.Unlock()
	return startSingBoxLocked(baseDir, configPath)
}

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
	singBoxCmd = cmd
	log.Printf("sing-box core started successfully (PID: %d)", cmd.Process.Pid)

	go func() {
		_ = cmd.Wait()
		procMu.Lock()
		if singBoxCmd == cmd {
			singBoxCmd = nil
		}
		procMu.Unlock()
		log.Printf("sing-box process exited.")
	}()

	// A process that exits immediately after Start is not a successful apply.
	// Give sing-box a short health window before acknowledging the config.
	time.Sleep(500 * time.Millisecond)
	if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
		return fmt.Errorf("sing-box exited during health check")
	}

	return nil
}

func stopSingBox() {
	procMu.Lock()
	defer procMu.Unlock()
	if singBoxCmd != nil && singBoxCmd.Process != nil {
		_ = singBoxCmd.Process.Kill()
		singBoxCmd = nil
	}
}

func ensureSingBoxBinary(baseDir string) error {
	symlink := filepath.Join(baseDir, "bin", "sing-box")
	if fi, err := os.Stat(symlink); err == nil && !fi.IsDir() {
		return nil
	}

	candidates := []string{"sing-box", "/usr/local/bin/sing-box", "/usr/bin/sing-box", "/bin/sing-box"}
	for _, cand := range candidates {
		var found string
		if filepath.IsAbs(cand) {
			if fi, err := os.Stat(cand); err == nil && !fi.IsDir() {
				found = cand
			}
		} else {
			if p, err := exec.LookPath(cand); err == nil {
				found = p
			}
		}
		if found != "" {
			_ = os.Remove(symlink)
			if err := os.Symlink(found, symlink); err == nil {
				return nil
			}
		}
	}

	// Download official release
	arch := runtime.GOARCH
	goos := runtime.GOOS
	if goos != "linux" {
		goos = "linux"
	}
	version := "1.14.2"
	filename := fmt.Sprintf("sing-box-%s-%s-%s.tar.gz", version, goos, arch)
	url := fmt.Sprintf("https://github.com/SagerNet/sing-box/releases/download/v%s/%s", version, filename)

	log.Printf("Downloading sing-box %s from %s...", version, url)
	resp, err := http.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download failed with status: %d", resp.StatusCode)
	}

	gzReader, err := gzip.NewReader(resp.Body)
	if err != nil {
		return err
	}
	defer gzReader.Close()

	tarReader := tar.NewReader(gzReader)
	destBin := filepath.Join(baseDir, "bin", fmt.Sprintf("sing-box-v%s", version))

	for {
		hdr, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if filepath.Base(hdr.Name) == "sing-box" && hdr.Typeflag == tar.TypeReg {
			f, err := os.OpenFile(destBin, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
			if err != nil {
				return err
			}
			_, _ = io.Copy(f, tarReader)
			f.Close()
			_ = os.Remove(symlink)
			return os.Symlink(destBin, symlink)
		}
	}

	return fmt.Errorf("sing-box binary not found in tarball")
}

func ensureSelfSignedCert(certPath, keyPath string) {
	if _, err := os.Stat(certPath); err == nil {
		if _, err := os.Stat(keyPath); err == nil {
			return
		}
	}
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: "bing.com"},
		NotBefore:    time.Now().Add(-1 * time.Hour),
		NotAfter:     time.Now().Add(3650 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"bing.com", "localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return
	}
	certOut, err := os.Create(certPath)
	if err == nil {
		_ = pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: der})
		certOut.Close()
	}
	keyBytes, err := x509.MarshalECPrivateKey(priv)
	if err == nil {
		keyOut, err := os.Create(keyPath)
		if err == nil {
			_ = pem.Encode(keyOut, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes})
			keyOut.Close()
		}
	}
}

func measureRTT(masterURL string) int64 {
	u, err := url.Parse(masterURL)
	if err != nil {
		return 0
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		if u.Scheme == "http" {
			host += ":80"
		} else {
			host += ":443"
		}
	}
	start := time.Now()
	conn, err := net.DialTimeout("tcp", host, 3*time.Second)
	if err != nil {
		return 0
	}
	_ = conn.Close()
	return time.Since(start).Milliseconds()
}

func readMemPercent() float64 {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0.0
	}
	defer file.Close()
	var total, available float64
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				total, _ = strconv.ParseFloat(fields[1], 64)
			}
		} else if strings.HasPrefix(line, "MemAvailable:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				available, _ = strconv.ParseFloat(fields[1], 64)
			}
		}
	}
	if total > 0 {
		return ((total - available) / total) * 100.0
	}
	return 0.0
}

func readCPUPercent() float64 {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return 0.0
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		return 0.0
	}
	fields := strings.Fields(scanner.Text())
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0.0
	}
	var total, idle uint64
	for i := 1; i < len(fields); i++ {
		val, _ := strconv.ParseUint(fields[i], 10, 64)
		total += val
		if i == 4 || i == 5 {
			idle += val
		}
	}
	cpuMu.Lock()
	defer cpuMu.Unlock()
	if lastTotalCP == 0 {
		lastTotalCP = total
		lastIdleCP = idle
		return 0.0
	}
	deltaTotal := total - lastTotalCP
	deltaIdle := idle - lastIdleCP
	lastTotalCP = total
	lastIdleCP = idle
	if deltaTotal == 0 {
		return 0.0
	}
	cpuUsage := 100.0 * (1.0 - float64(deltaIdle)/float64(deltaTotal))
	if cpuUsage < 0 {
		cpuUsage = 0
	}
	if cpuUsage > 100 {
		cpuUsage = 100
	}
	return cpuUsage
}

func readSystemUptime() int64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) > 0 {
		if sec, err := strconv.ParseFloat(fields[0], 64); err == nil {
			return int64(sec)
		}
	}
	return 0
}

type rawCodec struct{}

func (rawCodec) Marshal(v any) ([]byte, error) {
	if b, ok := v.([]byte); ok {
		return b, nil
	}
	return nil, fmt.Errorf("rawCodec: expected []byte, got %T", v)
}

func (rawCodec) Unmarshal(data []byte, v any) error {
	if b, ok := v.(*[]byte); ok {
		*b = make([]byte, len(data))
		copy(*b, data)
		return nil
	}
	return fmt.Errorf("rawCodec: expected *[]byte, got %T", v)
}

func (rawCodec) Name() string {
	return "proto"
}

func writeVarint(buf *bytes.Buffer, v uint64) {
	for v >= 0x80 {
		buf.WriteByte(byte(v) | 0x80)
		v >>= 7
	}
	buf.WriteByte(byte(v))
}

func readVarint(r *bytes.Reader) (uint64, error) {
	var v uint64
	var shift uint
	for {
		b, err := r.ReadByte()
		if err != nil {
			return 0, err
		}
		v |= uint64(b&0x7f) << shift
		if b < 0x80 {
			return v, nil
		}
		shift += 7
		if shift >= 64 {
			return 0, fmt.Errorf("varint overflow")
		}
	}
}

func skipField(r *bytes.Reader, wireType uint64) error {
	switch wireType {
	case 0:
		_, err := readVarint(r)
		return err
	case 1:
		_, err := r.Seek(8, io.SeekCurrent)
		return err
	case 2:
		length, err := readVarint(r)
		if err != nil {
			return err
		}
		_, err = r.Seek(int64(length), io.SeekCurrent)
		return err
	case 5:
		_, err := r.Seek(4, io.SeekCurrent)
		return err
	default:
		return fmt.Errorf("unknown wire type: %d", wireType)
	}
}

func encodeQueryStatsRequest(pattern string, reset bool) []byte {
	var buf bytes.Buffer
	if pattern != "" {
		buf.WriteByte(0x0a)
		writeVarint(&buf, uint64(len(pattern)))
		buf.WriteString(pattern)
	}
	if reset {
		buf.WriteByte(0x10)
		buf.WriteByte(0x01)
	}
	return buf.Bytes()
}

type statItem struct {
	Name  string
	Value int64
}

func decodeQueryStatsResponse(data []byte) ([]statItem, error) {
	var stats []statItem
	reader := bytes.NewReader(data)
	for reader.Len() > 0 {
		tag, err := readVarint(reader)
		if err != nil {
			break
		}
		fieldNum := tag >> 3
		wireType := tag & 0x7

		if fieldNum == 1 && wireType == 2 {
			length, err := readVarint(reader)
			if err != nil {
				break
			}
			statBytes := make([]byte, length)
			if _, err := io.ReadFull(reader, statBytes); err != nil {
				break
			}
			item, err := decodeStat(statBytes)
			if err == nil {
				stats = append(stats, item)
			}
		} else {
			if err := skipField(reader, wireType); err != nil {
				break
			}
		}
	}
	return stats, nil
}

func decodeStat(data []byte) (statItem, error) {
	var item statItem
	reader := bytes.NewReader(data)
	for reader.Len() > 0 {
		tag, err := readVarint(reader)
		if err != nil {
			break
		}
		fieldNum := tag >> 3
		wireType := tag & 0x7

		if fieldNum == 1 && wireType == 2 {
			length, err := readVarint(reader)
			if err != nil {
				break
			}
			nameBytes := make([]byte, length)
			if _, err := io.ReadFull(reader, nameBytes); err != nil {
				break
			}
			item.Name = string(nameBytes)
		} else if fieldNum == 2 && wireType == 0 {
			val, err := readVarint(reader)
			if err != nil {
				break
			}
			item.Value = int64(val)
		} else {
			if err := skipField(reader, wireType); err != nil {
				break
			}
		}
	}
	return item, nil
}

func queryTrafficDeltas() []TrafficDelta {
	conn, err := grpc.NewClient("127.0.0.1:8080",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Query user stats with reset=true to atomically fetch and reset delta counters
	reqBytes := encodeQueryStatsRequest("user>>>", true)
	var respBytes []byte

	err = conn.Invoke(ctx, "/v2ray.core.app.stats.command.StatsService/QueryStats", reqBytes, &respBytes, grpc.ForceCodec(rawCodec{}))
	if err != nil {
		return nil
	}

	stats, err := decodeQueryStatsResponse(respBytes)
	if err != nil {
		return nil
	}

	deltaMap := make(map[string]*TrafficDelta)
	for _, s := range stats {
		// Format: "user>>>zkyml>>>traffic>>>uplink"
		parts := strings.Split(s.Name, ">>>")
		if len(parts) >= 4 && parts[0] == "user" && parts[2] == "traffic" {
			uname := parts[1]
			dir := parts[3]
			d, exists := deltaMap[uname]
			if !exists {
				d = &TrafficDelta{Username: uname}
				deltaMap[uname] = d
			}
			if dir == "uplink" {
				d.Uplink += s.Value
			} else if dir == "downlink" {
				d.Downlink += s.Value
			}
		}
	}

	var result []TrafficDelta
	for _, d := range deltaMap {
		if d.Uplink > 0 || d.Downlink > 0 {
			result = append(result, *d)
		}
	}
	return result
}
