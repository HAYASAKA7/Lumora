//go:build windows

package statusnotify

import (
	"errors"
	"io"
	"os"
	"strings"
	"time"
)

// dial opens Lumora's named pipe the way any file is opened: writing to it is
// all a hook needs, and the standard library has no pipe client of its own.
// A pipe busy with another hook is tried again until the timeout.
func dial(endpoint string, timeout time.Duration) (io.WriteCloser, error) {
	if !strings.HasPrefix(endpoint, `\\.\pipe\`) {
		return nil, errors.New("not a named pipe")
	}
	deadline := time.Now().Add(timeout)
	for {
		file, err := os.OpenFile(endpoint, os.O_WRONLY, 0)
		if err == nil {
			return file, nil
		}
		if time.Now().After(deadline) {
			return nil, err
		}
		time.Sleep(25 * time.Millisecond)
	}
}
