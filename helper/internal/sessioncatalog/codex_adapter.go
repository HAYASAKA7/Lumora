package sessioncatalog

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	codexRequestTimeout = 30 * time.Second
	codexPageLimit      = 50
	codexPageSize       = 500
	codexUsageTailBytes = 256 * 1024
)

type CodexThread struct {
	ID        string  `json:"id"`
	Ephemeral bool    `json:"ephemeral"`
	CWD       string  `json:"cwd"`
	CreatedAt float64 `json:"createdAt"`
	UpdatedAt float64 `json:"updatedAt"`
	Name      string  `json:"-"`
	Path      string  `json:"-"`
}

type codexThreadWire struct {
	ID        string  `json:"id"`
	Ephemeral bool    `json:"ephemeral"`
	CWD       string  `json:"cwd"`
	CreatedAt float64 `json:"createdAt"`
	UpdatedAt float64 `json:"updatedAt"`
	Name      *string `json:"name"`
	Path      *string `json:"path"`
}

type codexResponse struct {
	ID     int             `json:"id"`
	Result json.RawMessage `json:"result"`
	Error  json.RawMessage `json:"error"`
}

type codexThreadPage struct {
	Data       []codexThreadWire `json:"data"`
	NextCursor *string           `json:"nextCursor"`
}

func scanCodex(ctx context.Context, executable string, dependencies Dependencies) ([]Session, int, error) {
	threads, invalid, err := dependencies.ListCodexThreads(ctx, executable)
	if err != nil {
		return nil, invalid, err
	}
	byID := map[string]Session{}
	for _, thread := range threads {
		if thread.Ephemeral {
			continue
		}
		id := strings.TrimSpace(thread.ID)
		workspace := strings.TrimSpace(thread.CWD)
		if id == "" || len(id) > 256 || !isPortableAbsolutePath(workspace) || thread.CreatedAt < 0 || thread.UpdatedAt < thread.CreatedAt {
			invalid++
			continue
		}
		created := unixSeconds(thread.CreatedAt)
		updated := unixSeconds(thread.UpdatedAt)
		if created.IsZero() || updated.IsZero() {
			invalid++
			continue
		}
		title := truncateTitle(thread.Name)
		if title == "" {
			title = "Untitled session"
		}
		session := Session{
			NativeID: id, WorkspacePath: cleanPortablePath(workspace), Title: title,
			CreatedAt: created.Format(time.RFC3339Nano), UpdatedAt: updated.Format(time.RFC3339Nano),
			SourceKey: "codex:thread:" + id,
		}
		if isPortableAbsolutePath(thread.Path) {
			session.SourceKey = "codex:" + thread.Path
			session.LifetimeTokens = inspectCodexUsage(thread.Path)
		}
		addNewest(byID, session)
	}
	return orderedSessions(byID), invalid, nil
}

func unixSeconds(value float64) time.Time {
	seconds := int64(value)
	nanos := int64((value - float64(seconds)) * float64(time.Second))
	parsed := time.Unix(seconds, nanos).UTC()
	if parsed.Year() < 1970 || parsed.Year() > 9999 {
		return time.Time{}
	}
	return parsed
}

