package providerprobe

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	probeTimeout   = 4 * time.Second
	pathTimeout    = 2 * time.Second
	maxProbeOutput = 64 * 1024
	pathSentinel   = "__LUMORA_PATH__"
)

var ErrExecutableNotFound = errors.New("executable not found")

type ToolResult struct {
	State          string  `json:"state"`
	ExecutablePath *string `json:"executablePath"`
	Version        *string `json:"version"`
}

type ProviderResult struct {
	Provider       string  `json:"provider"`
	State          string  `json:"state"`
	ExecutablePath *string `json:"executablePath"`
	Version        *string `json:"version"`
}

type Result struct {
	CheckedAt string           `json:"checkedAt"`
	Node      ToolResult       `json:"node"`
	NPM       ToolResult       `json:"npm"`
	Providers []ProviderResult `json:"providers"`
}

type Dependencies struct {
	SearchPaths    func(context.Context) []string
	FindExecutable func(string, []string) (string, error)
	ProbeVersion   func(context.Context, string, []string) (string, error)
	Now            func() time.Time
}

func DefaultDependencies() Dependencies {
	return Dependencies{
		SearchPaths:    defaultSearchPaths,
		FindExecutable: findExecutableInPaths,
		ProbeVersion:   probeVersion,
		Now:            time.Now,
	}
}

func LocateProvider(ctx context.Context, provider string, dependencies Dependencies) (string, error) {
	dependencies = withDefaults(dependencies)
	var command string
	for _, definition := range Registry {
		if definition.Provider == provider {
			command = definition.Command
			break
		}
	}
	if command == "" {
		return "", ErrExecutableNotFound
	}
	return dependencies.FindExecutable(command, dependencies.SearchPaths(ctx))
}

func Scan(ctx context.Context, enabled []string, dependencies Dependencies) Result {
	dependencies = withDefaults(dependencies)
	paths := dependencies.SearchPaths(ctx)
	checkedAt := dependencies.Now().UTC().Format(time.RFC3339Nano)
	result := Result{
		CheckedAt: checkedAt,
		Node:      scanTool(ctx, "node", []string{"--version"}, paths, dependencies),
		NPM:       scanTool(ctx, "npm", []string{"--version"}, paths, dependencies),
		Providers: []ProviderResult{},
	}

	selected := make(map[string]struct{}, len(enabled))
	for _, provider := range enabled {
		selected[provider] = struct{}{}
	}
	for _, definition := range Registry {
		if _, ok := selected[definition.Provider]; !ok {
			continue
		}
		tool := scanTool(
			ctx, definition.Command, definition.VersionArgs, paths, dependencies,
		)
		result.Providers = append(result.Providers, ProviderResult{
			Provider:       definition.Provider,
			State:          tool.State,
			ExecutablePath: tool.ExecutablePath,
			Version:        tool.Version,
		})
	}
	return result
}

func withDefaults(dependencies Dependencies) Dependencies {
	defaults := DefaultDependencies()
	if dependencies.SearchPaths == nil {
		dependencies.SearchPaths = defaults.SearchPaths
	}
	if dependencies.FindExecutable == nil {
		dependencies.FindExecutable = defaults.FindExecutable
	}
	if dependencies.ProbeVersion == nil {
		dependencies.ProbeVersion = defaults.ProbeVersion
	}
	if dependencies.Now == nil {
		dependencies.Now = defaults.Now
	}
	return dependencies
}

func scanTool(
	ctx context.Context,
	command string,
	args []string,
	paths []string,
	dependencies Dependencies,
) ToolResult {
	executable, err := dependencies.FindExecutable(command, paths)
	if err != nil || executable == "" {
		return ToolResult{State: "not_found"}
	}
	executable = filepath.Clean(executable)
	version, err := dependencies.ProbeVersion(ctx, executable, append([]string{}, args...))
	if err != nil || strings.TrimSpace(version) == "" {
		return ToolResult{State: "probe_failed", ExecutablePath: stringPointer(executable)}
	}
	return ToolResult{
		State:          "ready",
		ExecutablePath: stringPointer(executable),
		Version:        stringPointer(strings.TrimSpace(version)),
	}
}

func stringPointer(value string) *string {
	copy := value
	return &copy
}

func mergeSearchPaths(groups ...[]string) []string {
	result := []string{}
	seen := map[string]struct{}{}
	for _, group := range groups {
		for _, candidate := range group {
			clean := filepath.Clean(strings.TrimSpace(candidate))
			if clean == "." || clean == "" {
				continue
			}
			key := clean
			if runtime.GOOS == "windows" {
				key = strings.ToLower(clean)
			}
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			result = append(result, clean)
		}
	}
	return result
}

