package main

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractEmbeddedSingBox_Stub(t *testing.T) {
	tempDir := t.TempDir()
	// Default embeddedSingBoxGz is 20 bytes stub (< 1024), should no-op
	if err := extractEmbeddedSingBox(tempDir); err != nil {
		t.Fatalf("expected nil for stub payload, got: %v", err)
	}
	destBin := filepath.Join(tempDir, "bin", "sing-box")
	if _, err := os.Stat(destBin); err == nil {
		t.Fatalf("expected binary not to be extracted for stub payload")
	}
}

func TestExtractEmbeddedSingBox_DecompressAndHash(t *testing.T) {
	tempDir := t.TempDir()

	// Create fake payload > 1024 bytes
	content := bytes.Repeat([]byte("#!/bin/sh\necho sing-box mock\n"), 100)
	var gzBuf bytes.Buffer
	gw := gzip.NewWriter(&gzBuf)
	if _, err := gw.Write(content); err != nil {
		t.Fatalf("failed to gzip: %v", err)
	}
	_ = gw.Close()

	orig := embeddedSingBoxGz
	embeddedSingBoxGz = gzBuf.Bytes()
	defer func() { embeddedSingBoxGz = orig }()

	// First extraction
	if err := extractEmbeddedSingBox(tempDir); err != nil {
		t.Fatalf("extract failed: %v", err)
	}

	destBin := filepath.Join(tempDir, "bin", "sing-box")
	data, err := os.ReadFile(destBin)
	if err != nil {
		t.Fatalf("failed to read extracted bin: %v", err)
	}
	if !bytes.Equal(data, content) {
		t.Fatalf("extracted data does not match original content")
	}

	// Verify permissions
	fi, err := os.Stat(destBin)
	if err != nil || fi.Mode().Perm()&0111 == 0 {
		t.Fatalf("extracted binary should be executable")
	}

	// Second extraction should hit cache and succeed without error
	if err := extractEmbeddedSingBox(tempDir); err != nil {
		t.Fatalf("cached extract failed: %v", err)
	}
}
