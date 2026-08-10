package sessioncatalog

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestPageKeepsSessionResponseBelowControlFrameBudget(t *testing.T) {
	sessions := make([]Session, 100)
	for index := range sessions {
		sessions[index] = Session{
			NativeID:      "session-" + string(rune('a'+index%26)),
			WorkspacePath: "/work/" + string(make([]byte, 4_000)),
			Title:         "Large workspace metadata",
			CreatedAt:     "2026-08-08T04:03:02Z",
			UpdatedAt:     "2026-08-09T04:03:02Z",
			SourceKey:     "source-" + string(rune('a'+index%26)),
		}
	}
	result := page(Query{Provider: "opencode", Cursor: 0, Limit: 100}, sessions, 0, time.Now())
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > maxSessionResultBytes {
		t.Fatalf("session page exceeded frame budget: %d", len(encoded))
	}
	if result.NextCursor == nil {
		t.Fatal("bounded page did not preserve pagination")
	}
}

func TestScanOpenCodeNormalizesMetadataAndPaginates(t *testing.T) {
	commands := [][]string{}
	result := ScanWithDependencies(context.Background(), Query{
		Provider: "opencode", Cursor: 1, Limit: 1,
	}, Dependencies{
		LocateProvider: func(context.Context, string) (string, error) {
			return "/usr/bin/opencode", nil
		},
		RunCommand: func(_ context.Context, executable string, args []string) ([]byte, error) {
			commands = append(commands, append([]string{executable}, args...))
			return []byte(`[
				{"id":"new","directory":"/work/new","title":"Newest","created":1784260000000,"updated":1784270400000},
				{"id":"middle","directory":"/work/middle","title":"","created":1784250000000,"updated":1784260000000},
				{"id":"old","directory":"/work/old","title":"Oldest","created":1784240000000,"updated":1784250000000},
				{"id":"broken","directory":"relative","created":1,"updated":2}
			]`), nil
		},
		Now: func() time.Time { return time.Date(2026, 8, 9, 4, 3, 2, 0, time.UTC) },
	})

	if result.Status != "ready" || result.Provider != "opencode" || result.InvalidCount != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if len(result.Sessions) != 1 || result.Sessions[0].NativeID != "middle" || result.Sessions[0].Title != "Untitled session" {
		t.Fatalf("unexpected page: %#v", result.Sessions)
	}
	if result.NextCursor == nil || *result.NextCursor != "2" {
		t.Fatalf("unexpected cursor: %#v", result.NextCursor)
	}
	wantCommand := []string{
		"/usr/bin/opencode", "db",
		"SELECT id, directory, title, time_created AS created, time_updated AS updated FROM session ORDER BY time_updated DESC",
		"--format", "json",
	}
	if !reflect.DeepEqual(commands, [][]string{wantCommand}) {
		t.Fatalf("unexpected commands: %#v", commands)
	}
}

func TestScanOpenCodeFallsBackToLegacyListAndRejectsTranscriptFields(t *testing.T) {
	calls := 0
	result := ScanWithDependencies(context.Background(), Query{
		Provider: "opencode", Cursor: 0, Limit: 50,
	}, Dependencies{
		LocateProvider: func(context.Context, string) (string, error) {
			return "/usr/bin/opencode", nil
		},
		RunCommand: func(_ context.Context, _ string, args []string) ([]byte, error) {
			calls++
			if args[0] == "db" {
				return nil, errors.New("db unavailable")
			}
			return []byte(`[{"id":"session-1","directory":"/work/lumora","title":"Safe title","created":1784260000000,"updated":1784270400000,"messages":["private prompt"]}]`), nil
		},
		Now: func() time.Time { return time.Date(2026, 8, 9, 4, 3, 2, 0, time.UTC) },
	})

	if calls != 2 || len(result.Sessions) != 1 {
		t.Fatalf("legacy fallback failed: calls=%d result=%#v", calls, result)
	}
	if result.Sessions[0].SourceKey != "opencode:session-1" {
		t.Fatalf("unexpected source key: %#v", result.Sessions[0])
	}
}

func TestScanReturnsUnsupportedWithoutRunningCommands(t *testing.T) {
	result := ScanWithDependencies(context.Background(), Query{
		Provider: "aider", Cursor: 0, Limit: 50,
	}, Dependencies{
		LocateProvider: func(context.Context, string) (string, error) {
			t.Fatal("unsupported provider must not be located")
			return "", nil
		},
	})
	if result.Status != "unsupported" || result.Sessions == nil || len(result.Sessions) != 0 {
		t.Fatalf("unexpected unsupported result: %#v", result)
	}
}

func TestScanReturnsUnavailableWhenImplementedProviderIsNotInstalled(t *testing.T) {
	result := ScanWithDependencies(context.Background(), Query{
		Provider: "opencode", Cursor: 0, Limit: 50,
	}, Dependencies{
		LocateProvider: func(context.Context, string) (string, error) {
			return "", errors.New("not found")
		},
		Now: func() time.Time { return time.Date(2026, 8, 9, 4, 3, 2, 0, time.UTC) },
	})
	if result.Status != "unavailable" || len(result.Sessions) != 0 {
		t.Fatalf("unexpected unavailable result: %#v", result)
	}
}

