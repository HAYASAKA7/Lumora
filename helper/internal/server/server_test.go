package server

import (
	"bytes"
	"context"
	"testing"

	"github.com/HAYASAKA7/lumora/helper/internal/protocol"
	"github.com/HAYASAKA7/lumora/helper/internal/providerprobe"
	"github.com/HAYASAKA7/lumora/helper/internal/systeminfo"
)

func request(operation string) protocol.Request {
	return protocol.Request{
		ProtocolVersion: protocol.Version,
		Kind:            "request",
		Generation:      9,
		RequestID:       "request-9",
		Operation:       operation,
		Payload:         map[string]any{},
	}
}

func TestServeDiscoveryScanValidatesProvidersBeforeScanning(t *testing.T) {
	discovery := request("discovery-scan")
	discovery.Payload = map[string]any{
		"enabledProviders": []any{"codex", "opencode"},
	}
	var input bytes.Buffer
	if err := protocol.WriteFrame(&input, discovery); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	calls := 0
	if err := Serve(&input, &output, Dependencies{
		HelperVersion: "0.2.0",
		Discover: func(_ context.Context, providers []string) providerprobe.Result {
			calls++
			if len(providers) != 2 || providers[0] != "codex" || providers[1] != "opencode" {
				t.Fatalf("unexpected providers: %#v", providers)
			}
			return providerprobe.Result{
				CheckedAt: "2026-08-05T04:03:02Z",
				Node:      providerprobe.ToolResult{State: "not_found"},
				NPM:       providerprobe.ToolResult{State: "not_found"},
				Providers: []providerprobe.ProviderResult{},
			}
		},
	}); err != nil {
		t.Fatal(err)
	}
	var response protocol.Response
	if err := protocol.ReadFrame(&output, &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.Operation != "discovery-scan" || calls != 1 {
		t.Fatalf("unexpected discovery response: %#v calls=%d", response, calls)
	}

	invalid := request("discovery-scan")
	invalid.Payload = map[string]any{"enabledProviders": []any{"codex", "codex"}}
	input.Reset()
	output.Reset()
	if err := protocol.WriteFrame(&input, invalid); err != nil {
		t.Fatal(err)
	}
	if err := Serve(&input, &output, Dependencies{
		Discover: func(context.Context, []string) providerprobe.Result {
			calls++
			return providerprobe.Result{}
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := protocol.ReadFrame(&output, &response); err != nil {
		t.Fatal(err)
	}
	if response.OK || response.Error == nil || response.Error.Code != "INVALID_REQUEST" || calls != 1 {
		t.Fatalf("invalid discovery was not rejected: %#v calls=%d", response, calls)
	}
}

func TestServeHandshakeAndShutdown(t *testing.T) {
	var input bytes.Buffer
	if err := protocol.WriteFrame(&input, request("handshake")); err != nil {
		t.Fatal(err)
	}
	shutdown := request("shutdown")
	shutdown.RequestID = "request-10"
	if err := protocol.WriteFrame(&input, shutdown); err != nil {
		t.Fatal(err)
	}

	var output bytes.Buffer
	err := Serve(&input, &output, Dependencies{
		HelperVersion: "0.1.0",
		SystemInfo: func(helperVersion string) (systeminfo.Info, error) {
			return systeminfo.Info{
				HelperVersion:   helperVersion,
				ProtocolVersion: protocol.Version,
				Platform:        "linux", Architecture: "x64",
				HomeDirectory: "/home/lumora", DefaultShell: "/bin/bash",
				Capabilities: []string{"system-info"},
			}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	var handshake protocol.Response
	if err := protocol.ReadFrame(&output, &handshake); err != nil {
		t.Fatal(err)
	}
	if !handshake.OK || handshake.Operation != "handshake" || handshake.RequestID != "request-9" {
		t.Fatalf("unexpected handshake: %#v", handshake)
	}
	var stopped protocol.Response
	if err := protocol.ReadFrame(&output, &stopped); err != nil {
		t.Fatal(err)
	}
	if !stopped.OK || stopped.Operation != "shutdown" {
		t.Fatalf("unexpected shutdown: %#v", stopped)
	}
}

func TestServeRejectsUnknownOperationWithoutExecutingIt(t *testing.T) {
	var input bytes.Buffer
	if err := protocol.WriteFrame(&input, request("exec")); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	if err := Serve(&input, &output, Dependencies{HelperVersion: "0.1.0"}); err != nil {
		t.Fatal(err)
	}
	var response protocol.Response
	if err := protocol.ReadFrame(&output, &response); err != nil {
		t.Fatal(err)
	}
	if response.OK || response.Error == nil || response.Error.Code != "UNSUPPORTED_OPERATION" {
		t.Fatalf("unexpected error response: %#v", response)
	}
}
