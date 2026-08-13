package sessioncatalog

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	maxProviderFiles = 25_000
	maxSessionBytes  = 64 * 1024 * 1024
	metadataBytes    = 256 * 1024
)

var (
	uuidPattern              = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	kimiSessionPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`)
	copilotTitleEventPattern = regexp.MustCompile(`creat|start|rename|name|title|metadata`)
)

func providerRoot(dependencies Dependencies, environmentKey string, fallback ...string) (string, error) {
	home, err := dependencies.HomeDirectory()
	if err != nil || !filepath.IsAbs(home) {
		return "", errors.New("provider home is unavailable")
	}
	configured := strings.TrimSpace(dependencies.Getenv(environmentKey))
	if configured != "" && filepath.IsAbs(configured) {
		return filepath.Clean(configured), nil
	}
	parts := append([]string{home}, fallback...)
	return filepath.Join(parts...), nil
}

func listDirectories(root string) ([]os.DirEntry, error) {
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return []os.DirEntry{}, nil
	}
	if err != nil {
		return nil, err
	}
	directories := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			directories = append(directories, entry)
		}
	}
	return directories, nil
}

func boundedFiles(roots []string, accept func(string) bool) ([]string, int, error) {
	paths := []string{}
	skipped := 0
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, skipped, err
		}
		for _, entry := range entries {
			if !entry.Type().IsRegular() || !accept(entry.Name()) {
				continue
			}
			if len(paths) >= maxProviderFiles {
				skipped++
				continue
			}
			paths = append(paths, filepath.Join(root, entry.Name()))
		}
	}
	sort.Strings(paths)
	return paths, skipped, nil
}

func readBoundedFile(path string, limit int64) ([]byte, os.FileInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, nil, err
	}
	if !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > limit {
		return nil, info, errors.New("provider session file is outside bounds")
	}
	value, err := os.ReadFile(path)
	if err != nil {
		return nil, info, err
	}
	after, err := os.Stat(path)
	if err != nil || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return nil, info, errors.New("provider session changed during scan")
	}
	return value, info, nil
}

func metadataLines(path string) ([]map[string]any, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > maxSessionBytes {
		return nil, errors.New("provider session file is outside bounds")
	}
	segments := make([]byte, 0, metadataBytes*2)
	prefixLength := min64(info.Size(), metadataBytes)
	prefix := make([]byte, prefixLength)
	read, _ := file.ReadAt(prefix, 0)
	segments = append(segments, prefix[:read]...)
	if info.Size() > prefixLength {
		segments = append(segments, '\n')
		tailStart := info.Size() - metadataBytes
		if tailStart < prefixLength {
			tailStart = prefixLength
		}
		tail := make([]byte, info.Size()-tailStart)
		read, _ = file.ReadAt(tail, tailStart)
		if newline := strings.IndexByte(string(tail[:read]), '\n'); newline >= 0 {
			segments = append(segments, tail[newline+1:read]...)
		}
	}
	return parseJSONLines(segments), nil
}

func min64(left int64, right int64) int64 {
	if left < right {
		return left
	}
	return right
}

func parseJSONLines(value []byte) []map[string]any {
	records := []map[string]any{}
	scanner := bufio.NewScanner(strings.NewReader(string(value)))
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	for scanner.Scan() {
		var record map[string]any
		if json.Unmarshal(scanner.Bytes(), &record) == nil && record != nil {
			records = append(records, record)
		}
	}
	return records
}

func visitJSONLines(path string, limit int64, visit func(map[string]any)) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < 1 || info.Size() > limit {
		return errors.New("provider session file is outside bounds")
	}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	for scanner.Scan() {
		var record map[string]any
		if json.Unmarshal(scanner.Bytes(), &record) == nil && record != nil {
			visit(record)
		}
	}
	return scanner.Err()
}

func stringField(record map[string]any, fields ...string) string {
	for _, field := range fields {
		if value, ok := record[field].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func timestamp(value any) (time.Time, bool) {
	switch typed := value.(type) {
	case string:
		parsed, err := time.Parse(time.RFC3339Nano, typed)
		return parsed, err == nil
	case float64:
		if typed > 10_000_000_000 {
			return time.UnixMilli(int64(typed)).UTC(), true
		}
		return time.Unix(int64(typed), 0).UTC(), true
	default:
		return time.Time{}, false
	}
}

func numeric(value any) (int64, bool) {
	number, ok := value.(float64)
	if !ok || number < 0 || number > float64(^uint64(0)>>1) || number != float64(int64(number)) {
		return 0, false
	}
	return int64(number), true
}

func effectiveTokens(record map[string]any, input, cached, output, reasoning string) (int64, bool) {
	in, ok := numeric(record[input])
	if !ok {
		return 0, false
	}
	cache := int64(0)
	if cached != "" && record[cached] != nil {
		if cache, ok = numeric(record[cached]); !ok {
			return 0, false
		}
	}
	out, ok := numeric(record[output])
	if !ok {
		return 0, false
	}
	reason := int64(0)
	if reasoning != "" && record[reasoning] != nil {
		if reason, ok = numeric(record[reasoning]); !ok {
			return 0, false
		}
	}
	if cache > in {
		cache = in
	}
	return in - cache + out + reason, true
}

func orderedSessions(byID map[string]Session) []Session {
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
	return sessions
}

func addNewest(byID map[string]Session, session Session) {
	existing, found := byID[session.NativeID]
	if !found || session.UpdatedAt > existing.UpdatedAt || (session.UpdatedAt == existing.UpdatedAt && session.Title > existing.Title) {
		byID[session.NativeID] = session
	}
}

func sessionFromRecords(provider string, expectedID string, source string, records []map[string]any) (Session, bool) {
	ids := map[string]struct{}{}
	workspaces := map[string]struct{}{}
	times := []time.Time{}
	title := ""
	for _, record := range records {
		id := stringField(record, "sessionId")
		if id != "" {
			ids[id] = struct{}{}
		}
		workspace := stringField(record, "cwd")
		if isPortableAbsolutePath(workspace) {
			workspaces[workspace] = struct{}{}
		}
		if parsed, ok := timestamp(record["timestamp"]); ok {
			times = append(times, parsed)
		}
		for _, field := range []string{"customTitle", "aiTitle", "sessionName"} {
			if candidate := stringField(record, field); candidate != "" {
				title = candidate
			}
		}
		if provider == "qwen" && record["type"] == "system" && record["subtype"] == "custom_title" {
			if payload, ok := record["systemPayload"].(map[string]any); ok {
				title = stringField(payload, "customTitle")
			}
		}
	}
	if expectedID != "" {
		if _, ok := ids[expectedID]; !ok {
			return Session{}, false
		}
		ids = map[string]struct{}{expectedID: {}}
	}
	if len(ids) != 1 || len(workspaces) != 1 || len(times) == 0 {
		return Session{}, false
	}
	var id, workspace string
	for value := range ids {
		id = value
	}
	for value := range workspaces {
		workspace = value
	}
	sort.Slice(times, func(left, right int) bool { return times[left].Before(times[right]) })
	if title == "" {
		title = "Untitled session"
	}
	return Session{
		NativeID: id, WorkspacePath: cleanPortablePath(workspace), Title: truncateTitle(title),
		CreatedAt: times[0].UTC().Format(time.RFC3339Nano), UpdatedAt: times[len(times)-1].UTC().Format(time.RFC3339Nano),
		SourceKey: provider + ":" + source,
	}, true
}

func truncateTitle(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > 256 {
		runes = runes[:256]
	}
	return string(runes)
}

type kimiIndexRecord struct {
	SessionID  string `json:"sessionId"`
	SessionDir string `json:"sessionDir"`
	WorkDir    string `json:"workDir"`
}

type kimiState struct {
	Title        string `json:"title"`
	LastPrompt   string `json:"lastPrompt"`
	CreatedAt    any    `json:"createdAt"`
	CreatedSnake any    `json:"created_at"`
	CreationTime any    `json:"creationTime"`
	UpdatedAt    any    `json:"updatedAt"`
	UpdatedSnake any    `json:"updated_at"`
	UpdateTime   any    `json:"updateTime"`
}

func pathInside(root string, candidate string) bool {
	relativePath, err := filepath.Rel(root, candidate)
	return err == nil && relativePath != ".." && !strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) && !filepath.IsAbs(relativePath)
}

func safeKimiRegularFile(root string, source string, maxBytes int64) (string, os.FileInfo, error) {
	entry, err := os.Lstat(source)
	if err != nil {
		return "", nil, err
	}
	if entry.Mode()&os.ModeSymlink != 0 || !entry.Mode().IsRegular() || entry.Size() < 1 || entry.Size() > maxBytes {
		return "", nil, errors.New("Kimi source is outside bounds")
	}
	canonical, err := filepath.EvalSymlinks(source)
	if err != nil || !pathInside(root, canonical) {
		return "", nil, errors.New("Kimi source escaped its data root")
	}
	return canonical, entry, nil
}

func readStableKimiFile(root string, source string, maxBytes int64) ([]byte, string, os.FileInfo, error) {
	canonical, before, err := safeKimiRegularFile(root, source, maxBytes)
	if err != nil {
		return nil, "", nil, err
	}
	value, err := os.ReadFile(canonical)
	if err != nil {
		return nil, "", nil, err
	}
	_, after, err := safeKimiRegularFile(root, source, maxBytes)
	if err != nil || after.Size() != before.Size() || !after.ModTime().Equal(before.ModTime()) {
		return nil, "", nil, errors.New("Kimi source changed during scan")
	}
	return value, canonical, before, nil
}

func firstTimestamp(values ...any) (time.Time, bool) {
	for _, value := range values {
		if parsed, ok := timestamp(value); ok {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func kimiUsageTokens(record map[string]any) (int64, bool, bool) {
	if record["type"] != "usage.record" {
		return 0, false, true
	}
	usage, ok := record["usage"].(map[string]any)
	if !ok {
		return 0, true, false
	}
	input, inputOK := numeric(usage["inputOther"])
	output, outputOK := numeric(usage["output"])
	if !inputOK || !outputOK || input > int64(^uint64(0)>>1)-output {
		return 0, true, false
	}
	return input + output, true, true
}

func kimiLifetimeTokens(root string, sessionDir string) *int64 {
	agentsRoot := filepath.Join(sessionDir, "agents")
	agents, err := os.ReadDir(agentsRoot)
	if err != nil {
		return nil
	}
	directories := []os.DirEntry{}
	for _, agent := range agents {
		if agent.IsDir() && agent.Type()&os.ModeSymlink == 0 {
			directories = append(directories, agent)
		}
	}
	if len(directories) == 0 || len(directories) > 256 {
		return nil
	}
	sort.Slice(directories, func(left, right int) bool { return directories[left].Name() < directories[right].Name() })
	remaining := int64(maxSessionBytes)
	var total int64
	sawUsage := false
	for _, agent := range directories {
		wire := filepath.Join(agentsRoot, agent.Name(), "wire.jsonl")
		value, _, info, readErr := readStableKimiFile(root, wire, remaining)
		if readErr != nil {
			return nil
		}
		remaining -= info.Size()
		scanner := bufio.NewScanner(bytes.NewReader(value))
		scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
		for scanner.Scan() {
			if len(bytes.TrimSpace(scanner.Bytes())) == 0 {
				continue
			}
			var record map[string]any
			if json.Unmarshal(scanner.Bytes(), &record) != nil || record == nil {
				return nil
			}
			tokens, usage, valid := kimiUsageTokens(record)
			if !valid {
				return nil
			}
			if usage {
				sawUsage = true
				if total > int64(^uint64(0)>>1)-tokens {
					return nil
				}
				total += tokens
			}
		}
		if scanner.Err() != nil {
			return nil
		}
	}
	if !sawUsage {
		return nil
	}
	return &total
}

func scanKimi(_ context.Context, _ string, dependencies Dependencies) ([]Session, int, error) {
	root, err := providerRoot(dependencies, "KIMI_CODE_HOME", ".kimi-code")
	if err != nil {
		return nil, 0, err
	}
	canonicalRoot, err := filepath.EvalSymlinks(root)
	if errors.Is(err, os.ErrNotExist) {
		return []Session{}, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	indexPath := filepath.Join(canonicalRoot, "session_index.jsonl")
	index, _, _, err := readStableKimiFile(canonicalRoot, indexPath, 16*1024*1024)
	if errors.Is(err, os.ErrNotExist) {
		return []Session{}, 0, nil
	}
	if err != nil {
		return nil, 1, nil
	}
	sessionsRoot := filepath.Join(canonicalRoot, "sessions")
	byID := map[string]Session{}
	invalid := 0
	records := 0
	scanner := bufio.NewScanner(bytes.NewReader(index))
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	for scanner.Scan() {
		if len(bytes.TrimSpace(scanner.Bytes())) == 0 {
			continue
		}
		if records >= maxProviderFiles {
			invalid++
			continue
		}
		records++
		var indexRecord kimiIndexRecord
		if json.Unmarshal(scanner.Bytes(), &indexRecord) != nil ||
			!kimiSessionPattern.MatchString(strings.TrimSpace(indexRecord.SessionID)) ||
			!isPortableAbsolutePath(indexRecord.SessionDir) ||
			!isPortableAbsolutePath(indexRecord.WorkDir) {
			invalid++
			continue
		}
		sessionEntry, entryErr := os.Lstat(indexRecord.SessionDir)
		canonicalSession, canonicalErr := filepath.EvalSymlinks(indexRecord.SessionDir)
		if entryErr != nil || canonicalErr != nil || sessionEntry.Mode()&os.ModeSymlink != 0 || !sessionEntry.IsDir() || !pathInside(sessionsRoot, canonicalSession) {
			invalid++
			continue
		}
		stateValue, statePath, _, stateErr := readStableKimiFile(canonicalRoot, filepath.Join(canonicalSession, "state.json"), metadataBytes)
		if stateErr != nil {
			invalid++
			continue
		}
		var state kimiState
		if json.Unmarshal(stateValue, &state) != nil {
			invalid++
			continue
		}
		created, createdOK := firstTimestamp(state.CreatedAt, state.CreatedSnake, state.CreationTime)
		updated, updatedOK := firstTimestamp(state.UpdatedAt, state.UpdatedSnake, state.UpdateTime)
		if !createdOK || !updatedOK || created.After(updated) {
			invalid++
			continue
		}
		title := truncateTitle(state.Title)
		if title == "" {
			title = truncateTitle(state.LastPrompt)
		}
		if title == "" {
			title = "Untitled session"
		}
		addNewest(byID, Session{
			NativeID: strings.TrimSpace(indexRecord.SessionID), WorkspacePath: cleanPortablePath(indexRecord.WorkDir),
			Title: title, CreatedAt: created.UTC().Format(time.RFC3339Nano), UpdatedAt: updated.UTC().Format(time.RFC3339Nano),
			LifetimeTokens: kimiLifetimeTokens(canonicalRoot, canonicalSession), SourceKey: statePath,
		})
	}
	if scanner.Err() != nil {
		return nil, invalid + 1, nil
	}
	return orderedSessions(byID), invalid, nil
}

func scanClaude(_ context.Context, _ string, dependencies Dependencies) ([]Session, int, error) {
	root, err := providerRoot(dependencies, "CLAUDE_CONFIG_DIR", ".claude")
	if err != nil {
		return nil, 0, err
	}
	projects, err := listDirectories(filepath.Join(root, "projects"))
	if err != nil {
		return nil, 0, err
	}
	roots := make([]string, 0, len(projects))
	for _, project := range projects {
		roots = append(roots, filepath.Join(root, "projects", project.Name()))
	}
	paths, invalid, err := boundedFiles(roots, func(name string) bool { return strings.HasSuffix(name, ".jsonl") })
	if err != nil {
		return nil, invalid, err
	}
	byID := map[string]Session{}
	for _, source := range paths {
		records, readErr := metadataLines(source)
		if readErr != nil {
			invalid++
			continue
		}
		session, ok := sessionFromRecords("claude", "", source, records)
		if !ok {
			invalid++
			continue
		}
		totals := map[string]int64{}
		if fullErr := visitJSONLines(source, maxSessionBytes, func(record map[string]any) {
			message, _ := record["message"].(map[string]any)
			usage, _ := message["usage"].(map[string]any)
			if id := stringField(message, "id"); id != "" {
				if tokens, valid := effectiveTokens(usage, "input_tokens", "", "output_tokens", ""); valid {
					totals[id] = tokens
				}
			}
		}); fullErr == nil {
			session.LifetimeTokens = sumTokenSnapshots(totals)
		}
		addNewest(byID, session)
	}
	return orderedSessions(byID), invalid, nil
}

func sumTokenSnapshots(values map[string]int64) *int64 {
	if len(values) == 0 {
		return nil
	}
	var total int64
	for _, value := range values {
		if value > 0 && total > int64(^uint64(0)>>1)-value {
			return nil
		}
		total += value
	}
	return &total
}

func scanGemini(_ context.Context, _ string, dependencies Dependencies) ([]Session, int, error) {
	base, err := providerRoot(dependencies, "GEMINI_CLI_HOME")
	if err != nil {
		return nil, 0, err
	}
	storage := filepath.Join(base, ".gemini", "tmp")
	projects, err := listDirectories(storage)
	if err != nil {
		return nil, 0, err
	}
	byID := map[string]Session{}
	invalid := 0
	seenFiles := 0
	for _, project := range projects {
		projectRoot := filepath.Join(storage, project.Name())
		workspaceBytes, _, readErr := readBoundedFile(filepath.Join(projectRoot, ".project_root"), 32_768)
		workspace := strings.TrimSpace(string(workspaceBytes))
		if readErr != nil || !isPortableAbsolutePath(workspace) {
			invalid++
			continue
		}
		paths, skipped, listErr := boundedFiles([]string{filepath.Join(projectRoot, "chats")}, func(name string) bool {
			return strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".jsonl")
		})
		invalid += skipped
		if listErr != nil {
			return nil, invalid, listErr
		}
		remaining := maxProviderFiles - seenFiles
		if remaining <= 0 {
			invalid += len(paths)
			continue
		}
		if len(paths) > remaining {
			invalid += len(paths) - remaining
			paths = paths[:remaining]
		}
		seenFiles += len(paths)
		for _, source := range paths {
			raw, info, fileErr := readBoundedFile(source, 8*1024*1024)
			if fileErr != nil {
				invalid++
				continue
			}
			var records []map[string]any
			if strings.HasSuffix(source, ".jsonl") {
				records = parseJSONLines(raw)
			} else {
				var record map[string]any
				if json.Unmarshal(raw, &record) != nil {
					invalid++
					continue
				}
				records = []map[string]any{record}
			}
			session, ok := normalizeGemini(records, workspace, source, info.ModTime())
			if !ok {
				invalid++
				continue
			}
			addNewest(byID, session)
		}
	}
	return orderedSessions(byID), invalid, nil
}

func normalizeGemini(records []map[string]any, workspace string, source string, modified time.Time) (Session, bool) {
	objects := []map[string]any{}
	for _, record := range records {
		objects = append(objects, record)
		if messages, ok := record["messages"].([]any); ok {
			for _, value := range messages {
				if message, ok := value.(map[string]any); ok {
					objects = append(objects, message)
				}
			}
		}
	}
	id := ""
	title := "Untitled session"
	times := []time.Time{modified}
	tokens := map[string]int64{}
	for _, record := range objects {
		if candidate := stringField(record, "sessionId"); candidate != "" && id == "" {
			id = candidate
			if candidateTitle := stringField(record, "summary", "title"); candidateTitle != "" {
				title = truncateTitle(candidateTitle)
			}
		}
		for _, field := range []string{"startTime", "lastUpdated", "timestamp"} {
			if parsed, ok := timestamp(record[field]); ok {
				times = append(times, parsed)
			}
		}
		if usage, ok := record["tokens"].(map[string]any); ok {
			if key := stringField(record, "id"); key != "" {
				if total, valid := effectiveTokens(usage, "input", "cached", "output", "thoughts"); valid {
					tokens[key] = total
				}
			}
		}
	}
	if id == "" {
		return Session{}, false
	}
	sort.Slice(times, func(left, right int) bool { return times[left].Before(times[right]) })
	return Session{NativeID: id, WorkspacePath: cleanPortablePath(workspace), Title: title,
		CreatedAt: times[0].UTC().Format(time.RFC3339Nano), UpdatedAt: times[len(times)-1].UTC().Format(time.RFC3339Nano),
		LifetimeTokens: sumTokenSnapshots(tokens), SourceKey: "gemini:" + source}, true
}

func qwenRoot(dependencies Dependencies) (string, error) {
	home, err := dependencies.HomeDirectory()
	if err != nil || !filepath.IsAbs(home) {
		return "", errors.New("provider home is unavailable")
	}
	for _, key := range []string{"QWEN_RUNTIME_DIR", "QWEN_HOME"} {
		if configured := strings.TrimSpace(dependencies.Getenv(key)); configured != "" && filepath.IsAbs(configured) {
			return filepath.Clean(configured), nil
		}
	}
	return filepath.Join(home, ".qwen"), nil
}

func scanQwen(_ context.Context, _ string, dependencies Dependencies) ([]Session, int, error) {
	root, err := qwenRoot(dependencies)
	if err != nil {
		return nil, 0, err
	}
	projects, err := listDirectories(filepath.Join(root, "projects"))
	if err != nil {
		return nil, 0, err
	}
	roots := make([]string, 0, len(projects))
	for _, project := range projects {
		roots = append(roots, filepath.Join(root, "projects", project.Name(), "chats"))
	}
	paths, invalid, err := boundedFiles(roots, func(name string) bool { return strings.HasSuffix(name, ".jsonl") })
	if err != nil {
		return nil, invalid, err
	}
	byID := map[string]Session{}
	for _, source := range paths {
		id := strings.TrimSuffix(filepath.Base(source), filepath.Ext(source))
		if !uuidPattern.MatchString(id) {
			invalid++
			continue
		}
		records, readErr := metadataLines(source)
		if readErr != nil {
			invalid++
			continue
		}
		matching := make([]map[string]any, 0, len(records))
		for _, record := range records {
			if stringField(record, "sessionId") == id {
				matching = append(matching, record)
			}
		}
		session, ok := sessionFromRecords("qwen", id, source, matching)
		if !ok {
			invalid++
			continue
		}
		totals := map[string]int64{}
		if tokenErr := visitJSONLines(source, maxSessionBytes, func(record map[string]any) {
			if stringField(record, "sessionId") != id {
				return
			}
			if record["type"] != "assistant" {
				return
			}
			usage, _ := record["usageMetadata"].(map[string]any)
			if key := stringField(record, "uuid"); key != "" {
				if total, valid := effectiveTokens(usage, "promptTokenCount", "cachedContentTokenCount", "candidatesTokenCount", "thoughtsTokenCount"); valid {
					totals[key] = total
				}
			}
		}); tokenErr == nil {
			session.LifetimeTokens = sumTokenSnapshots(totals)
		}
		addNewest(byID, session)
	}
	return orderedSessions(byID), invalid, nil
}

func scanCopilot(_ context.Context, _ string, dependencies Dependencies) ([]Session, int, error) {
	root, err := providerRoot(dependencies, "COPILOT_HOME", ".copilot")
	if err != nil {
		return nil, 0, err
	}
	directories, err := listDirectories(filepath.Join(root, "session-state"))
	if err != nil {
		return nil, 0, err
	}
	byID := map[string]Session{}
	invalid := 0
	seen := 0
	for _, directory := range directories {
		id := directory.Name()
		if !uuidPattern.MatchString(id) {
			continue
		}
		if seen >= maxProviderFiles {
			invalid++
			continue
		}
		seen++
		sessionRoot := filepath.Join(root, "session-state", id)
		events := filepath.Join(sessionRoot, "events.jsonl")
		if raw, _, readErr := readBoundedFile(events, maxSessionBytes); readErr == nil {
			session, ok := normalizeCopilotEvents(id, events, parseJSONLines(raw))
			if !ok {
				invalid++
				continue
			}
			addNewest(byID, session)
			continue
		}
		workspace := filepath.Join(sessionRoot, "workspace.yaml")
		raw, _, readErr := readBoundedFile(workspace, 256*1024)
		if readErr != nil {
			continue
		}
		session, ok := normalizeCopilotYAML(id, workspace, string(raw))
		if !ok {
			invalid++
			continue
		}
		addNewest(byID, session)
	}
	return orderedSessions(byID), invalid, nil
}

func nestedScopes(record map[string]any, depth int) []map[string]any {
	result := []map[string]any{record}
	if depth >= 3 {
		return result
	}
	for _, key := range []string{"data", "metadata", "session", "context"} {
		if nested, ok := record[key].(map[string]any); ok {
			result = append(result, nestedScopes(nested, depth+1)...)
		}
	}
	return result
}

func normalizeCopilotEvents(id string, source string, records []map[string]any) (Session, bool) {
	times := []time.Time{}
	workspace := ""
	title := ""
	var lifetimeTokens *int64
	for _, record := range records {
		if parsed, ok := timestamp(record["timestamp"]); ok {
			times = append(times, parsed)
		}
		recordType := strings.ToLower(stringField(record, "type"))
		for _, scope := range nestedScopes(record, 0) {
			if candidate := stringField(scope, "cwd", "workingDirectory", "workspacePath"); isPortableAbsolutePath(candidate) {
				workspace = candidate
			}
			if strings.Contains(recordType, "session") && copilotTitleEventPattern.MatchString(recordType) {
				if candidate := stringField(scope, "name", "sessionName", "title"); candidate != "" {
					title = candidate
				}
			}
		}
		if record["type"] == "session.shutdown" {
			if tokens := copilotShutdownTokens(record); tokens != nil {
				lifetimeTokens = tokens
			}
		}
	}
	if workspace == "" || len(times) == 0 {
		return Session{}, false
	}
	sort.Slice(times, func(left, right int) bool { return times[left].Before(times[right]) })
	if title == "" {
		title = "Untitled session"
	}
	return Session{NativeID: id, WorkspacePath: cleanPortablePath(workspace), Title: truncateTitle(title),
		CreatedAt: times[0].UTC().Format(time.RFC3339Nano), UpdatedAt: times[len(times)-1].UTC().Format(time.RFC3339Nano),
		LifetimeTokens: lifetimeTokens, SourceKey: "copilot:" + source}, true
}

func copilotShutdownTokens(record map[string]any) *int64 {
	data, _ := record["data"].(map[string]any)
	metrics := data["modelMetrics"]
	entries := []any{}
	switch typed := metrics.(type) {
	case []any:
		entries = typed
	case map[string]any:
		for _, entry := range typed {
			entries = append(entries, entry)
		}
	}
	var total int64
	found := false
	for _, entry := range entries {
		metric, _ := entry.(map[string]any)
		usage, _ := metric["usage"].(map[string]any)
		tokens, valid := effectiveTokens(usage, "inputTokens", "cacheReadTokens", "outputTokens", "")
		if !valid || tokens > int64(9_007_199_254_740_991)-total {
			continue
		}
		total += tokens
		found = true
	}
	if !found {
		return nil
	}
	return &total
}

func normalizeCopilotYAML(id string, source string, raw string) (Session, bool) {
	fields := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			fields[strings.TrimSpace(parts[0])] = strings.Trim(strings.TrimSpace(parts[1]), `"'`)
		}
	}
	created, createdOK := timestamp(fields["created_at"])
	updated, updatedOK := timestamp(fields["updated_at"])
	if fields["id"] != id || !isPortableAbsolutePath(fields["cwd"]) || !createdOK || !updatedOK || created.After(updated) {
		return Session{}, false
	}
	title := fields["summary"]
	if title == "" {
		title = "Untitled session"
	}
	return Session{NativeID: id, WorkspacePath: cleanPortablePath(fields["cwd"]), Title: truncateTitle(title),
		CreatedAt: created.UTC().Format(time.RFC3339Nano), UpdatedAt: updated.UTC().Format(time.RFC3339Nano), SourceKey: "copilot:" + source}, true
}