func defaultSearchPaths(ctx context.Context) []string {
	inherited := filepath.SplitList(os.Getenv("PATH"))
	login := loginShellPaths(ctx)
	known := knownUserPaths()
	paths := mergeSearchPaths(inherited, login, known)
	if npm, err := findExecutableInPaths("npm", paths); err == nil {
		if prefix, err := runBounded(ctx, npm, []string{"prefix", "-g"}, pathTimeout); err == nil {
			prefix = strings.TrimSpace(prefix)
			if prefix != "" {
				if runtime.GOOS != "windows" {
					prefix = filepath.Join(prefix, "bin")
				}
				paths = mergeSearchPaths(paths, []string{prefix})
			}
		}
	}
	return paths
}

func loginShellPaths(ctx context.Context) []string {
	if runtime.GOOS == "windows" {
		return nil
	}
	shell := strings.TrimSpace(os.Getenv("SHELL"))
	if shell == "" || !filepath.IsAbs(shell) {
		return nil
	}
	output, err := runBounded(ctx, shell, []string{
		"-lic", `printf '\n__LUMORA_PATH__%s\n' "$PATH"`,
	}, pathTimeout)
	if err != nil {
		return nil
	}
	index := strings.LastIndex(output, pathSentinel)
	if index < 0 {
		return nil
	}
	pathLine := strings.SplitN(output[index+len(pathSentinel):], "\n", 2)[0]
	return filepath.SplitList(strings.TrimSpace(pathLine))
}

func knownUserPaths() []string {
	home, _ := os.UserHomeDir()
	if home == "" {
		return nil
	}
	if runtime.GOOS == "windows" {
		paths := []string{
			filepath.Join(home, "AppData", "Roaming", "npm"),
			filepath.Join(home, ".local", "bin"),
		}
		if localAppData := strings.TrimSpace(os.Getenv("LOCALAPPDATA")); localAppData != "" {
			paths = append(paths, filepath.Join(localAppData, "Programs"))
		}
		return paths
	}
	return []string{
		filepath.Join(home, ".local", "bin"),
		filepath.Join(home, "bin"),
		"/usr/local/bin",
		"/opt/homebrew/bin",
	}
}

func findExecutableInPaths(command string, paths []string) (string, error) {
	if command == "" || strings.ContainsAny(command, `/\\\x00\r\n`) {
		return "", ErrExecutableNotFound
	}
	names := []string{command}
	if runtime.GOOS == "windows" {
		names = []string{command + ".exe", command + ".cmd", command + ".bat", command}
	}
	for _, directory := range paths {
		for _, name := range names {
			candidate := filepath.Join(directory, name)
			info, err := os.Stat(candidate)
			if err != nil || info.IsDir() {
				continue
			}
			if runtime.GOOS != "windows" && info.Mode().Perm()&0o111 == 0 {
				continue
			}
			absolute, err := filepath.Abs(candidate)
			if err == nil {
				return filepath.Clean(absolute), nil
			}
		}
	}
	return "", ErrExecutableNotFound
}

func probeVersion(ctx context.Context, executable string, args []string) (string, error) {
	return runBounded(ctx, executable, args, probeTimeout)
}

type boundedBuffer struct {
	mu       sync.Mutex
	buffer   bytes.Buffer
	overflow bool
}

func (buffer *boundedBuffer) Write(value []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	remaining := maxProbeOutput - buffer.buffer.Len()
	if remaining > 0 {
		written := len(value)
		if written > remaining {
			written = remaining
		}
		_, _ = buffer.buffer.Write(value[:written])
	}
	if len(value) > remaining {
		buffer.overflow = true
	}
	return len(value), nil
}

func runBounded(
	parent context.Context,
	executable string,
	args []string,
	timeout time.Duration,
) (string, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	commandPath, commandArgs := commandSpec(executable, args)
	command := exec.CommandContext(ctx, commandPath, commandArgs...)
	output := &boundedBuffer{}
	command.Stdout = output
	command.Stderr = output
	err := command.Run()
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	if err != nil {
		return "", err
	}
	output.mu.Lock()
	defer output.mu.Unlock()
	if output.overflow {
		return "", errors.New("probe output exceeded limit")
	}
	return strings.TrimSpace(output.buffer.String()), nil
}

func commandSpec(executable string, args []string) (string, []string) {
	extension := strings.ToLower(filepath.Ext(executable))
	if runtime.GOOS != "windows" || (extension != ".cmd" && extension != ".bat") {
		return executable, append([]string{}, args...)
	}
	const bridge = `& { $exe = $args[0]; $rest = @(); if ($args.Count -gt 1) { $rest = $args[1..($args.Count - 1)] }; & $exe @rest }`
	bridgeArgs := []string{
		"-NoLogo", "-NoProfile", "-NonInteractive", "-Command", bridge,
		executable,
	}
	return "powershell.exe", append(bridgeArgs, args...)
}
