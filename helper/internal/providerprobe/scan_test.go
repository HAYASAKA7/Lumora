package providerprobe

import (
	"context"
	"errors"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"
)

func TestScanFiltersProvidersAndIsolatesProbeFailures(t *testing.T) {
	paths := []string{filepath.Clean("/opt/lumora/bin"), filepath.Clean("/usr/bin")}
	findCalls := []string{}
	probeCalls := []string{}
	result := Scan(context.Background(), []string{"codex", "opencode"}, Dependencies{
		SearchPaths: func(context.Context) []string { return paths },
		FindExecutable: func(command string, received []string) (string, error) {
			if !reflect.DeepEqual(received, paths) {
				t.Fatalf("unexpected search paths: %#v", received)
			}
			findCalls = append(findCalls, command)
			if command == "opencode" {
				return filepath.Join(paths[0], "opencode"), nil
			}
			if command == "codex" {
				return filepath.Join(paths[0], "codex"), nil
			}
			return "", ErrExecutableNotFound
		},
		ProbeVersion: func(_ context.Context, executable string, args []string) (string, error) {
			probeCalls = append(probeCalls, executable+" "+args[0])
			if filepath.Base(executable) == "opencode" {
				return "", errors.New("probe failed")
			}
			return "codex-cli 1.2.3", nil
		},
		Now: func() time.Time { return time.Date(2026, 8, 5, 4, 3, 2, 0, time.UTC) },
	})

	if result.CheckedAt != "2026-08-05T04:03:02Z" {
		t.Fatalf("unexpected scan time: %s", result.CheckedAt)
	}
	if result.Node.State != "not_found" || result.NPM.State != "not_found" {
		t.Fatalf("unexpected environment: %#v %#v", result.Node, result.NPM)
	}
	if len(result.Providers) != 2 {
		t.Fatalf("unexpected provider count: %d", len(result.Providers))
	}
	if result.Providers[0].Provider != "codex" || result.Providers[0].State != "ready" {
		t.Fatalf("unexpected codex result: %#v", result.Providers[0])
	}
	if result.Providers[1].Provider != "opencode" || result.Providers[1].State != "probe_failed" {
		t.Fatalf("unexpected opencode result: %#v", result.Providers[1])
	}
	if !reflect.DeepEqual(findCalls, []string{"node", "npm", "codex", "opencode"}) {
		t.Fatalf("unexpected lookup calls: %#v", findCalls)
	}
	if !reflect.DeepEqual(probeCalls, []string{
		filepath.Join(paths[0], "codex") + " --version",
		filepath.Join(paths[0], "opencode") + " --version",
	}) {
		t.Fatalf("unexpected version calls: %#v", probeCalls)
	}
}

func TestScanKeepsReadyNodeAndFailedNPMProbe(t *testing.T) {
	result := Scan(context.Background(), nil, Dependencies{
		SearchPaths: func(context.Context) []string { return []string{filepath.Clean("/tools")} },
		FindExecutable: func(command string, _ []string) (string, error) {
			if command == "node" || command == "npm" {
				return filepath.Join(filepath.Clean("/tools"), command), nil
			}
			return "", ErrExecutableNotFound
		},
		ProbeVersion: func(_ context.Context, executable string, _ []string) (string, error) {
			if filepath.Base(executable) == "npm" {
				return "", errors.New("npm failed")
			}
			return "v24.0.0", nil
		},
	})

	if result.Node.State != "ready" || value(result.Node.Version) != "v24.0.0" {
		t.Fatalf("unexpected node result: %#v", result.Node)
	}
	if result.NPM.State != "probe_failed" ||
		value(result.NPM.ExecutablePath) != filepath.Join(filepath.Clean("/tools"), "npm") {
		t.Fatalf("unexpected npm result: %#v", result.NPM)
	}
	if len(result.Providers) != 0 {
		t.Fatalf("unexpected providers: %#v", result.Providers)
	}
}

func TestMergeSearchPathsNormalizesAndDeduplicates(t *testing.T) {
	merged := mergeSearchPaths(
		[]string{" /usr/bin ", "/opt/bin", ""},
		[]string{"/usr/bin", "/home/lumora/.local/bin"},
	)
	want := []string{
		filepath.Clean("/usr/bin"),
		filepath.Clean("/opt/bin"),
		filepath.Clean("/home/lumora/.local/bin"),
	}
	if !reflect.DeepEqual(merged, want) {
		t.Fatalf("unexpected paths: %#v", merged)
	}
}

func TestCommandSpecUsesFixedPowerShellBridgeForWindowsWrappers(t *testing.T) {
	executable := filepath.Join("C:\\Users\\lumora", "AppData", "Roaming", "npm", "codex.cmd")
	command, args := commandSpec(executable, []string{"--version"})
	if runtime.GOOS == "windows" {
		if command != "powershell.exe" {
			t.Fatalf("unexpected wrapper command: %s", command)
		}
		if args[len(args)-2] != executable || args[len(args)-1] != "--version" {
			t.Fatalf("wrapper arguments were not passed literally: %#v", args)
		}
		return
	}
	if command != executable || !reflect.DeepEqual(args, []string{"--version"}) {
		t.Fatalf("unexpected native command: %s %#v", command, args)
	}
}

func value(input *string) string {
	if input == nil {
		return ""
	}
	return *input
}
