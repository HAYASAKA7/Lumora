package protocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const (
	Version              = 1
	MaxControlFrameBytes = 64 * 1024
)

type Request struct {
	ProtocolVersion int            `json:"protocolVersion"`
	Kind            string         `json:"kind"`
	Generation      int            `json:"generation"`
	RequestID       string         `json:"requestId"`
	Operation       string         `json:"operation"`
	Payload         map[string]any `json:"payload"`
}

type ResponseError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Response struct {
	ProtocolVersion int            `json:"protocolVersion"`
	Kind            string         `json:"kind"`
	Generation      int            `json:"generation"`
	RequestID       string         `json:"requestId"`
	Operation       string         `json:"operation"`
	OK              bool           `json:"ok"`
	Result          any            `json:"result,omitempty"`
	Error           *ResponseError `json:"error,omitempty"`
}

func WriteFrame(writer io.Writer, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode helper frame: %w", err)
	}
	if len(payload) == 0 || len(payload) > MaxControlFrameBytes {
		return errors.New("helper frame size is invalid")
	}
	header := make([]byte, 4)
	binary.BigEndian.PutUint32(header, uint32(len(payload)))
	if _, err := writer.Write(header); err != nil {
		return fmt.Errorf("write helper frame header: %w", err)
	}
	if _, err := writer.Write(payload); err != nil {
		return fmt.Errorf("write helper frame payload: %w", err)
	}
	return nil
}

func ReadFrame(reader io.Reader, value any) error {
	header := make([]byte, 4)
	if _, err := io.ReadFull(reader, header); err != nil {
		return err
	}
	size := binary.BigEndian.Uint32(header)
	if size == 0 || size > MaxControlFrameBytes {
		return errors.New("helper frame size is invalid")
	}
	payload := make([]byte, int(size))
	if _, err := io.ReadFull(reader, payload); err != nil {
		return fmt.Errorf("read helper frame payload: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("decode helper frame: %w", err)
	}
	if decoder.More() {
		return errors.New("helper frame contains trailing JSON")
	}
	return nil
}
