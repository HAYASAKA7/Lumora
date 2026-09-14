//go:build linux

package processtree

import (
	"bufio"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Linux reports CPU and start times in clock ticks; USER_HZ is 100 on every
// architecture Lumora ships for, and reading sysconf would need cgo.
const clockTicksPerSecond = 100

func listProcesses() ([]Process, error) {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return nil, err
	}
	bootMs := bootTimeMs()
	pageBytes := uint64(os.Getpagesize())
	processes := make([]Process, 0, len(entries))
	for _, entry := range entries {
		if _, err := strconv.Atoi(entry.Name()); err != nil || !entry.IsDir() {
			continue
		}
		record, err := os.ReadFile(filepath.Join("/proc", entry.Name(), "stat"))
		if err != nil {
			// The process exited while the directory was being read.
			continue
		}
		stat, err := parseProcStat(strings.TrimSpace(string(record)))
		if err != nil {
			continue
		}
		name := stat.Command
		// The kernel shortens the command to 15 bytes; the executable's own name
		// is readable for processes this user started.
		if target, err := os.Readlink(filepath.Join("/proc", entry.Name(), "exe")); err == nil {
			name = filepath.Base(strings.TrimSuffix(target, " (deleted)"))
		}
		startedAt := int64(0)
		if bootMs > 0 {
			startedAt = bootMs + int64(stat.StartTicks*1000/clockTicksPerSecond)
		}
		processes = append(processes, Process{
			PID:             stat.PID,
			ParentPID:       stat.ParentPID,
			Name:            name,
			Measured:        true,
			WorkingSetBytes: stat.RSSPages * pageBytes,
			CPUTimeMs:       stat.CPUTicks * 1000 / clockTicksPerSecond,
			StartedAt:       startedAt,
		})
	}
	return processes, nil
}

// measureProcesses is a no-op: the /proc listing already carries usage.
func measureProcesses(processes []Process) []Process {
	return processes
}

func bootTimeMs() int64 {
	file, err := os.Open("/proc/stat")
	if err != nil {
		return 0
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 && fields[0] == "btime" {
			seconds, err := strconv.ParseInt(fields[1], 10, 64)
			if err == nil {
				return seconds * 1000
			}
		}
	}
	return 0
}
