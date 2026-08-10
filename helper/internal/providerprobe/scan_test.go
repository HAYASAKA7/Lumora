package providerprobe

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
	"time"
)

func TestFindExecutableInPathsAcceptsSafeCommandNames(t *testing.T) {
	directory := t.TempDir()
	for _, command := range []string{"node", "npm", "codex", "cursor-agent"} {
		filename := command
		if runtime.GOOS == "windows" {
			filename += ".exe"
		}
		candidate := filepath.Join(directory, filename)
		if err := os.WriteFile(candidate, []byte("executable"), 0o755); err != nil {
			t.Fatalf("create %s fixture: %v", command, err)
		}

		found, err := findExecutableInPaths(command, []string{directory})
		if err != nil {
			t.Fatalf("safe command %q was rejected: %v", command, err)
		}
		want, err := filepath.Abs(candidate)
		if err != nil {
			t.Fatalf("resolve %s fixture: %v", command, err)
		}
		if found != filepath.Clean(want) {
			t.Fatalf("unexpected %s path: %q", command, found)
		}
	}
}

func TestFindExecutableInPathsRejectsPathsAndControlCharacters(t *testing.T) {
	for _, command := range []string{"sub/node", `sub\node`, "node\x00evil", "node\revil", "node\nevil"} {
		if _, err := findExecutableInPaths(command, []string{t.TempDir()}); !errors.Is(err, ErrExecutableNotFound) {
			t.Fatalf("unsafe command %q was accepted: %v", command, err)
		}
	}
}

func TestConfiguredLoginShellPrefersLumoraLaunchHint(t *testing.T) {
	t.Setenv("SHELL", "/bin/inherited")
	t.Setenv("LUMORA_LOGIN_SHELL", "/bin/remote-login")

	if got := configuredLoginShell(); got != "/bin/remote-login" {
		t.Fatalf("unexpected login shell: %q", got)
	}

	t.Setenv("LUMORA_LOGIN_SHELL", "")
	if got := configuredLoginShell(); got != "/bin/inherited" {
		t.Fatalf("unexpected inherited login shell: %q", got)
	}
}

func TestShellPathProbesMirrorNativeShellStartupModes(t *testing.T) {
	bash := shellPathProbes("linux", "/bin/bash")
	if len(bash) != 2 || !reflect.DeepEqual(bash[0].Args[:1], []string{"-ic"}) ||
		!reflect.DeepEqual(bash[1].Args[:1], []string{"-lc"}) {
		t.Fatalf("unexpected bash probes: %#v", bash)
	}

	zsh := shellPathProbes("darwin", "/bin/zsh")
	if len(zsh) != 1 || !reflect.DeepEqual(zsh[0].Args[:1], []string{"-ilc"}) {
		t.Fatalf("unexpected zsh probes: %#v", zsh)
	}

	windows := shellPathProbes("windows", "powershell.exe")
	if len(windows) != 2 || windows[0].Executable != "powershell.exe" ||
		windows[1].Executable != "pwsh.exe" {
		t.Fatalf("unexpected Windows probes: %#v", windows)
	}
}

func TestCollectShellPathsPrefersInteractiveAndAcceptsStartupNoise(t *testing.T) {
	probes := shellPathProbes("linux", "/bin/bash")
	paths := collectShellPaths(
		context.Background(),
		probes,
		":",
		func(_ context.Context, _ string, args []string, _ time.Duration) (string, error) {
			if args[0] == "-ic" {
				return "profile noise\n" + pathSentinel + "/home/user/.nvm/current/bin:/usr/bin\n", nil
			}
			return pathSentinel + "/home/user/bin:/usr/local/bin:/usr/bin\n", nil
		},
	)
	want := []string{
		filepath.Clean("/home/user/.nvm/current/bin"),
		filepath.Clean("/usr/bin"),
		filepath.Clean("/home/user/bin"),
		filepath.Clean("/usr/local/bin"),
	}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("unexpected recovered paths: %#v", paths)
	}
}

func TestCollectShellPathsParsesWindowsPathListsPortably(t *testing.T) {
	paths := collectShellPaths(
		context.Background(),
		[]shellPathProbe{{Executable: "powershell.exe", Args: []string{"-Command", "probe"}}},
		";",
		func(context.Context, string, []string, time.Duration) (string, error) {
			return pathSentinel + `C:\Users\builder\AppData\Local\fnm;C:\Program Files\nodejs` + "\n", nil
		},
	)
	want := []string{
		`C:\Users\builder\AppData\Local\fnm`,
		`C:\Program Files\nodejs`,
	}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("unexpected Windows paths: %#v", paths)
	}
}

func TestKnownSearchPathsIncludeStandardLinuxExecutableDirectories(t *testing.T) {
	paths := knownSearchPaths("linux", "/home/work", "")
	want := []string{
		filepath.Clean("/home/work/.local/bin"),
		filepath.Clean("/home/work/bin"),
		filepath.Clean("/usr/local/bin"),
		filepath.Clean("/usr/bin"),
		filepath.Clean("/bin"),
	}
	if !reflect.DeepEqual(paths, want) {
		t.Fatalf("unexpected Linux fallback paths: %#v", paths)
	}
}

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

func TestLocateProviderUsesCanonicalRegistryAndSearchPaths(t *testing.T) {
	paths := []string{filepath.Clean("/tools")}
	path, err := LocateProvider(context.Background(), "opencode", Dependencies{
		SearchPaths: func(context.Context) []string { return paths },
		FindExecutable: func(command string, received []string) (string, error) {
			if command != "opencode" || !reflect.DeepEqual(received, paths) {
				t.Fatalf("unexpected lookup: %s %#v", command, received)
			}
			return filepath.Join(paths[0], command), nil
		},
	})
	if err != nil || path != filepath.Join(paths[0], "opencode") {
		t.Fatalf("unexpected location: %q %v", path, err)
	}
	if _, err := LocateProvider(context.Background(), "unknown", Dependencies{}); !errors.Is(err, ErrExecutableNotFound) {
		t.Fatalf("unknown provider was not rejected: %v", err)
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
