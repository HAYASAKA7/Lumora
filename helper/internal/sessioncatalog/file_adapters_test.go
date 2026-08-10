package sessioncatalog

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func writeFixture(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func fileAdapterDependencies(home string, environment map[string]string) Dependencies {
	return withDefaults(Dependencies{
		HomeDirectory: func() (string, error) { return home, nil },
		Getenv:        func(key string) string { return environment[key] },
	})
}

func TestClaudeFileAdapterDiscoversMetadataAndTokens(t *testing.T) {
	home := t.TempDir()
	writeFixture(t, filepath.Join(home, ".claude", "projects", "project", "session.jsonl"),
		`{"sessionId":"claude-1","cwd":"/work/lumora","timestamp":"2026-08-09T01:00:00Z"}`+"\n"+
			`{"sessionId":"claude-1","cwd":"/work/lumora","timestamp":"2026-08-09T02:00:00Z","customTitle":"Remote Claude","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":5}}}`+"\n")
	dependencies := fileAdapterDependencies(home, nil)
	sessions, invalid, err := scanClaude(context.Background(), "/usr/bin/claude", dependencies)
	if err != nil || invalid != 0 || len(sessions) != 1 {
		t.Fatalf("unexpected Claude scan: sessions=%#v invalid=%d err=%v", sessions, invalid, err)
	}
	if sessions[0].NativeID != "claude-1" || sessions[0].Title != "Remote Claude" || sessions[0].LifetimeTokens == nil || *sessions[0].LifetimeTokens != 15 {
		t.Fatalf("unexpected Claude session: %#v", sessions[0])
	}
}

func TestGeminiFileAdapterSupportsJsonAndProjectRoot(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, ".gemini", "tmp", "project")
	writeFixture(t, filepath.Join(root, ".project_root"), "/work/gemini\n")
	writeFixture(t, filepath.Join(root, "chats", "session.json"),
		`{"sessionId":"gemini-1","summary":"Remote Gemini","startTime":"2026-08-09T01:00:00Z","messages":[{"id":"m1","timestamp":"2026-08-09T02:00:00Z","tokens":{"input":20,"cached":4,"output":5,"thoughts":2}}]}`)
	dependencies := fileAdapterDependencies(home, nil)
	sessions, invalid, err := scanGemini(context.Background(), "/usr/bin/gemini", dependencies)
	if err != nil || invalid != 0 || len(sessions) != 1 {
		t.Fatalf("unexpected Gemini scan: sessions=%#v invalid=%d err=%v", sessions, invalid, err)
	}
	if sessions[0].NativeID != "gemini-1" || sessions[0].LifetimeTokens == nil || *sessions[0].LifetimeTokens != 23 {
		t.Fatalf("unexpected Gemini session: %#v", sessions[0])
	}
}

func TestQwenFileAdapterDiscoversCustomTitle(t *testing.T) {
	home := t.TempDir()
	id := "123e4567-e89b-12d3-a456-426614174000"
	writeFixture(t, filepath.Join(home, ".qwen", "projects", "project", "chats", id+".jsonl"),
		`{"sessionId":"`+id+`","cwd":"/work/qwen","timestamp":"2026-08-09T01:00:00Z"}`+"\n"+
			`{"sessionId":"`+id+`","cwd":"/work/qwen","timestamp":"2026-08-09T02:00:00Z","type":"system","subtype":"custom_title","systemPayload":{"customTitle":"Remote Qwen"}}`+"\n"+
			`{"sessionId":"`+id+`","cwd":"/work/qwen","timestamp":"2026-08-09T03:00:00Z","type":"assistant","uuid":"m1","usageMetadata":{"promptTokenCount":20,"cachedContentTokenCount":4,"candidatesTokenCount":5,"thoughtsTokenCount":2}}`+"\n")
	dependencies := fileAdapterDependencies(home, nil)
	sessions, invalid, err := scanQwen(context.Background(), "/usr/bin/qwen", dependencies)
	if err != nil || invalid != 0 || len(sessions) != 1 || sessions[0].Title != "Remote Qwen" || sessions[0].LifetimeTokens == nil || *sessions[0].LifetimeTokens != 23 {
		t.Fatalf("unexpected Qwen scan: sessions=%#v invalid=%d err=%v", sessions, invalid, err)
	}
}

func TestCopilotFileAdapterUsesEventsAndWorkspaceFallback(t *testing.T) {
	home := t.TempDir()
	id := "123e4567-e89b-12d3-a456-426614174000"
	writeFixture(t, filepath.Join(home, ".copilot", "session-state", id, "events.jsonl"),
		`{"type":"session.start","timestamp":"2026-08-09T01:00:00Z","data":{"cwd":"/work/copilot","name":"Remote Copilot"}}`+"\n"+
			`{"type":"session.shutdown","timestamp":"2026-08-09T02:00:00Z","data":{"cwd":"/work/copilot","modelMetrics":[{"usage":{"inputTokens":30,"cacheReadTokens":10,"outputTokens":7}}]}}`+"\n")
	dependencies := fileAdapterDependencies(home, nil)
	sessions, invalid, err := scanCopilot(context.Background(), "/usr/bin/copilot", dependencies)
	if err != nil || invalid != 0 || len(sessions) != 1 || sessions[0].WorkspacePath != "/work/copilot" || sessions[0].LifetimeTokens == nil || *sessions[0].LifetimeTokens != 27 {
		t.Fatalf("unexpected Copilot scan: sessions=%#v invalid=%d err=%v", sessions, invalid, err)
	}
}

func TestFileAdaptersRejectRelativeEnvironmentOverrides(t *testing.T) {
	home := t.TempDir()
	writeFixture(t, filepath.Join(home, ".claude", "projects", "project", "session.jsonl"),
		`{"sessionId":"claude-default","cwd":"/work/default","timestamp":"2026-08-09T01:00:00Z"}`+"\n")
	dependencies := fileAdapterDependencies(home, map[string]string{"CLAUDE_CONFIG_DIR": "relative/private"})
	sessions, _, err := scanClaude(context.Background(), "/usr/bin/claude", dependencies)
	if err != nil || len(sessions) != 1 || sessions[0].NativeID != "claude-default" {
		t.Fatalf("relative override escaped the safe default: sessions=%#v err=%v", sessions, err)
	}
}
