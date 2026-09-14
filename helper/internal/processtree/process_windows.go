//go:build windows

package processtree

import (
	"errors"
	"syscall"
	"unsafe"
)

const (
	processQueryLimitedInformation = 0x1000
	processVMRead                  = 0x0010
	// Windows file times count 100 ns intervals from 1601; Unix time starts in 1970.
	fileTimeUnixEpoch = 116444736000000000
)

var procGetProcessMemoryInfo = syscall.NewLazyDLL("kernel32.dll").NewProc("K32GetProcessMemoryInfo")

// processMemoryCounters mirrors PROCESS_MEMORY_COUNTERS.
type processMemoryCounters struct {
	cb                         uint32
	PageFaultCount             uint32
	PeakWorkingSetSize         uintptr
	WorkingSetSize             uintptr
	QuotaPeakPagedPoolUsage    uintptr
	QuotaPagedPoolUsage        uintptr
	QuotaPeakNonPagedPoolUsage uintptr
	QuotaNonPagedPoolUsage     uintptr
	PagefileUsage              uintptr
	PeakPagefileUsage          uintptr
}

// listProcesses takes a snapshot of every process with its parent and name.
// Usage is read afterwards, only for the processes in the tree.
func listProcesses() ([]Process, error) {
	snapshot, err := syscall.CreateToolhelp32Snapshot(syscall.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer syscall.CloseHandle(snapshot)

	var entry syscall.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	processes := []Process{}
	for err = syscall.Process32First(snapshot, &entry); err == nil; err = syscall.Process32Next(snapshot, &entry) {
		processes = append(processes, Process{
			PID:       int(entry.ProcessID),
			ParentPID: int(entry.ParentProcessID),
			Name:      syscall.UTF16ToString(entry.ExeFile[:]),
		})
	}
	if !errors.Is(err, syscall.ERROR_NO_MORE_FILES) {
		return nil, err
	}
	return processes, nil
}

// measureProcesses reads usage and start time for each process. A process that
// exited in the meantime is dropped; one this user may not read is kept unmeasured.
func measureProcesses(processes []Process) []Process {
	measured := make([]Process, 0, len(processes))
	for _, process := range processes {
		handle, err := syscall.OpenProcess(processQueryLimitedInformation|processVMRead, false, uint32(process.PID))
		if err != nil {
			handle, err = syscall.OpenProcess(processQueryLimitedInformation, false, uint32(process.PID))
		}
		if err != nil {
			if errors.Is(err, syscall.ERROR_ACCESS_DENIED) {
				measured = append(measured, process)
			}
			continue
		}
		measured = append(measured, measure(handle, process))
		syscall.CloseHandle(handle)
	}
	return measured
}

func measure(handle syscall.Handle, process Process) Process {
	var creation, exit, kernel, user syscall.Filetime
	if syscall.GetProcessTimes(handle, &creation, &exit, &kernel, &user) == nil {
		process.StartedAt = (fileTimeValue(creation) - fileTimeUnixEpoch) / 10_000
		process.CPUTimeMs = uint64((fileTimeValue(kernel) + fileTimeValue(user)) / 10_000)
		process.Measured = true
	}
	counters := processMemoryCounters{}
	counters.cb = uint32(unsafe.Sizeof(counters))
	ok, _, _ := procGetProcessMemoryInfo.Call(
		uintptr(handle), uintptr(unsafe.Pointer(&counters)), uintptr(counters.cb),
	)
	if ok != 0 {
		process.WorkingSetBytes = uint64(counters.WorkingSetSize)
	} else {
		process.Measured = false
	}
	return process
}

func fileTimeValue(value syscall.Filetime) int64 {
	return int64(value.HighDateTime)<<32 | int64(value.LowDateTime)
}
