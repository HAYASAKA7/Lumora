package server

import (
	"bytes"
	"context"
	"testing"

	"github.com/HAYASAKA7/lumora/helper/internal/protocol"
	"github.com/HAYASAKA7/lumora/helper/internal/providerlifecycle"
	"github.com/HAYASAKA7/lumora/helper/internal/providerprobe"
	"github.com/HAYASAKA7/lumora/helper/internal/sessioncatalog"
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

func TestServeProviderLifecycleValidatesIntentBeforeExecution(t *testing.T) {
	lifecycle := request("provider-lifecycle")
	lifecycle.Payload = map[string]any{"provider": "codex", "action": "install"}
	var input bytes.Buffer
	if err := protocol.WriteFrame(&input, lifecycle); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	calls := 0
	if err := Serve(&input, &output, Dependencies{
		ProviderLifecycle: func(_ context.Context, request providerlifecycle.Request) (providerlifecycle.Result, error) {
			calls++
			if request.Provider != "codex" || request.Action != providerlifecycle.ActionInstall {
				t.Fatalf("unexpected lifecycle request: %#v", request)
			}
			return providerlifecycle.Result{
				Provider: "codex", Action: providerlifecycle.ActionInstall,
				CompletedAt: "2026-08-11T01:02:03Z",
			}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	var response protocol.Response
	if err := protocol.ReadFrame(&output, &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.Operation != "provider-lifecycle" || calls != 1 {
		t.Fatalf("unexpected lifecycle response: %#v calls=%d", response, calls)
	}

	for _, payload := range []map[string]any{
		{"provider": "unknown", "action": "install"},
		{"provider": "codex", "action": "remove"},
		{"provider": "codex", "action": "install", "command": "sudo npm install"},
	} {
		input.Reset()
		output.Reset()
		invalid := request("provider-lifecycle")
		invalid.Payload = payload
		if err := protocol.WriteFrame(&input, invalid); err != nil {
			t.Fatal(err)
		}
		if err := Serve(&input, &output, Dependencies{
			ProviderLifecycle: func(context.Context, providerlifecycle.Request) (providerlifecycle.Result, error) {
				calls++
				return providerlifecycle.Result{}, nil
			},
		}); err != nil {
			t.Fatal(err)
		}
		if err := protocol.ReadFrame(&output, &response); err != nil {
			t.Fatal(err)
		}
		if response.OK || response.Error == nil || response.Error.Code != "INVALID_REQUEST" || calls != 1 {
			t.Fatalf("invalid lifecycle was not rejected: %#v calls=%d", response, calls)
		}
	}
}

func TestServeSessionScanValidatesPaginationBeforeScanning(t *testing.T) {
	scan := request("session-scan")
	scan.Payload = map[string]any{
		"provider": "codex",
		"cursor":   nil,
		"limit":    float64(50),
	}
	var input bytes.Buffer
	if err := protocol.WriteFrame(&input, scan); err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	calls := 0
	if err := Serve(&input, &output, Dependencies{
		SessionScan: func(_ context.Context, query sessioncatalog.Query) sessioncatalog.Result {
			calls++
			if query.Provider != "codex" || query.Cursor != 0 || query.Limit != 50 {
				t.Fatalf("unexpected session query: %#v", query)
			}
			return sessioncatalog.Result{
				Provider: "codex", ScannedAt: "2026-08-09T04:03:02Z",
				Status: "ready", Sessions: []sessioncatalog.Session{}, InvalidCount: 0,
			}
		},
	}); err != nil {
		t.Fatal(err)
	}
	var response protocol.Response
	if err := protocol.ReadFrame(&output, &response); err != nil {
		t.Fatal(err)
	}
	if !response.OK || response.Operation != "session-scan" || calls != 1 {
		t.Fatalf("unexpected session response: %#v calls=%d", response, calls)
	}

	invalid := request("session-scan")
	invalid.Payload = map[string]any{
		"provider": "aider", "cursor": nil, "limit": float64(50),
	}
	input.Reset()
	output.Reset()
	if err := protocol.WriteFrame(&input, invalid); err != nil {
		t.Fatal(err)
	}
	if err := Serve(&input, &output, Dependencies{
		SessionScan: func(context.Context, sessioncatalog.Query) sessioncatalog.Result {
			calls++
			return sessioncatalog.Result{}
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := protocol.ReadFrame(&output, &response); err != nil {
		t.Fatal(err)
	}
	if response.OK || response.Error == nil || response.Error.Code != "INVALID_REQUEST" || calls != 1 {
		t.Fatalf("invalid session scan was not rejected: %#v calls=%d", response, calls)
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
