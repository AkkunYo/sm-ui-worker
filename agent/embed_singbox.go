package main

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
)

//go:embed sing-box.gz
var embeddedSingBoxGz []byte

// extractEmbeddedSingBox checks if embedded sing-box is present and extracts it
// to <baseDir>/bin/sing-box if not present or hash mismatch.
func extractEmbeddedSingBox(baseDir string) error {
	// If embedded slice is empty or dummy stub (< 64 bytes), skip
	if len(embeddedSingBoxGz) < 64 {
		return nil
	}

	binDir := filepath.Join(baseDir, "bin")
	if err := os.MkdirAll(binDir, 0755); err != nil {
		return fmt.Errorf("failed to create bin dir: %w", err)
	}

	destBin := filepath.Join(binDir, "sing-box")
	hashFile := filepath.Join(binDir, ".sing-box.sha256")

	// Calculate SHA-256 of the embedded gzip payload
	h := sha256.Sum256(embeddedSingBoxGz)
	currentHash := hex.EncodeToString(h[:])

	// If destBin exists and hash matches recorded hash, nothing to do
	if _, err := os.Stat(destBin); err == nil {
		if storedHash, err := os.ReadFile(hashFile); err == nil {
			if string(bytes.TrimSpace(storedHash)) == currentHash {
				return nil
			}
		}
	}

	log.Printf("[embed] Extracting embedded sing-box core (payload sha256: %s)...", currentHash[:12])
	gzReader, err := gzip.NewReader(bytes.NewReader(embeddedSingBoxGz))
	if err != nil {
		return fmt.Errorf("invalid gzip data in embedded sing-box: %w", err)
	}
	defer gzReader.Close()

	tmpBin := filepath.Join(binDir, fmt.Sprintf(".sing-box.%d.tmp", os.Getpid()))
	f, err := os.OpenFile(tmpBin, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return fmt.Errorf("failed to create temp bin file: %w", err)
	}

	if _, err := io.Copy(f, gzReader); err != nil {
		f.Close()
		_ = os.Remove(tmpBin)
		return fmt.Errorf("failed to decompress embedded sing-box: %w", err)
	}
	f.Close()

	// Remove existing symlink or binary before rename
	_ = os.Remove(destBin)
	if err := os.Rename(tmpBin, destBin); err != nil {
		_ = os.Remove(tmpBin)
		return fmt.Errorf("failed to move extracted sing-box into place: %w", err)
	}
	_ = os.Chmod(destBin, 0755)

	if err := os.WriteFile(hashFile, []byte(currentHash+"\n"), 0644); err != nil {
		log.Printf("[embed] Warning: failed to write hash file: %v", err)
	}

	log.Printf("[embed] Successfully extracted sing-box core to %s", destBin)
	return nil
}
