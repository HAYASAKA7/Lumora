package processtree

import (
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func pids(processes []Process) []int {
	result := make([]int, 0, len(processes))
	for _, process := range processes {
		result = append(result, process.PID)
	}
	return result
}

func equalInts(left, right []int) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func TestDescendants(t *testing.T) {
	all := []Process{
		{PID: 1, ParentPID: 0, Name: "init", StartedAt: 100},
		{PID: 10, ParentPID: 1, Name: "lumora", StartedAt: 1_000},
		{PID: 30, ParentPID: 10, Name: "codex", StartedAt: 2_000},
		{PID: 20, ParentPID: 10, Name: "claude", StartedAt: 2_100},
		{PID: 31, ParentPID: 30, Name: "npm", StartedAt: 3_000},
		{PID: 21, ParentPID: 20, Name: "bash", StartedAt: 3_100},
		// Started before PID 10 did, so its parent PID belongs to an older, gone process.
		{PID: 40, ParentPID: 10, Name: "stale", StartedAt: 900},
		{PID: 50, ParentPID: 1, Name: "unrelated", StartedAt: 1_500},
	}

	tests := []struct {
		name          string
		all           []Process
		root          int
		limit         int
		want          []int
		wantTruncated bool
	}{
		{name: "depth first with siblings in PID order", all: all, root: 10, limit: 10, want: []int{10, 20, 21, 30, 31}},
		{name: "subtree", all: all, root: 30, limit: 10, want: []int{30, 31}},
		{name: "missing root", all: all, root: 99, limit: 10, want: []int{}},
		{name: "truncated", all: all, root: 10, limit: 3, want: []int{10, 20, 21}, wantTruncated: true},
		{name: "unknown start times are trusted", all: []Process{
			{PID: 10, ParentPID: 1}, {PID: 11, ParentPID: 10},
		}, root: 10, limit: 10, want: []int{10, 11}},
		{name: "cycle", all: []Process{
			{PID: 10, ParentPID: 11}, {PID: 11, ParentPID: 10},
		}, root: 10, limit: 10, want: []int{10, 11}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, truncated := Descendants(test.all, test.root, test.limit)
			if !equalInts(pids(got), test.want) || truncated != test.wantTruncated {
				t.Fatalf("Descendants() = %v, %v; want %v, %v", pids(got), truncated, test.want, test.wantTruncated)
			}
		})
	}
}

func TestDescendantsBoundsNames(t *testing.T) {
	long := strings.Repeat("é", 40)
	got, _ := Descendants([]Process{{PID: 1, Name: long}}, 1, 1)
	if len(got[0].Name) > maxNameBytes || !strings.HasPrefix(long, got[0].Name) {
		t.Fatalf("name = %q (%d bytes)", got[0].Name, len(got[0].Name))
	}
}

func TestParseProcStat(t *testing.T) {
	record := "4242 (my (odd) cmd) S 17 4242 4242 0 -1 4194560 100 0 0 0 250 50 0 0 20 0 3 0 12345 104857600 2048 18446744073709551615"
	stat, err := parseProcStat(record)
	if err != nil {
		t.Fatal(err)
	}
	want := procStat{PID: 4242, ParentPID: 17, Command: "my (odd) cmd", CPUTicks: 300, StartTicks: 12345, RSSPages: 2048}
	if stat != want {
		t.Fatalf("parseProcStat() = %+v; want %+v", stat, want)
	}
	for _, malformed := range []string{"", "12 no parens", "x (cmd) S 1", "12 (cmd) S 1 2 3"} {
		if _, err := parseProcStat(malformed); err == nil {
			t.Fatalf("parseProcStat(%q) accepted a malformed record", malformed)
		}
	}
}

func TestParsePSLine(t *testing.T) {
	line := "  812     1  20480   1:02.50 Mon Sep  7 09:40:35 2026     /Applications/Some App.app/Contents/MacOS/Some App"
	process, err := parsePSLine(line, time.UTC)
	if err != nil {
		t.Fatal(err)
	}
	started := time.Date(2026, time.September, 7, 9, 40, 35, 0, time.UTC).UnixMilli()
	want := Process{
		PID: 812, ParentPID: 1, Name: "Some App", Measured: true,
		WorkingSetBytes: 20480 * 1024, CPUTimeMs: 62_500, StartedAt: started,
	}
	if process != want {
		t.Fatalf("parsePSLine() = %+v; want %+v", process, want)
	}
	for _, malformed := range []string{"", "812 1 20480", "812 1 20480 1:02.50 Mon Sep 7 09:40:35 2026"} {
		if _, err := parsePSLine(malformed, time.UTC); err == nil {
			t.Fatalf("parsePSLine(%q) accepted a malformed line", malformed)
		}
	}
}

func TestParseCPUTime(t *testing.T) {
	tests := map[string]time.Duration{
		"0:00.03":    30 * time.Millisecond,
		"125:04.00":  125*time.Minute + 4*time.Second,
		"1:02:03":    time.Hour + 2*time.Minute + 3*time.Second,
		"2-01:00:00": 49 * time.Hour,
	}
	for value, want := range tests {
		got, err := parseCPUTime(value)
		if err != nil || got != want {
			t.Fatalf("parseCPUTime(%q) = %v, %v; want %v", value, got, err, want)
		}
	}
	for _, malformed := range []string{"", "12", "a:b", "1:2:3:4", "-1:00"} {
		if _, err := parseCPUTime(malformed); err == nil {
			t.Fatalf("parseCPUTime(%q) accepted a malformed value", malformed)
		}
	}
}

// TestChildProcess is not a test: it is the child TestSampleFindsChild starts.
func TestChildProcess(t *testing.T) {
	if os.Getenv("LUMORA_PROCESSTREE_CHILD") != "1" {
		t.Skip("run only as a child process")
	}
	time.Sleep(10 * time.Second)
}

func TestSampleFindsChild(t *testing.T) {
	child := exec.Command(os.Args[0], "-test.run=^TestChildProcess$")
	child.Env = append(os.Environ(), "LUMORA_PROCESSTREE_CHILD=1")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = child.Process.Kill()
		_ = child.Wait()
	}()

	var result Result
	var err error
	// The child can take a moment to appear in the process listing.
	for attempt := 0; attempt < 20; attempt++ {
		result, err = Sample(os.Getpid())
		if err == nil && len(result.Processes) > 1 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Processes) == 0 || result.Processes[0].PID != os.Getpid() {
		t.Fatalf("root not first: %+v", result.Processes)
	}
	root := result.Processes[0]
	if !root.Measured || root.WorkingSetBytes == 0 || root.Name == "" || root.StartedAt == 0 {
		t.Fatalf("root not measured: %+v", root)
	}
	for _, process := range result.Processes[1:] {
		if process.PID == child.Process.Pid {
			if process.ParentPID != os.Getpid() {
				t.Fatalf("child parent = %d; want %d", process.ParentPID, os.Getpid())
			}
			return
		}
	}
	t.Fatalf("child %d missing from %+v", child.Process.Pid, result.Processes)
}
