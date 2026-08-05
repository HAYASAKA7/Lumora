package server

import (
	"errors"
	"io"
	"regexp"

	"github.com/HAYASAKA7/lumora/helper/internal/protocol"
	"github.com/HAYASAKA7/lumora/helper/internal/systeminfo"
)

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,80}$`)

type Dependencies struct {
	HelperVersion string
	SystemInfo    func(string) (systeminfo.Info, error)
}

func validRequest(request protocol.Request) bool {
	return request.ProtocolVersion == protocol.Version &&
		request.Kind == "request" &&
		request.Generation >= 0 &&
		requestIDPattern.MatchString(request.RequestID) &&
		request.Payload != nil && len(request.Payload) == 0
}

func responseFor(request protocol.Request, dependencies Dependencies) (protocol.Response, bool) {
	response := protocol.Response{
		ProtocolVersion: protocol.Version,
		Kind:            "response",
		Generation:      request.Generation,
		RequestID:       request.RequestID,
		Operation:       request.Operation,
	}
	if !validRequest(request) {
		response.Error = &protocol.ResponseError{
			Code: "INVALID_REQUEST", Message: "The helper request is invalid.",
		}
		return response, false
	}

	switch request.Operation {
	case "handshake", "system-info":
		loadInfo := dependencies.SystemInfo
		if loadInfo == nil {
			loadInfo = systeminfo.Current
		}
		info, err := loadInfo(dependencies.HelperVersion)
		if err != nil {
			response.Error = &protocol.ResponseError{
				Code: "INTERNAL_ERROR", Message: "System information is unavailable.",
			}
			return response, false
		}
		response.OK = true
		response.Result = info
	case "health":
		response.OK = true
		response.Result = map[string]string{"status": "ok"}
	case "shutdown":
		response.OK = true
		response.Result = map[string]bool{"accepted": true}
		return response, true
	default:
		response.Error = &protocol.ResponseError{
			Code: "UNSUPPORTED_OPERATION", Message: "The helper operation is unsupported.",
		}
	}
	return response, false
}

func Serve(reader io.Reader, writer io.Writer, dependencies Dependencies) error {
	for {
		var request protocol.Request
		if err := protocol.ReadFrame(reader, &request); err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		response, stop := responseFor(request, dependencies)
		if err := protocol.WriteFrame(writer, response); err != nil {
			return err
		}
		if stop {
			return nil
		}
	}
}
