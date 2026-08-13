package providerlifecycle

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/HAYASAKA7/lumora/helper/internal/providerprobe"
)

const (
	lifecycleTimeout = 10 * time.Minute
	maxOutputBytes   = 64 * 1024
)

var windowsAbsolutePath = regexp.MustCompile(`^(?:[A-Za-z]:[\\/]|\\\\)`)

type Action string

const (
	ActionInstall Action = "install"
	ActionUpdate  Action = "update"
)

type ErrorCode string

const (
	CodeInvalidRequest            ErrorCode = "INVALID_REQUEST"
	CodeGuideRequired             ErrorCode = "PROVIDER_INSTALL_GUIDE_REQUIRED"
	CodePackageManagerUnavailable ErrorCode = "PROVIDER_PACKAGE_MANAGER_UNAVAILABLE"
	CodeLifecycleFailed           ErrorCode = "PROVIDER_LIFECYCLE_FAILED"
	CodeLifecycleTimeout          ErrorCode = "PROVIDER_LIFECYCLE_TIMEOUT"
)

type Error struct {
	Code ErrorCode
}

func (err *Error) Error() string {
	return "provider lifecycle operation failed"
}

type Request struct {
	Provider string
	Action   Action
}

type Result struct {
	Provider    string `json:"provider"`
	Action      Action `json:"action"`
	CompletedAt string `json:"completedAt"`
}

type Invocation struct {
	File string
	Args []string
}

type Dependencies struct {
	FindNPM          func(context.Context) (string, error)
	FindNode         func(context.Context) (string, error)
	ProbeNodeVersion func(context.Context, string) (string, error)
	Execute          func(context.Context, Invocation) error
	Now              func() time.Time
	Platform         string
}

func semanticVersionAtLeast(output string, minimum [3]int) bool {
	match := regexp.MustCompile(`(^|[^0-9])([0-9]+)\.([0-9]+)\.([0-9]+)([^0-9]|$)`).FindStringSubmatch(output)
	if len(match) != 6 {
		return false
	}
	for index := 0; index < 3; index++ {
		value := 0
		for _, digit := range match[index+2] {
			value = value*10 + int(digit-'0')
		}
		if value != minimum[index] {
			return value > minimum[index]
		}
	}
	return true
}

func providerPackage(provider string) (string, bool) {
	for _, definition := range providerprobe.Registry {
		if definition.Provider == provider {
			return definition.NPMPackage, true
		}
	}
	return "", false
}

func absolutePath(platform string, candidate string) bool {
	if platform == "windows" {
		return windowsAbsolutePath.MatchString(candidate)
	}
	return path.IsAbs(candidate)
}

func BuildInvocation(platform string, npmPath string, npmPackage string) (Invocation, error) {
	if !absolutePath(platform, npmPath) || npmPackage == "" ||
		!regexp.MustCompile(`^(@[a-z0-9-]+/)?[a-z0-9-]+$`).MatchString(npmPackage) {
		return Invocation{}, &Error{Code: CodeInvalidRequest}
	}
	args := []string{"install", "--global", npmPackage + "@latest"}
	if platform != "windows" ||
		(!strings.HasSuffix(strings.ToLower(npmPath), ".cmd") &&
			!strings.HasSuffix(strings.ToLower(npmPath), ".bat")) {
		return Invocation{File: npmPath, Args: args}, nil
	}
	const bridge = `& { $exe = $args[0]; $rest = @(); if ($args.Count -gt 1) { $rest = $args[1..($args.Count - 1)] }; & $exe @rest }`
	return Invocation{
		File: "powershell.exe",
		Args: append([]string{
			"-NoLogo", "-NoProfile", "-NonInteractive", "-Command", bridge, npmPath,
		}, args...),
	}, nil
}

type boundedBuffer struct {
	mu       sync.Mutex
	buffer   bytes.Buffer
	limit    int
	overflow bool
}

func newBoundedBuffer(limit int) *boundedBuffer {
	return &boundedBuffer{limit: limit}
}

