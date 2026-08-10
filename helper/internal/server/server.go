package server

import (
	"context"
	"errors"
	"io"
	"regexp"
	"strconv"

	"github.com/HAYASAKA7/lumora/helper/internal/protocol"
	"github.com/HAYASAKA7/lumora/helper/internal/providerprobe"
	"github.com/HAYASAKA7/lumora/helper/internal/sessioncatalog"
	"github.com/HAYASAKA7/lumora/helper/internal/systeminfo"
)

var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,80}$`)

type Dependencies struct {
	HelperVersion string
	SystemInfo    func(string) (systeminfo.Info, error)
	Discover      func(context.Context, []string) providerprobe.Result
	SessionScan   func(context.Context, sessioncatalog.Query) sessioncatalog.Result
}

var sessionProviders = map[string]struct{}{
	"codex": {}, "claude": {}, "gemini": {}, "opencode": {},
	"copilot": {}, "qwen": {},
}

func sessionQuery(payload map[string]any) (sessioncatalog.Query, bool) {
	if len(payload) != 3 {
		return sessioncatalog.Query{}, false
	}
	provider, ok := payload["provider"].(string)
	if !ok {
		return sessioncatalog.Query{}, false
	}
	if _, supported := sessionProviders[provider]; !supported {
		return sessioncatalog.Query{}, false
	}
	limitValue, ok := payload["limit"].(float64)
	limit := int(limitValue)
	if !ok || limitValue != float64(limit) || limit < 1 || limit > 100 {
		return sessioncatalog.Query{}, false
	}
	cursor := 0
	if rawCursor := payload["cursor"]; rawCursor != nil {
		cursorValue, ok := rawCursor.(string)
		if !ok || len(cursorValue) == 0 || len(cursorValue) > 10 {
			return sessioncatalog.Query{}, false
		}
		parsed, err := strconv.Atoi(cursorValue)
		if err != nil || parsed < 0 {
			return sessioncatalog.Query{}, false
		}
		cursor = parsed
	}
	return sessioncatalog.Query{Provider: provider, Cursor: cursor, Limit: limit}, true
}

func validRequest(request protocol.Request) bool {
	return request.ProtocolVersion == protocol.Version &&
		request.Kind == "request" &&
		request.Generation >= 0 &&
		requestIDPattern.MatchString(request.RequestID) &&
		request.Payload != nil
}

func discoveryProviders(payload map[string]any) ([]string, bool) {
	if len(payload) != 1 {
		return nil, false
	}
	raw, ok := payload["enabledProviders"].([]any)
	if !ok || len(raw) == 0 || len(raw) > len(providerprobe.Registry) {
		return nil, false
	}
	allowed := make(map[string]struct{}, len(providerprobe.Registry))
	for _, definition := range providerprobe.Registry {
		allowed[definition.Provider] = struct{}{}
	}
	providers := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	for _, value := range raw {
		provider, ok := value.(string)
		if !ok {
			return nil, false
		}
		if _, ok := allowed[provider]; !ok {
			return nil, false
		}
		if _, duplicate := seen[provider]; duplicate {
			return nil, false
		}
		seen[provider] = struct{}{}
		providers = append(providers, provider)
	}
	return providers, true
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
		if len(request.Payload) != 0 {
			response.Error = &protocol.ResponseError{
				Code: "INVALID_REQUEST", Message: "The helper request is invalid.",
			}
			return response, false
		}
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
		if len(request.Payload) != 0 {
			response.Error = &protocol.ResponseError{
				Code: "INVALID_REQUEST", Message: "The helper request is invalid.",
			}
			return response, false
		}
		response.OK = true
		response.Result = map[string]string{"status": "ok"}
	case "shutdown":
		if len(request.Payload) != 0 {
			response.Error = &protocol.ResponseError{
				Code: "INVALID_REQUEST", Message: "The helper request is invalid.",
			}
			return response, false
		}
		response.OK = true
		response.Result = map[string]bool{"accepted": true}
		return response, true
	case "discovery-scan":
		providers, valid := discoveryProviders(request.Payload)
		if !valid {
			response.Error = &protocol.ResponseError{
				Code: "INVALID_REQUEST", Message: "The helper request is invalid.",
			}
			return response, false
		}
		discover := dependencies.Discover
		if discover == nil {
			discover = func(ctx context.Context, selected []string) providerprobe.Result {
				return providerprobe.Scan(ctx, selected, providerprobe.DefaultDependencies())
			}
		}
		response.OK = true
		response.Result = discover(context.Background(), providers)
	case "session-scan":
		query, valid := sessionQuery(request.Payload)
		if !valid {
			response.Error = &protocol.ResponseError{
				Code: "INVALID_REQUEST", Message: "The helper request is invalid.",
			}
			return response, false
		}
		scan := dependencies.SessionScan
		if scan == nil {
			scan = sessioncatalog.Scan
		}
		response.OK = true
		response.Result = scan(context.Background(), query)
	default:
		response.Error = &protocol.ResponseError{
			Code: "UNSUPPORTED_OPERATION", Message: "The helper operation is unsupported.",
		}
	}
	return response, false
}

func Serve(reader io.Reader, writer io.Writer, dependencies Dependencies) error {
	if dependencies.SessionScan == nil {
		catalog := sessioncatalog.NewCatalog(sessioncatalog.Dependencies{})
		dependencies.SessionScan = catalog.Scan
	}
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
