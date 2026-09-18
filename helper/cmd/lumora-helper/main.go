package main

import (
	"fmt"
	"os"

	"github.com/HAYASAKA7/lumora/helper/internal/server"
	"github.com/HAYASAKA7/lumora/helper/internal/statusnotify"
)

var helperVersion = "dev"

func main() {
	// Run from an agent's hook: tell Lumora the agent finished or needs the person.
	if len(os.Args) > 1 && os.Args[1] == "notify" {
		os.Exit(statusnotify.Run(os.Args[2:], statusnotify.Default(os.Getenv, os.Stdin)))
	}
	if err := server.Serve(os.Stdin, os.Stdout, server.Dependencies{
		HelperVersion: helperVersion,
	}); err != nil {
		fmt.Fprintln(os.Stderr, "Lumora helper stopped because its protocol stream was invalid.")
		os.Exit(1)
	}
}
