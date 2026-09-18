package statusnotify

import (
	"bytes"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

type recorder struct {
	bytes.Buffer
	closed bool
}

func (r *recorder) Close() error {
	r.closed = true
	return nil
}

type fixture struct {
	env      map[string]string
	stdin    io.Reader
	sent     *recorder
	dialed   string
	chained  [][]string
	dialFail bool
}

func newFixture() *fixture {
	return &fixture{
		env: map[string]string{
			endpointVariable: `\\.\pipe\lumora-status-test`,
			tokenVariable:    "token-1",
		},
		sent: &recorder{},
	}
}

func (f *fixture) deps() Dependencies {
	return Dependencies{
		Getenv: func(name string) string { return f.env[name] },
		Stdin:  f.stdin,
		Dial: func(endpoint string, _ time.Duration) (io.WriteCloser, error) {
			f.dialed = endpoint
			if f.dialFail {
				return nil, errors.New("no Lumora")
			}
			return f.sent, nil
		},
		Chain: func(program string, args []string) error {
			f.chained = append(f.chained, append([]string{program}, args...))
			return nil
		},
		Timeout: 50 * time.Millisecond,
	}
}

func TestReportsTheEventAndNothingElse(t *testing.T) {
	f := newFixture()
	if code := Run([]string{"--event", "stop"}, f.deps()); code != 0 {
		t.Fatalf("exit status = %d", code)
	}
	if f.dialed != `\\.\pipe\lumora-status-test` {
		t.Fatalf("dialed %q", f.dialed)
	}
	if got := f.sent.String(); got != "{\"token\":\"token-1\",\"event\":\"stop\"}\n" {
		t.Fatalf("sent %q", got)
	}
	if !f.sent.closed {
		t.Fatal("connection left open")
	}
}

func TestReportsThatTheAgentStartedOnAPrompt(t *testing.T) {
	f := newFixture()
	f.stdin = strings.NewReader(`{"hook_event_name":"UserPromptSubmit","prompt":"private words"}`)
	Run([]string{"--event", "prompt-submit"}, f.deps())
	if got := f.sent.String(); got != "{\"token\":\"token-1\",\"event\":\"prompt-submit\"}\n" {
		t.Fatalf("sent %q", got)
	}
}

func TestDropsCodexPayloadAndPassesItToThePersonsOwnProgram(t *testing.T) {
	f := newFixture()
	f.env[chainVariable] = `["python3","C:\\Users\\me\\notify.py"]`
	payload := `{"type":"agent-turn-complete","last-assistant-message":"secret work"}`
	Run([]string{"--event", "turn-complete", payload}, f.deps())

	if strings.Contains(f.sent.String(), "secret") {
		t.Fatalf("conversation text reached Lumora: %q", f.sent.String())
	}
	if !strings.Contains(f.sent.String(), `"event":"turn-complete"`) {
		t.Fatalf("sent %q", f.sent.String())
	}
	if len(f.chained) != 1 {
		t.Fatalf("chained %v", f.chained)
	}
	want := []string{"python3", `C:\Users\me\notify.py`, payload}
	for index, part := range want {
		if f.chained[0][index] != part {
			t.Fatalf("chained %v, want %v", f.chained[0], want)
		}
	}
}

func TestSkipsClaudesReminderThatItIsStillWaiting(t *testing.T) {
	f := newFixture()
	f.stdin = strings.NewReader(`{"hook_event_name":"Notification","notification_type":"idle_prompt","message":"Claude is waiting"}`)
	Run([]string{"--event", "notification"}, f.deps())
	if f.sent.Len() != 0 {
		t.Fatalf("an idle reminder was reported: %q", f.sent.String())
	}

	f = newFixture()
	f.stdin = strings.NewReader(`{"hook_event_name":"Notification","notification_type":"permission_prompt"}`)
	Run([]string{"--event", "notification"}, f.deps())
	if !strings.Contains(f.sent.String(), `"event":"notification"`) {
		t.Fatalf("a permission prompt was not reported: %q", f.sent.String())
	}

	// Older versions send no type: a request is the safer reading.
	f = newFixture()
	f.stdin = strings.NewReader(`{"message":"Claude needs your permission"}`)
	Run([]string{"--event", "notification"}, f.deps())
	if f.sent.Len() == 0 {
		t.Fatal("an untyped notification was dropped")
	}
}

func TestStaysQuietAndSucceedsWhenLumoraIsNotThere(t *testing.T) {
	f := newFixture()
	f.dialFail = true
	if code := Run([]string{"--event", "stop"}, f.deps()); code != 0 {
		t.Fatalf("exit status = %d", code)
	}

	f = newFixture()
	delete(f.env, tokenVariable)
	Run([]string{"--event", "stop"}, f.deps())
	if f.dialed != "" {
		t.Fatal("dialed without a token")
	}

	f = newFixture()
	Run([]string{"--event", "rm -rf"}, f.deps())
	if f.dialed != "" {
		t.Fatal("reported an unknown event")
	}
}

func TestIgnoresAChainThatIsNotAList(t *testing.T) {
	f := newFixture()
	f.env[chainVariable] = `"just a string"`
	Run([]string{"--event", "turn-complete", "{}"}, f.deps())
	if len(f.chained) != 0 {
		t.Fatalf("chained %v", f.chained)
	}
}
