//go:build !windows

package statusnotify

import (
	"io"
	"net"
	"time"
)

// dial connects to the unix socket Lumora listens on, readable by its owner only.
func dial(endpoint string, timeout time.Duration) (io.WriteCloser, error) {
	return net.DialTimeout("unix", endpoint, timeout)
}
