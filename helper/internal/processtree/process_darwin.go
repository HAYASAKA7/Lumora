//go:build darwin

package processtree

import (
	"bufio"
	"bytes"
	"context"
	"os"
	"os/exec"
	"time"
)

const psTimeout = 5 * time.Second

// listProcesses asks ps: without cgo there is no other way to read other
// processes' usage on macOS.
func listProcesses() ([]Process, error) {
	ctx, cancel := context.WithTimeout(context.Background(), psTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, "/bin/ps", psColumns...)
	// A fixed locale keeps lstart in the English format the parser expects.
	command.Env = append(os.Environ(), "LC_ALL=C")
	output, err := command.Output()
	if err != nil {
		return nil, err
	}
	processes := []Process{}
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		process, err := parsePSLine(scanner.Text(), time.Local)
		if err != nil {
			continue
		}
		processes = append(processes, process)
	}
	return processes, scanner.Err()
}

// measureProcesses is a no-op: the ps listing already carries usage.
func measureProcesses(processes []Process) []Process {
	return processes
}