func (buffer *boundedBuffer) Write(value []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	remaining := buffer.limit - buffer.buffer.Len()
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

func (buffer *boundedBuffer) Overflowed() bool {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	return buffer.overflow
}

func environmentWithNPMDirectory(npmPath string) []string {
	environment := os.Environ()
	directory := filepath.Dir(npmPath)
	for index, variable := range environment {
		key, value, found := strings.Cut(variable, "=")
		if !found || (runtime.GOOS == "windows" && !strings.EqualFold(key, "PATH")) ||
			(runtime.GOOS != "windows" && key != "PATH") {
			continue
		}
		environment[index] = key + "=" + directory + string(os.PathListSeparator) + value
		return environment
	}
	return append(environment, "PATH="+directory)
}

func execute(ctx context.Context, npmPath string, invocation Invocation) error {
	command := exec.CommandContext(ctx, invocation.File, invocation.Args...)
	command.Env = environmentWithNPMDirectory(npmPath)
	output := newBoundedBuffer(maxOutputBytes)
	command.Stdout = output
	command.Stderr = output
	if err := command.Run(); err != nil {
		return err
	}
	if output.Overflowed() {
		return errors.New("provider lifecycle output exceeded limit")
	}
	return nil
}

func Run(parent context.Context, request Request, dependencies Dependencies) (Result, error) {
	if request.Action != ActionInstall && request.Action != ActionUpdate {
		return Result{}, &Error{Code: CodeInvalidRequest}
	}
	npmPackage, known := providerPackage(request.Provider)
	if !known {
		return Result{}, &Error{Code: CodeInvalidRequest}
	}
	if npmPackage == "" {
		return Result{}, &Error{Code: CodeGuideRequired}
	}
	if request.Provider == "kimi" && request.Action == ActionUpdate {
		return Result{}, &Error{Code: CodeGuideRequired}
	}
	if request.Provider == "kimi" {
		findNode := dependencies.FindNode
		if findNode == nil {
			findNode = func(ctx context.Context) (string, error) {
				return providerprobe.LocateTool(ctx, "node", providerprobe.DefaultDependencies())
			}
		}
		nodePath, err := findNode(parent)
		if err != nil || nodePath == "" {
			return Result{}, &Error{Code: CodePackageManagerUnavailable}
		}
		probeNodeVersion := dependencies.ProbeNodeVersion
		if probeNodeVersion == nil {
			probeNodeVersion = func(ctx context.Context, executable string) (string, error) {
				return providerprobe.DefaultDependencies().ProbeVersion(ctx, executable, []string{"--version"})
			}
		}
		version, err := probeNodeVersion(parent, nodePath)
		if err != nil || !semanticVersionAtLeast(version, [3]int{22, 19, 0}) {
			return Result{}, &Error{Code: CodePackageManagerUnavailable}
		}
	}
	findNPM := dependencies.FindNPM
	if findNPM == nil {
		findNPM = func(ctx context.Context) (string, error) {
			return providerprobe.LocateTool(ctx, "npm", providerprobe.DefaultDependencies())
		}
	}
	npmPath, err := findNPM(parent)
	if err != nil || npmPath == "" {
		return Result{}, &Error{Code: CodePackageManagerUnavailable}
	}
	platform := dependencies.Platform
	if platform == "" {
		platform = runtime.GOOS
	}
	invocation, err := BuildInvocation(platform, npmPath, npmPackage)
	if err != nil {
		return Result{}, err
	}
	ctx, cancel := context.WithTimeout(parent, lifecycleTimeout)
	defer cancel()
	run := dependencies.Execute
	if run == nil {
		run = func(ctx context.Context, invocation Invocation) error {
			return execute(ctx, npmPath, invocation)
		}
	}
	if err := run(ctx, invocation); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return Result{}, &Error{Code: CodeLifecycleTimeout}
		}
		return Result{}, &Error{Code: CodeLifecycleFailed}
	}
	now := dependencies.Now
	if now == nil {
		now = time.Now
	}
	return Result{
		Provider:    request.Provider,
		Action:      request.Action,
		CompletedAt: now().UTC().Format(time.RFC3339Nano),
	}, nil
}
