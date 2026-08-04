package main

import (
	"fmt"
	"os"

	"github.com/HAYASAKA7/lumora/helper/internal/server"
)

var helperVersion = "dev"

func main() {
	if err := server.Serve(os.Stdin, os.Stdout, server.Dependencies{
		HelperVersion: helperVersion,
	}); err != nil {
		fmt.Fprintln(os.Stderr, "Lumora helper stopped because its protocol stream was invalid.")
		os.Exit(1)
	}
}