func TestCatalogKeepsSnapshotAcrossPagesAndRefreshesFromFirstPage(t *testing.T) {
	calls := 0
	now := time.Date(2026, 8, 10, 5, 0, 0, 0, time.UTC)
	catalog := NewCatalog(Dependencies{
		LocateProvider: func(context.Context, string) (string, error) {
			return "/usr/bin/codex", nil
		},
		ProviderScanners: map[string]ProviderScanner{
			"codex": func(context.Context, string, Dependencies) ([]Session, int, error) {
				calls++
				return []Session{
					{NativeID: "first", WorkspacePath: "/work/a", Title: "First", CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano), SourceKey: "codex:first"},
					{NativeID: "second", WorkspacePath: "/work/b", Title: "Second", CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano), SourceKey: "codex:second"},
				}, 0, nil
			},
		},
		Now: func() time.Time { return now.Add(time.Duration(calls) * time.Minute) },
	})

	first := catalog.Scan(context.Background(), Query{Provider: "codex", Cursor: 0, Limit: 1})
	second := catalog.Scan(context.Background(), Query{Provider: "codex", Cursor: 1, Limit: 1})
	if calls != 1 {
		t.Fatalf("later pages must use one immutable snapshot, got %d scans", calls)
	}
	if first.ScannedAt != second.ScannedAt || len(second.Sessions) != 1 || second.Sessions[0].NativeID != "second" {
		t.Fatalf("pagination did not preserve the snapshot: first=%#v second=%#v", first, second)
	}

	refreshed := catalog.Scan(context.Background(), Query{Provider: "codex", Cursor: 0, Limit: 1})
	if calls != 2 || refreshed.ScannedAt == first.ScannedAt {
		t.Fatalf("cursor zero must refresh the snapshot: calls=%d first=%q refreshed=%q", calls, first.ScannedAt, refreshed.ScannedAt)
	}
}

func TestCatalogSeparatesFailedUnavailableAndUnsupportedProviders(t *testing.T) {
	now := time.Date(2026, 8, 10, 5, 0, 0, 0, time.UTC)
	catalog := NewCatalog(Dependencies{
		LocateProvider: func(_ context.Context, provider string) (string, error) {
			if provider == "claude" {
				return "", errors.New("not installed")
			}
			return "/usr/bin/" + provider, nil
		},
		ProviderScanners: map[string]ProviderScanner{
			"codex": func(context.Context, string, Dependencies) ([]Session, int, error) {
				return nil, 0, errors.New("malformed provider response")
			},
			"claude": func(context.Context, string, Dependencies) ([]Session, int, error) {
				t.Fatal("an unavailable provider must not be scanned")
				return nil, 0, nil
			},
		},
		Now: func() time.Time { return now },
	})

	if result := catalog.Scan(context.Background(), Query{Provider: "codex", Limit: 50}); result.Status != "failed" {
		t.Fatalf("unexpected failed result: %#v", result)
	}
	if result := catalog.Scan(context.Background(), Query{Provider: "claude", Limit: 50}); result.Status != "unavailable" {
		t.Fatalf("unexpected unavailable result: %#v", result)
	}
	if result := catalog.Scan(context.Background(), Query{Provider: "amp", Limit: 50}); result.Status != "unsupported" {
		t.Fatalf("unexpected unsupported result: %#v", result)
	}
}

func TestCatalogRejectsAdapterRecordsOutsideTheProtocolBoundary(t *testing.T) {
	now := time.Date(2026, 8, 10, 5, 0, 0, 0, time.UTC)
	catalog := NewCatalog(Dependencies{
		LocateProvider: func(context.Context, string) (string, error) { return "/usr/bin/codex", nil },
		ProviderScanners: map[string]ProviderScanner{
			"codex": func(context.Context, string, Dependencies) ([]Session, int, error) {
				return []Session{
					{NativeID: "safe", WorkspacePath: "/work/safe", Title: "Safe", CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano), SourceKey: "codex:safe"},
					{NativeID: "unsafe", WorkspacePath: "relative/private", Title: "Unsafe", CreatedAt: now.Format(time.RFC3339Nano), UpdatedAt: now.Format(time.RFC3339Nano), SourceKey: "codex:unsafe"},
				}, 0, nil
			},
		},
		Now: func() time.Time { return now },
	})
	result := catalog.Scan(context.Background(), Query{Provider: "codex", Limit: 50})
	if result.Status != "ready" || result.InvalidCount != 1 || len(result.Sessions) != 1 || result.Sessions[0].NativeID != "safe" {
		t.Fatalf("unsafe adapter output crossed the helper boundary: %#v", result)
	}
}
