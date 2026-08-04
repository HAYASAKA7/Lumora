package protocol

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

func TestFrameRoundTrip(t *testing.T) {
	var stream bytes.Buffer
	want := Request{
		ProtocolVersion: Version,
		Kind:            "request",
		Generation:      3,
		RequestID:       "request-3",
		Operation:       "handshake",
		Payload:         map[string]any{},
	}
	if err := WriteFrame(&stream, want); err != nil {
		t.Fatal(err)
	}
	var got Request
	if err := ReadFrame(&stream, &got); err != nil {
		t.Fatal(err)
	}
	if got.ProtocolVersion != want.ProtocolVersion || got.RequestID != want.RequestID || got.Operation != want.Operation {
		t.Fatalf("unexpected round trip: %#v", got)
	}
}

func TestReadFrameRejectsInvalidInput(t *testing.T) {
	cases := map[string][]byte{
		"empty":     {0, 0, 0, 0},
		"oversized": func() []byte { b := make([]byte, 4); binary.BigEndian.PutUint32(b, MaxControlFrameBytes+1); return b }(),
		"malformed": append([]byte{0, 0, 0, 1}, '{'),
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			var value map[string]any
			if err := ReadFrame(bytes.NewReader(input), &value); err == nil {
				t.Fatal("expected invalid frame to fail")
			}
		})
	}
}

func TestWriteFrameRejectsOversizedPayload(t *testing.T) {
	var stream bytes.Buffer
	if err := WriteFrame(&stream, map[string]string{"value": strings.Repeat("x", MaxControlFrameBytes)}); err == nil {
		t.Fatal("expected oversized frame to fail")
	}
}
