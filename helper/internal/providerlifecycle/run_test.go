package providerlifecycle

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestRunUsesAllowlistedPackageAndStructuredArguments(t *testing.T) {
	fixed := time.Date(2026, 8, 11, 1, 2, 3, 0, time.UTC)
	var received Invocation
	result, err := Run(context.Background(), Request{
		Provider: "codex",
		Action:   ActionInstall,
	}, Dependencies{
		FindNPM: func(context.Context) (string, error) {
			return "/usr/bin/npm", nil
		},
		Execute: func(_ context.Context, invocation Invocation) error {
			received = invocation
			return nil
		},
		Now:      func() time.Time { return fixed },
		Platform: "linux",
	})
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if result.Provider != "codex" || result.Action != ActionInstall || result.CompletedAt != fixed.Format(time.RFC3339Nano) {
		t.Fatalf("Run() result = %#v", result)
	}
	if received.File != "/usr/bin/npm" {
		t.Fatalf("invocation file = %q", received.File)
	}
	wantArgs := []string{"install", "--global", "@openai/codex@latest"}
	if !reflect.DeepEqual(received.Args, wantArgs) {
		t.Fatalf("invocation args = %#v, want %#v", received.Args, wantArgs)
	}
}

func TestRunRejectsGuideOnlyAndInvalidRequestsBeforeExecution(t *testing.T) {
	for _, request := range []Request{
		{Provider: "antigravity", Action: ActionInstall},
		{Provider: "unknown", Action: ActionInstall},
		{Provider: "codex", Action: Action("remove")},
	} {
		executed := false
		_, err := Run(context.Background(), request, Dependencies{
			FindNPM:  func(context.Context) (string, error) { return "/usr/bin/npm", nil },
			Execute:  func(context.Context, Invocation) error { executed = true; return nil },
			Platform: "linux",
		})
		if err == nil {
			t.Fatalf("Run(%#v) error = nil", request)
		}
		if executed {
			t.Fatalf("Run(%#v) executed a command", request)
		}
	}
}

func TestRunReportsMissingNPMAndLifecycleFailureWithoutOutput(t *testing.T) {
	_, err := Run(context.Background(), Request{Provider: "codex", Action: ActionUpdate}, Dependencies{
		FindNPM:  func(context.Context) (string, error) { return "", errors.New("missing") },
		Platform: "linux",
	})
	assertLifecycleCode(t, err, CodePackageManagerUnavailable)

	_, err = Run(context.Background(), Request{Provider: "codex", Action: ActionUpdate}, Dependencies{
		FindNPM:  func(context.Context) (string, error) { return "/usr/bin/npm", nil },
		Execute:  func(context.Context, Invocation) error { return errors.New("private remote output") },
		Platform: "linux",
	})
	assertLifecycleCode(t, err, CodeLifecycleFailed)
	if err != nil && err.Error() == "private remote output" {
		t.Fatal("Run exposed command output")
	}
}

func TestBuildInvocationBridgesWindowsWrappersWithoutShellConcatenation(t *testing.T) {
	invocation, err := BuildInvocation("windows", `C:\\Users\\work\\AppData\\Roaming\\npm\\npm.cmd`, "@openai/codex")
	if err != nil {
		t.Fatalf("BuildInvocation() error = %v", err)
	}
	if invocation.File != "powershell.exe" {
		t.Fatalf("invocation file = %q", invocation.File)
	}
	if len(invocation.Args) < 8 || invocation.Args[5] != `C:\\Users\\work\\AppData\\Roaming\\npm\\npm.cmd` {
		t.Fatalf("invocation args = %#v", invocation.Args)
	}
	if got := invocation.Args[len(invocation.Args)-1]; got != "@openai/codex@latest" {
		t.Fatalf("package argument = %q", got)
	}
}

func TestBoundedBufferRejectsExcessOutput(t *testing.T) {
	buffer := newBoundedBuffer(4)
	if _, err := buffer.Write([]byte("12345")); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	if !buffer.Overflowed() {
		t.Fatal("buffer did not report overflow")
	}
}

func assertLifecycleCode(t *testing.T, err error, code ErrorCode) {
	t.Helper()
	var lifecycleError *Error
	if !errors.As(err, &lifecycleError) || lifecycleError.Code != code {
		t.Fatalf("error = %v, want lifecycle code %q", err, code)
	}
}
