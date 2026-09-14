//go:build !linux && !darwin && !windows

package processtree

func listProcesses() ([]Process, error) {
	return nil, ErrUnsupported
}

func measureProcesses(processes []Process) []Process {
	return processes
}
