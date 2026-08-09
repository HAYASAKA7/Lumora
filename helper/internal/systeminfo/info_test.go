package systeminfo

import (
	"slices"
	"testing"
)

func TestNormalizePlatformAndArchitecture(t *testing.T) {
	cases := []struct {
		goos, goarch, platform, architecture string
	}{
		{"windows", "amd64", "win32", "x64"},
		{"darwin", "arm64", "darwin", "arm64"},
		{"linux", "amd64", "linux", "x64"},
	}
	for _, test := range cases {
		platform, architecture, err := Normalize(test.goos, test.goarch)
		if err != nil || platform != test.platform || architecture != test.architecture {
			t.Fatalf("Normalize(%q, %q) = %q, %q, %v", test.goos, test.goarch, platform, architecture, err)
		}
	}
}

func TestNormalizeRejectsUnsupportedTargets(t *testing.T) {
	if _, _, err := Normalize("freebsd", "amd64"); err == nil {
		t.Fatal("expected unsupported platform to fail")
	}
	if _, _, err := Normalize("linux", "386"); err == nil {
		t.Fatal("expected unsupported architecture to fail")
	}
}

func TestCurrentAdvertisesImplementedCatalogCapabilities(t *testing.T) {
	info, err := Current("0.2.3")
	if err != nil {
		t.Fatal(err)
	}
	for _, capability := range []string{"system-info", "provider-scan", "session-scan"} {
		if !slices.Contains(info.Capabilities, capability) {
			t.Fatalf("missing capability %q in %#v", capability, info.Capabilities)
		}
	}
}
