// Package statusnotify lets an agent that Lumora launched say, from inside the
// agent's own hook, that it started working, finished, or needs the person. It
// sends Lumora an event name over a local endpoint and nothing else: no
// transcript, no message. It prints nothing either, since Claude Code adds what
// a prompt hook prints to the prompt.
package statusnotify

import (
	"encoding/json"
	"io"
	"os/exec"
	"strings"
	"time"
)

const (
	endpointVariable = "LUMORA_STATUS_ENDPOINT"
	tokenVariable    = "LUMORA_STATUS_ID"
	// The person's own Codex notify program, which Lumora's replaces for the
	// launch and so has to run as well.
	chainVariable = "LUMORA_STATUS_CHAIN"
	maxHookInput  = 64 * 1024
	maxChainParts = 64
)

var knownEvents = map[string]bool{
	"prompt-submit": true,
	"stop":          true,
	"notification":  true,
	"turn-complete": true,
	"interrupt":     true,
}

// Dependencies are the outside world the command touches, so tests can replace it.
type Dependencies struct {
	Getenv  func(string) string
	Stdin   io.Reader
	Dial    func(endpoint string, timeout time.Duration) (io.WriteCloser, error)
	Chain   func(program string, args []string) error
	Timeout time.Duration
}

// Default wires the command to the process it runs in.
func Default(getenv func(string) string, stdin io.Reader) Dependencies {
	return Dependencies{
		Getenv: getenv,
		Stdin:  stdin,
		Dial:   dial,
		Chain: func(program string, args []string) error {
			return exec.Command(program, args...).Run()
		},
		Timeout: time.Second,
	}
}

// Run reports one event and returns the exit status, which is always 0: a hook
// that fails makes the agent complain about Lumora, and a missed dot is the
// smaller harm. The arguments are `--event <name>` and, from Codex, the JSON
// payload it appends, which is passed on to the person's own program untouched
// and never read here.
func Run(args []string, deps Dependencies) int {
	event, rest := parseEvent(args)
	chain(deps, rest)
	if !knownEvents[event] {
		return 0
	}
	if event == "notification" && isIdleReminder(deps.Stdin, deps.Timeout) {
		return 0
	}
	endpoint := deps.Getenv(endpointVariable)
	token := deps.Getenv(tokenVariable)
	if endpoint == "" || token == "" || len(token) > 256 {
		return 0
	}
	line, err := json.Marshal(struct {
		Token string `json:"token"`
		Event string `json:"event"`
	}{Token: token, Event: event})
	if err != nil {
		return 0
	}
	connection, err := deps.Dial(endpoint, deps.Timeout)
	if err != nil {
		return 0
	}
	defer connection.Close()
	_, _ = connection.Write(append(line, '\n'))
	return 0
}

func parseEvent(args []string) (string, []string) {
	for index := 0; index+1 < len(args); index++ {
		if args[index] == "--event" {
			rest := append(append([]string{}, args[:index]...), args[index+2:]...)
			return args[index+1], rest
		}
	}
	return "", args
}

// chain runs the person's own Codex notify program with the arguments Codex
// gave this one, so replacing it for the launch never silences it.
func chain(deps Dependencies, args []string) {
	value := deps.Getenv(chainVariable)
	if value == "" || deps.Chain == nil {
		return
	}
	var command []string
	if err := json.Unmarshal([]byte(value), &command); err != nil {
		return
	}
	if len(command) == 0 || len(command) > maxChainParts || strings.TrimSpace(command[0]) == "" {
		return
	}
	_ = deps.Chain(command[0], append(append([]string{}, command[1:]...), args...))
}

// isIdleReminder tells Claude Code's reminder that it has been waiting a while
// from a real request: the turn that ended already gave its cue, and saying it
// again a minute later is noise. Input that cannot be read counts as a request.
func isIdleReminder(stdin io.Reader, timeout time.Duration) bool {
	if stdin == nil {
		return false
	}
	type result struct {
		data []byte
		err  error
	}
	read := make(chan result, 1)
	go func() {
		data, err := io.ReadAll(io.LimitReader(stdin, maxHookInput))
		read <- result{data, err}
	}()
	select {
	case got := <-read:
		if got.err != nil {
			return false
		}
		var input struct {
			NotificationType string `json:"notification_type"`
		}
		if json.Unmarshal(got.data, &input) != nil {
			return false
		}
		return input.NotificationType == "idle_prompt"
	case <-time.After(timeout):
		return false
	}
}
