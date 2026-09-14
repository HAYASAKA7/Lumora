// Package processtree reports the processes started under one root process,
// so Lumora can show what its agents are running and what they cost.
package processtree

import (
	"errors"
	"sort"
	"unicode/utf8"
)

// MaxProcesses bounds one result so it fits a helper control frame.
const MaxProcesses = 256

const maxNameBytes = 64

// Process is one process in the tree under a root.
type Process struct {
	PID       int    `json:"pid"`
	ParentPID int    `json:"parentPid"`
	Name      string `json:"name"`
	// Measured is false when the process exists but its usage could not be read.
	Measured        bool   `json:"measured"`
	WorkingSetBytes uint64 `json:"workingSetBytes"`
	CPUTimeMs       uint64 `json:"cpuTimeMs"`
	// StartedAt is milliseconds since the Unix epoch, or 0 when unknown. It tells
	// a process apart from a later one that reuses its PID.
	StartedAt int64 `json:"startedAt"`
}

// Result lists the root first, then its descendants depth first.
type Result struct {
	Processes []Process `json:"processes"`
	Truncated bool      `json:"truncated"`
}

// ErrUnsupported is returned on platforms without a process listing.
var ErrUnsupported = errors.New("process listing is unsupported on this platform")

// Sample lists rootPID and every process started under it.
func Sample(rootPID int) (Result, error) {
	all, err := listProcesses()
	if err != nil {
		return Result{}, err
	}
	// Walk once to find the candidates, measure only those, then walk again so
	// start times can reject a parent PID that was reused by a newer process.
	candidates, _ := Descendants(all, rootPID, MaxProcesses*2)
	measured := measureProcesses(candidates)
	processes, truncated := Descendants(measured, rootPID, MaxProcesses)
	return Result{Processes: processes, Truncated: truncated}, nil
}

// Descendants returns rootPID and its descendants, depth first with siblings
// in PID order, stopping at limit.
func Descendants(all []Process, rootPID int, limit int) ([]Process, bool) {
	byPID := make(map[int]Process, len(all))
	children := make(map[int][]int, len(all))
	for _, process := range all {
		byPID[process.PID] = process
	}
	root, found := byPID[rootPID]
	if !found || limit < 1 {
		return []Process{}, false
	}
	for _, process := range all {
		if process.PID == process.ParentPID {
			continue
		}
		parent, hasParent := byPID[process.ParentPID]
		if !hasParent || !startedAfter(parent, process) {
			continue
		}
		children[process.ParentPID] = append(children[process.ParentPID], process.PID)
	}
	for pid := range children {
		sort.Ints(children[pid])
	}

	result := make([]Process, 0, min(limit, len(all)))
	visited := map[int]struct{}{}
	truncated := false
	var visit func(Process)
	visit = func(process Process) {
		if truncated {
			return
		}
		if _, seen := visited[process.PID]; seen {
			return
		}
		if len(result) == limit {
			truncated = true
			return
		}
		visited[process.PID] = struct{}{}
		process.Name = boundedName(process.Name)
		result = append(result, process)
		for _, childPID := range children[process.PID] {
			visit(byPID[childPID])
		}
	}
	visit(root)
	return result, truncated
}

// startedAfter reports whether child can be parent's child: a child never starts
// before its parent, so an earlier start means the parent PID was reused.
func startedAfter(parent, child Process) bool {
	return parent.StartedAt == 0 || child.StartedAt == 0 || child.StartedAt >= parent.StartedAt
}

func boundedName(name string) string {
	if len(name) <= maxNameBytes {
		return name
	}
	cut := maxNameBytes
	for cut > 0 && !utf8.RuneStart(name[cut]) {
		cut--
	}
	return name[:cut]
}
