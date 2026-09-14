package processtree

import (
	"errors"
	"path"
	"strconv"
	"strings"
	"time"
)

var errMalformed = errors.New("malformed process record")

// procStat holds the fields Lumora reads from a Linux /proc/<pid>/stat record.
type procStat struct {
	PID        int
	ParentPID  int
	Command    string
	CPUTicks   uint64
	StartTicks uint64
	RSSPages   uint64
}

// parseProcStat parses one /proc/<pid>/stat record. The command sits in
// parentheses and may itself contain spaces and parentheses, so the fields
// after it are found from the last closing parenthesis.
func parseProcStat(record string) (procStat, error) {
	open := strings.IndexByte(record, '(')
	closing := strings.LastIndexByte(record, ')')
	if open < 1 || closing < open {
		return procStat{}, errMalformed
	}
	pid, err := strconv.Atoi(strings.TrimSpace(record[:open]))
	if err != nil {
		return procStat{}, errMalformed
	}
	// fields[0] is field 3 (state) in proc(5), so field n is fields[n-3].
	fields := strings.Fields(record[closing+1:])
	if len(fields) < 22 {
		return procStat{}, errMalformed
	}
	values := make([]uint64, 0, 5)
	for _, index := range []int{1, 11, 12, 19, 21} {
		value, err := strconv.ParseUint(fields[index], 10, 64)
		if err != nil {
			return procStat{}, errMalformed
		}
		values = append(values, value)
	}
	return procStat{
		PID:        pid,
		ParentPID:  int(values[0]),
		Command:    record[open+1 : closing],
		CPUTicks:   values[1] + values[2],
		StartTicks: values[3],
		RSSPages:   values[4],
	}, nil
}

// psColumns is the column list the macOS listing asks ps for.
var psColumns = []string{"-axo", "pid=,ppid=,rss=,time=,lstart=,comm="}

// parsePSLine parses one line of `ps -axo pid=,ppid=,rss=,time=,lstart=,comm=`.
// lstart is five words and comm, last, may contain spaces.
func parsePSLine(line string, location *time.Location) (Process, error) {
	const leadingWords = 9
	words, rest := splitWords(line, leadingWords)
	if len(words) < leadingWords || strings.TrimSpace(rest) == "" {
		return Process{}, errMalformed
	}
	pid, pidErr := strconv.Atoi(words[0])
	ppid, ppidErr := strconv.Atoi(words[1])
	rssKilobytes, rssErr := strconv.ParseUint(words[2], 10, 64)
	cpuTime, cpuErr := parseCPUTime(words[3])
	started, startErr := time.ParseInLocation(
		"Mon Jan 2 15:04:05 2006", strings.Join(words[4:9], " "), location,
	)
	if pidErr != nil || ppidErr != nil || rssErr != nil || cpuErr != nil || startErr != nil {
		return Process{}, errMalformed
	}
	return Process{
		PID:             pid,
		ParentPID:       ppid,
		Name:            path.Base(strings.TrimSpace(rest)),
		Measured:        true,
		WorkingSetBytes: rssKilobytes * 1024,
		CPUTimeMs:       uint64(cpuTime / time.Millisecond),
		StartedAt:       started.UnixMilli(),
	}, nil
}

// splitWords returns the first count space-separated words and the text after them.
func splitWords(line string, count int) ([]string, string) {
	words := make([]string, 0, count)
	rest := line
	for len(words) < count {
		rest = strings.TrimLeft(rest, " \t")
		if rest == "" {
			break
		}
		end := strings.IndexAny(rest, " \t")
		if end < 0 {
			words = append(words, rest)
			rest = ""
			break
		}
		words = append(words, rest[:end])
		rest = rest[end:]
	}
	return words, rest
}

// parseCPUTime parses ps's accumulated CPU time: [days-][hours:]minutes:seconds[.fraction].
func parseCPUTime(value string) (time.Duration, error) {
	var days time.Duration
	if dash := strings.IndexByte(value, '-'); dash >= 0 {
		count, err := strconv.Atoi(value[:dash])
		if err != nil || count < 0 {
			return 0, errMalformed
		}
		days = time.Duration(count) * 24 * time.Hour
		value = value[dash+1:]
	}
	parts := strings.Split(value, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, errMalformed
	}
	seconds, err := strconv.ParseFloat(parts[len(parts)-1], 64)
	if err != nil || seconds < 0 {
		return 0, errMalformed
	}
	total := days + time.Duration(seconds*float64(time.Second))
	unit := time.Minute
	for index := len(parts) - 2; index >= 0; index-- {
		count, err := strconv.Atoi(parts[index])
		if err != nil || count < 0 {
			return 0, errMalformed
		}
		total += time.Duration(count) * unit
		unit *= 60
	}
	return total, nil
}
