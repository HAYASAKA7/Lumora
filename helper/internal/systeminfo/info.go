package systeminfo

import (
	"errors"
	"os"
	"runtime"

	"github.com/HAYASAKA7/lumora/helper/internal/protocol"
)

type Info struct {
	HelperVersion   string   `json:"helperVersion"`
	ProtocolVersion int      `json:"protocolVersion"`
	Platform        string   `json:"platform"`
	Architecture    string   `json:"architecture"`
	HomeDirectory   string   `json:"homeDirectory"`
	DefaultShell    string   `json:"defaultShell"`
	Capabilities    []string `json:"capabilities"`
}

func Normalize(goos, goarch string) (string, string, error) {
	platform := goos
	if goos == "windows" {
		platform = "win32"
	}
	if platform != "win32" && platform != "darwin" && platform != "linux" {
		return "", "", errors.New("unsupported helper platform")
	}
	architecture := goarch
	if goarch == "amd64" {
		architecture = "x64"
	}
	if architecture != "x64" && architecture != "arm64" {
		return "", "", errors.New("unsupported helper architecture")
	}
	return platform, architecture, nil
}

func Current(helperVersion string) (Info, error) {
	platform, architecture, err := Normalize(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return Info{}, err
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return Info{}, errors.New("user home is unavailable")
	}
	shell := os.Getenv("SHELL")
	if platform == "win32" {
		shell = os.Getenv("ComSpec")
		if shell == "" {
			shell = `C:\Windows\System32\cmd.exe`
		}
	} else if shell == "" {
		shell = "/bin/sh"
	}
	return Info{
		HelperVersion:   helperVersion,
		ProtocolVersion: protocol.Version,
		Platform:        platform,
		Architecture:    architecture,
		HomeDirectory:   home,
		DefaultShell:    shell,
		Capabilities: []string{
			"system-info", "provider-scan", "provider-lifecycle", "session-scan",
		},
	}, nil
}
