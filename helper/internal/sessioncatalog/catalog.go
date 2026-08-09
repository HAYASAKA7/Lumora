package sessioncatalog

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/HAYASAKA7/lumora/helper/internal/providerprobe"
)

const (
	commandTimeout        = 15 * time.Second
	maxCommandOutput      = 4 * 1024 * 1024
	maxSessionResultBytes = 56 * 1024
	openCodeQuery         = "SELECT id, directory, title, time_created AS created, time_updated AS updated FROM session ORDER BY time_updated DESC"
)

type Query struct {
	Provider string
	Cursor   int
	Limit    int
}

type Session struct {
	NativeID       string `json:"nativeId"`
	WorkspacePath  string `json:"workspacePath"`
	Title          string `json:"title"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
	LifetimeTokens *int64 `json:"lifetimeTokens"`
	SourceKey      string `json:"sourceKey"`
}

type Result struct {
	Provider     string    `json:"provider"`
	ScannedAt    string    `json:"scannedAt"`
	Status       string    `json:"status"`
	Sessions     []Session `json:"sessions"`
	InvalidCount int       `json:"invalidCount"`
	NextCursor   *string   `json:"nextCursor"`
}

type Dependencies struct {
	LocateProvider func(context.Context, string) (string, error)
	RunCommand     func(context.Context, string, []string) ([]byte, error)
	Now            func() time.Time
}

func defaultDependencies() Dependencies {
	return Dependencies{
		LocateProvider: func(ctx context.Context, provider string) (string, error) {
			return providerprobe.LocateProvider(ctx, provider, providerprobe.DefaultDependencies())
		},
		RunCommand: runBoundedCommand,
		Now:        time.Now,
	}
}

func withDefaults(dependencies Dependencies) Dependencies {
	defaults := defaultDependencies()
	if dependencies.LocateProvider == nil {
		dependencies.LocateProvider = defaults.LocateProvider
	}
	if dependencies.RunCommand == nil {
		dependencies.RunCommand = defaults.RunCommand
	}
	if dependencies.Now == nil {
		dependencies.Now = defaults.Now
	}
	return dependencies
}

func unsupported(provider string, now time.Time) Result {
	return Result{
		Provider: provider, ScannedAt: now.UTC().Format(time.RFC3339Nano),
		Status: "unsupported", Sessions: []Session{}, InvalidCount: 0,
	}
}

func unavailable(provider string, now time.Time) Result {
	return Result{
		Provider: provider, ScannedAt: now.UTC().Format(time.RFC3339Nano),
		Status: "unavailable", Sessions: []Session{}, InvalidCount: 0,
	}
}

func Scan(ctx context.Context, query Query) Result {
	return ScanWithDependencies(ctx, query, defaultDependencies())
}

func ScanWithDependencies(ctx context.Context, query Query, dependencies Dependencies) Result {
	dependencies = withDefaults(dependencies)
	if query.Provider != "opencode" {
		return unsupported(query.Provider, dependencies.Now())
	}
	executable, err := dependencies.LocateProvider(ctx, query.Provider)
	if err != nil || strings.TrimSpace(executable) == "" {
		return unavailable(query.Provider, dependencies.Now())
	}
	sessions, invalid, err := scanOpenCode(ctx, executable, dependencies.RunCommand)
	if err != nil {
		return unsupported(query.Provider, dependencies.Now())
	}
	return page(query, sessions, invalid, dependencies.Now())
}

func page(query Query, sessions []Session, invalid int, now time.Time) Result {
	start := query.Cursor
	if start > len(sessions) {
		start = len(sessions)
	}
	scannedAt := now.UTC().Format(time.RFC3339Nano)
	selected := []Session{}
	index := start
	for index < len(sessions) && len(selected) < query.Limit {
		candidate := append(append([]Session{}, selected...), sessions[index])
		nextValue := strconv.Itoa(index + 1)
		candidateResult := Result{
			Provider: query.Provider, ScannedAt: scannedAt, Status: "ready",
			Sessions: candidate, InvalidCount: invalid, NextCursor: &nextValue,
		}
		encoded, err := json.Marshal(candidateResult)
		if err != nil || len(encoded) > maxSessionResultBytes {
			if len(selected) > 0 {
				break
			}
			invalid++
			index++
			continue
		}
		selected = candidate
		index++
	}
	var next *string
	if index < len(sessions) {
		value := strconv.Itoa(index)
		next = &value
	}
	return Result{
		Provider: query.Provider, ScannedAt: scannedAt, Status: "ready",
		Sessions: selected, InvalidCount: invalid, NextCursor: next,
	}
}

type openCodeRow struct {
	ID        string  `json:"id"`
	Directory string  `json:"directory"`
	Title     string  `json:"title"`
	Created   float64 `json:"created"`
	Updated   float64 `json:"updated"`
}

func scanOpenCode(
	ctx context.Context,
	executable string,
	run func(context.Context, string, []string) ([]byte, error),
) ([]Session, int, error) {
	output, err := run(ctx, executable, []string{"db", openCodeQuery, "--format", "json"})
	if err != nil || !json.Valid(output) {
		output, err = run(ctx, executable, []string{"session", "list", "--format", "json"})
	}
	if err != nil {
		return nil, 0, err
	}
	var rows []openCodeRow
	if err := json.Unmarshal(output, &rows); err != nil {
		return nil, 0, err
	}
	byID := map[string]Session{}
	invalid := 0
	for _, row := range rows {
		session, ok := normalizeOpenCode(row)
		if !ok {
			invalid++
			continue
		}
		existing, exists := byID[session.NativeID]
		if !exists || session.UpdatedAt > existing.UpdatedAt ||
			(session.UpdatedAt == existing.UpdatedAt && session.Title > existing.Title) {
			byID[session.NativeID] = session
		}
	}
	sessions := make([]Session, 0, len(byID))
	for _, session := range byID {
		sessions = append(sessions, session)
	}
	sort.Slice(sessions, func(left, right int) bool {
		if sessions[left].UpdatedAt != sessions[right].UpdatedAt {
			return sessions[left].UpdatedAt > sessions[right].UpdatedAt
		}
		return sessions[left].NativeID < sessions[right].NativeID
	})
	return sessions, invalid, nil
}

func normalizeOpenCode(row openCodeRow) (Session, bool) {
	id := strings.TrimSpace(row.ID)
	directory := strings.TrimSpace(row.Directory)
	if id == "" || len(id) > 256 || directory == "" || len(directory) > 32768 || !isPortableAbsolutePath(directory) ||
		row.Created < 0 || row.Updated < 0 || row.Created > row.Updated {
		return Session{}, false
	}
	created := time.UnixMilli(int64(row.Created)).UTC()
	updated := time.UnixMilli(int64(row.Updated)).UTC()
	if created.Year() < 1970 || updated.Year() < 1970 {
		return Session{}, false
	}
	title := strings.TrimSpace(row.Title)
	if title == "" {
		title = "Untitled session"
	}
	runes := []rune(title)
	if len(runes) > 256 {
		title = string(runes[:256])
	}
	return Session{
		NativeID: id, WorkspacePath: cleanPortablePath(directory), Title: title,
		CreatedAt: created.Format(time.RFC3339Nano), UpdatedAt: updated.Format(time.RFC3339Nano),
		SourceKey: "opencode:" + id,
	}, true
}

func isPortableAbsolutePath(value string) bool {
	if strings.HasPrefix(value, "/") || filepath.IsAbs(value) {
		return true
	}
	if len(value) >= 3 && ((value[0] >= 'A' && value[0] <= 'Z') ||
		(value[0] >= 'a' && value[0] <= 'z')) && value[1] == ':' &&
		(value[2] == '\\' || value[2] == '/') {
		return true
	}
	return strings.HasPrefix(value, `\\`)
}

func cleanPortablePath(value string) string {
	if strings.HasPrefix(value, "/") {
		return path.Clean(value)
	}
	return filepath.Clean(value)
}

type boundedBuffer struct {
	mu       sync.Mutex
	buffer   bytes.Buffer
	overflow bool
}

func (buffer *boundedBuffer) Write(value []byte) (int, error) {
	buffer.mu.Lock()
	defer buffer.mu.Unlock()
	remaining := maxCommandOutput - buffer.buffer.Len()
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

func runBoundedCommand(parent context.Context, executable string, args []string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(parent, commandTimeout)
	defer cancel()
	commandPath, commandArgs := commandSpec(executable, args)
	command := exec.CommandContext(ctx, commandPath, commandArgs...)
	output := &boundedBuffer{}
	command.Stdout = output
	command.Stderr = output
	if err := command.Run(); err != nil {
		return nil, err
	}
	output.mu.Lock()
	defer output.mu.Unlock()
	if output.overflow {
		return nil, errors.New("session output exceeded limit")
	}
	return append([]byte{}, output.buffer.Bytes()...), nil
}

func commandSpec(executable string, args []string) (string, []string) {
	extension := strings.ToLower(filepath.Ext(executable))
	if runtime.GOOS != "windows" || (extension != ".cmd" && extension != ".bat") {
		return executable, append([]string{}, args...)
	}
	const bridge = `& { $exe = $args[0]; $rest = @(); if ($args.Count -gt 1) { $rest = $args[1..($args.Count - 1)] }; & $exe @rest }`
	bridgeArgs := []string{
		"-NoLogo", "-NoProfile", "-NonInteractive", "-Command", bridge, executable,
	}
	return "powershell.exe", append(bridgeArgs, args...)
}
