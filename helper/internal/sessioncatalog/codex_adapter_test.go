package sessioncatalog

import (
	"context"
	"path/filepath"
	"testing"
)

func TestCodexAdapterNormalizesThreadsAndInspectsBoundedUsage(t *testing.T) {
	rollout := filepath.Join(t.TempDir(), "rollout.jsonl")
	writeFixture(t, rollout,
		`{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20}}}}`+"\n")
	dependencies := withDefaults(Dependencies{
		ListCodexThreads: func(context.Context, string) ([]CodexThread, int, error) {
			return []CodexThread{
				{ID: "codex-1", CWD: "/work/lumora", CreatedAt: 1_720_000_000, UpdatedAt: 1_720_000_100, Name: "Remote Codex", Path: rollout},
				{ID: "private", CWD: "/work/private", CreatedAt: 1_720_000_000, UpdatedAt: 1_720_000_100, Ephemeral: true},
			}, 0, nil
		},
	})
	sessions, invalid, err := scanCodex(context.Background(), "/usr/bin/codex", dependencies)
	if err != nil || invalid != 0 || len(sessions) != 1 {
		t.Fatalf("unexpected Codex scan: sessions=%#v invalid=%d err=%v", sessions, invalid, err)
	}
	if sessions[0].NativeID != "codex-1" || sessions[0].Title != "Remote Codex" || sessions[0].LifetimeTokens == nil || *sessions[0].LifetimeTokens != 80 {
		t.Fatalf("unexpected Codex session: %#v", sessions[0])
	}
}

func TestDefaultRegistryContainsEveryRemoteSessionProvider(t *testing.T) {
	dependencies := defaultDependencies()
	for _, provider := range []string{"codex", "claude", "gemini", "opencode", "copilot", "qwen"} {
		if dependencies.ProviderScanners[provider] == nil {
			t.Fatalf("remote session provider %q is missing from the registry", provider)
		}
	}
}