func listCodexThreads(parent context.Context, executable string) ([]CodexThread, int, error) {
	ctx, cancel := context.WithTimeout(parent, codexRequestTimeout)
	defer cancel()
	commandPath, commandArgs := commandSpec(executable, []string{"app-server"})
	command := exec.CommandContext(ctx, commandPath, commandArgs...)
	command.Env = append(os.Environ(), "NO_COLOR=1")
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, 0, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, 0, err
	}
	command.Stderr = &boundedBuffer{}
	if err := command.Start(); err != nil {
		return nil, 0, err
	}
	defer func() {
		_ = stdin.Close()
		if command.Process != nil {
			_ = command.Process.Kill()
		}
		_ = command.Wait()
	}()

	reader := bufio.NewReader(stdout)
	outputBytes := 0
	request := func(id int, method string, params any) (json.RawMessage, error) {
		message := map[string]any{"id": id, "method": method, "params": params}
		encoded, marshalErr := json.Marshal(message)
		if marshalErr != nil {
			return nil, marshalErr
		}
		if _, writeErr := stdin.Write(append(encoded, '\n')); writeErr != nil {
			return nil, writeErr
		}
		for {
			line, readErr := reader.ReadBytes('\n')
			outputBytes += len(line)
			if outputBytes > maxCommandOutput {
				return nil, errors.New("Codex App Server output exceeded its limit")
			}
			if readErr != nil {
				return nil, readErr
			}
			var response codexResponse
			if json.Unmarshal(line, &response) != nil || response.ID != id {
				continue
			}
			if len(response.Error) > 0 && string(response.Error) != "null" {
				return nil, errors.New("Codex App Server returned an error")
			}
			if len(response.Result) == 0 {
				return nil, errors.New("Codex App Server returned no result")
			}
			return response.Result, nil
		}
	}
	if _, err := request(1, "initialize", map[string]any{
		"clientInfo":   map[string]any{"name": "lumora", "title": "Lumora", "version": "0.4.0"},
		"capabilities": nil,
	}); err != nil {
		return nil, 0, err
	}
	initialized, _ := json.Marshal(map[string]any{"method": "initialized", "params": map[string]any{}})
	if _, err := stdin.Write(append(initialized, '\n')); err != nil {
		return nil, 0, err
	}

	threads := []CodexThread{}
	invalid := 0
	var cursor *string
	for page := 0; page < codexPageLimit; page++ {
		result, err := request(page+2, "thread/list", map[string]any{
			"cursor": cursor, "limit": codexPageSize, "sortKey": "updated_at",
			"sortDirection": "desc", "useStateDbOnly": false,
		})
		if err != nil {
			return nil, invalid, err
		}
		var envelope codexThreadPage
		if json.Unmarshal(result, &envelope) != nil {
			return nil, invalid, errors.New("Codex App Server returned invalid thread data")
		}
		for _, wire := range envelope.Data {
			name := ""
			if wire.Name != nil {
				name = *wire.Name
			}
			path := ""
			if wire.Path != nil {
				path = *wire.Path
			}
			threads = append(threads, CodexThread{ID: wire.ID, Ephemeral: wire.Ephemeral, CWD: wire.CWD,
				CreatedAt: wire.CreatedAt, UpdatedAt: wire.UpdatedAt, Name: name, Path: path})
		}
		cursor = envelope.NextCursor
		if cursor == nil || strings.TrimSpace(*cursor) == "" {
			return threads, invalid, nil
		}
	}
	return nil, invalid, errors.New("Codex App Server exceeded its page limit")
}

func inspectCodexUsage(path string) *int64 {
	file, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 {
		return nil
	}
	length := min64(info.Size(), codexUsageTailBytes)
	start := info.Size() - length
	buffer := make([]byte, length)
	read, err := file.ReadAt(buffer, start)
	if err != nil && !errors.Is(err, io.EOF) {
		return nil
	}
	text := string(buffer[:read])
	if start > 0 {
		if newline := strings.IndexByte(text, '\n'); newline >= 0 {
			text = text[newline+1:]
		} else {
			return nil
		}
	}
	lines := strings.Split(text, "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		var record map[string]any
		if json.Unmarshal([]byte(strings.TrimSpace(lines[index])), &record) != nil || record["type"] != "event_msg" {
			continue
		}
		payload, _ := record["payload"].(map[string]any)
		if payload["type"] != "token_count" {
			continue
		}
		infoRecord, _ := payload["info"].(map[string]any)
		usage, _ := infoRecord["total_token_usage"].(map[string]any)
		if total, valid := effectiveTokens(usage, "input_tokens", "cached_input_tokens", "output_tokens", ""); valid {
			return &total
		}
	}
	return nil
}
